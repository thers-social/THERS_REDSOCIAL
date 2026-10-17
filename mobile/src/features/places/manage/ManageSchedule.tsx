import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import {
  addClosure,
  fetchCalendar,
  fetchSchedule,
  removeClosure,
  saveSchedule,
} from '../api';
import { describeIntervals, intervalsError, isDateKey, padHour, WEEKDAYS } from '../businessTime';
import type { CalendarDay, Closure, ScheduleDay } from '../types';
import { Card, errorMessage, Field, manageStyles as ms, Section } from './ui';

const EMPTY_WEEK: ScheduleDay[] = WEEKDAYS.map((_, weekday) => ({ weekday, intervals: [] }));

function normalizeWeek(days: ScheduleDay[]): ScheduleDay[] {
  return EMPTY_WEEK.map((empty) => {
    const found = days.find((d) => d.weekday === empty.weekday);
    return {
      weekday: empty.weekday,
      intervals: (found?.intervals ?? []).map((i) => ({
        opens: i.opens.slice(0, 5),
        closes: i.closes.slice(0, 5),
      })),
    };
  });
}

function HoursEditor({ placeId, onChanged }: { placeId: string; onChanged: () => void }) {
  const [week, setWeek] = useState<ScheduleDay[] | null>(null);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [closeDate, setCloseDate] = useState('');
  const [closeReason, setCloseReason] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const schedule = await fetchSchedule(placeId, signal);
        setWeek(normalizeWeek(schedule.days));
        setClosures(schedule.closures);
      } catch (e) {
        if (signal?.aborted) return;
        setError(errorMessage(e, 'No pudimos cargar el horario.'));
        setWeek((current) => current ?? normalizeWeek([]));
      }
    },
    [placeId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function editInterval(weekday: number, index: number, field: 'opens' | 'closes', value: string) {
    setSaved(false);
    setWeek((current) =>
      (current ?? []).map((day) =>
        day.weekday !== weekday
          ? day
          : {
              ...day,
              intervals: day.intervals.map((interval, i) =>
                i === index ? { ...interval, [field]: value } : interval,
              ),
            },
      ),
    );
  }

  function addInterval(weekday: number) {
    setSaved(false);
    setWeek((current) =>
      (current ?? []).map((day) =>
        day.weekday === weekday && day.intervals.length < 3
          ? { ...day, intervals: [...day.intervals, { opens: '08:00', closes: '17:00' }] }
          : day,
      ),
    );
  }

  function removeInterval(weekday: number, index: number) {
    setSaved(false);
    setWeek((current) =>
      (current ?? []).map((day) =>
        day.weekday === weekday
          ? { ...day, intervals: day.intervals.filter((_, i) => i !== index) }
          : day,
      ),
    );
  }

  async function save() {
    if (!week || busy) return;
    for (const day of week) {
      const problem = intervalsError(day.intervals);
      if (problem) return setError(`${WEEKDAYS[day.weekday]}: ${problem}`);
    }
    setBusy(true);
    setError(null);
    try {
      // Reemplaza TODO el horario de forma atómica: si algo es inválido no cambia nada.
      await saveSchedule(
        placeId,
        week.map((day) => ({
          weekday: day.weekday,
          intervals: day.intervals.map((i) => ({ opens: padHour(i.opens), closes: padHour(i.closes) })),
        })),
      );
      setSaved(true);
      await load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e, 'No pudimos guardar el horario.'));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!isDateKey(closeDate)) return setError('Escribí el día como AAAA-MM-DD.');
    setBusy(true);
    setError(null);
    try {
      await addClosure(placeId, closeDate.trim(), closeReason.trim() || undefined);
      setCloseDate('');
      setCloseReason('');
      await load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e, 'No pudimos cerrar ese día.'));
    } finally {
      setBusy(false);
    }
  }

  function reopen(date: string) {
    Alert.alert('¿Quitar el cierre?', `El ${date} volverá a aceptar reservas.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        onPress: () => {
          removeClosure(placeId, date)
            .then(() => load())
            .then(onChanged)
            .catch((e: unknown) => Alert.alert('No pudimos quitarlo', errorMessage(e, 'Intentá de nuevo.')));
        },
      },
    ]);
  }

  if (!week) return <Text style={ms.muted}>Cargando horario…</Text>;

  return (
    <>
      <Card>
        <Text style={ms.muted}>
          Horas de El Salvador (UTC-6), en cuartos de hora. Un día sin tramos está cerrado; sin ningún
          horario cargado no se restringen las reservas por hora.
        </Text>
        {week.map((day) => (
          <View key={day.weekday} style={styles.day}>
            <View style={ms.rowBetween}>
              <Text style={ms.strong}>{WEEKDAYS[day.weekday]}</Text>
              {day.intervals.length < 3 ? (
                <Pressable onPress={() => addInterval(day.weekday)} accessibilityRole="button">
                  <Text style={ms.link}>+ Tramo</Text>
                </Pressable>
              ) : null}
            </View>
            {day.intervals.length === 0 ? <Text style={ms.muted}>Cerrado</Text> : null}
            {day.intervals.map((interval, index) => (
              <View key={index} style={styles.interval}>
                <TextInput
                  style={styles.time}
                  value={interval.opens}
                  onChangeText={(v) => editInterval(day.weekday, index, 'opens', v)}
                  maxLength={5}
                  placeholder="08:00"
                  placeholderTextColor={colors.fgDisabled}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel={`${WEEKDAYS[day.weekday]}, apertura del tramo ${index + 1}`}
                />
                <Text style={ms.muted}>a</Text>
                <TextInput
                  style={styles.time}
                  value={interval.closes}
                  onChangeText={(v) => editInterval(day.weekday, index, 'closes', v)}
                  maxLength={5}
                  placeholder="17:00"
                  placeholderTextColor={colors.fgDisabled}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel={`${WEEKDAYS[day.weekday]}, cierre del tramo ${index + 1}`}
                />
                <Pressable
                  onPress={() => removeInterval(day.weekday, index)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Quitar tramo"
                >
                  <Text style={styles.remove}>Quitar</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ))}
        {saved ? <Banner tone="success">Horario guardado.</Banner> : null}
        <Button label="Guardar horario" onPress={() => void save()} loading={busy} />
      </Card>

      <Card>
        <Text style={ms.strong}>Cerrar un día</Text>
        <Field label="Día" value={closeDate} onChangeText={setCloseDate} placeholder="AAAA-MM-DD" maxLength={10} keyboardType="numbers-and-punctuation" />
        <Field label="Motivo (opcional)" value={closeReason} onChangeText={setCloseReason} maxLength={120} />
        <Button label="Cerrar ese día" variant="secondary" onPress={() => void close()} loading={busy} />
        {closures.map((closure) => (
          <View key={closure.date} style={ms.rowBetween}>
            <Text style={[ms.muted, ms.flex]}>
              {closure.date}
              {closure.reason ? ` · ${closure.reason}` : ''}
            </Text>
            <Pressable onPress={() => reopen(closure.date)} accessibilityRole="button">
              <Text style={ms.link}>Quitar</Text>
            </Pressable>
          </View>
        ))}
      </Card>
      {error ? <Banner tone="error">{error}</Banner> : null}
    </>
  );
}

/** Horario semanal, cierres puntuales y calendario de reservas (ADR-040 fase 9). */
export function ManageSchedule({ placeId }: { placeId: string }) {
  const [calendar, setCalendar] = useState<CalendarDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setCalendar(await fetchCalendar(placeId, signal));
        setError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setError(errorMessage(e, 'No pudimos cargar el calendario.'));
        setCalendar((current) => current ?? []);
      }
    },
    [placeId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <Section title="Horario y calendario">
      <HoursEditor placeId={placeId} onChanged={() => void load()} />
      <Text style={ms.strong}>Próximos 14 días</Text>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {calendar?.map((day) => (
        <View key={day.date} style={styles.calendarRow}>
          <Text style={styles.calendarDate}>
            {new Date(`${day.date}T12:00:00`).toLocaleDateString('es', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </Text>
          <Text style={[ms.muted, ms.flex]}>
            {day.closed
              ? `Cerrado${day.closure_reason ? ` · ${day.closure_reason}` : ''}`
              : describeIntervals(day.intervals)}
          </Text>
          <Text style={ms.strong}>
            {day.reservations.pending + day.reservations.confirmed > 0
              ? `${day.reservations.confirmed} conf. · ${day.reservations.pending} pend. · ${day.reservations.people} pers.`
              : '—'}
          </Text>
        </View>
      ))}
    </Section>
  );
}

const styles = themedStyles(() => ({
  day: { gap: space[1], paddingTop: space[2], borderTopWidth: 1, borderTopColor: colors.border },
  interval: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  time: {
    width: 78,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    textAlign: 'center',
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  remove: { fontSize: fontSize.labelLg, color: colors.dangerFg, fontWeight: '700' },
  calendarRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  calendarDate: { width: 84, fontSize: fontSize.bodyMd, color: colors.fg, fontWeight: '600' },
}));
