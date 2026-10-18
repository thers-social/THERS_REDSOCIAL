import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import {
  cancelReservation,
  createReservation,
  fetchAvailability,
  fetchMyReservations,
  fetchSchedule,
} from './api';
import { describeIntervals, formatClock, nextDays, WEEKDAYS } from './businessTime';
import { formatPlanDate } from './planTime';
import { shareReservationPdf } from './quotePdf';
import type { Availability, Reservation, ReservationStatus, Schedule } from './types';

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  declined: 'Rechazada',
  cancelled: 'Cancelada',
};

function message(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

/** Horario semanal y días cerrados (ADR-040 fase 9). Solo se pinta si el negocio lo cargó. */
function Hours({ schedule }: { schedule: Schedule }) {
  const loaded = schedule.days.some((day) => day.intervals.length > 0);
  if (!loaded && schedule.closures.length === 0) return null;
  return (
    <View style={styles.box}>
      <Text style={styles.subtitle}>Horario</Text>
      {loaded
        ? schedule.days.map((day) => (
            <View key={day.weekday} style={styles.hourRow}>
              <Text style={styles.hourDay}>{WEEKDAYS[day.weekday]}</Text>
              <Text style={styles.hourText}>{describeIntervals(day.intervals)}</Text>
            </View>
          ))
        : null}
      {schedule.closures.map((closure) => (
        <Text key={closure.date} style={styles.muted}>
          Cerrado el {closure.date}
          {closure.reason ? ` · ${closure.reason}` : ''}
        </Text>
      ))}
      <Text style={styles.muted}>Horas de El Salvador ({schedule.timezone}).</Text>
    </View>
  );
}

type FormProps = { placeId: string; onDone: () => void };

function ReservationForm({ placeId, onDone }: FormProps) {
  const days = useMemo(() => nextDays(10), []);
  const [day, setDay] = useState(days[0].key);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [slot, setSlot] = useState<string | null>(null);
  const [party, setParty] = useState(2);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSlot(null);
    setError(null);
    fetchAvailability(placeId, day, controller.signal)
      .then(setAvailability)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setAvailability(null);
        setError(message(e, 'No pudimos cargar los horarios.'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [placeId, day]);

  const maxParty = availability?.max_party_size ?? 50;
  const chosen = availability?.slots.find((s) => s.starts_at === slot);
  const seatsLeft = chosen?.seats_left ?? maxParty;
  const partyLimit = Math.max(1, Math.min(maxParty, seatsLeft));

  async function submit() {
    if (!slot || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createReservation(placeId, {
        starts_at: slot,
        party_size: Math.min(party, partyLimit),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone();
    } catch (e) {
      setError(message(e, 'No pudimos enviar la solicitud. Intentá de nuevo.'));
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Día</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {days.map((d) => (
          <Pressable
            key={d.key}
            onPress={() => setDay(d.key)}
            style={[styles.chip, day === d.key && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: day === d.key }}
          >
            <Text style={[styles.chipText, day === d.key && styles.chipTextOn]}>{d.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.label}>Hora</Text>
      {loading ? <Text style={styles.muted}>Buscando horarios…</Text> : null}
      {!loading && availability && availability.slots.length === 0 ? (
        <Text style={styles.muted}>No hay horarios libres ese día. Probá con otro.</Text>
      ) : null}
      {!loading && availability?.default_hours && availability.slots.length > 0 ? (
        <Text style={styles.muted}>
          Este lugar no publicó su horario: te mostramos un horario de 10:00 a 21:00. Es una solicitud y el
          lugar la confirma o la rechaza.
        </Text>
      ) : null}
      <View style={styles.slots}>
        {availability?.slots.map((s) => (
          <Pressable
            key={s.starts_at}
            onPress={() => setSlot(s.starts_at)}
            style={[styles.chip, slot === s.starts_at && styles.chipOn]}
            accessibilityRole="button"
            accessibilityLabel={`${formatClock(s.starts_at)}, quedan ${s.seats_left} lugares`}
            accessibilityState={{ selected: slot === s.starts_at }}
          >
            <Text style={[styles.chipText, slot === s.starts_at && styles.chipTextOn]}>
              {formatClock(s.starts_at)}
            </Text>
          </Pressable>
        ))}
      </View>
      {chosen ? <Text style={styles.muted}>Quedan {chosen.seats_left} lugares a esa hora.</Text> : null}

      <Text style={styles.label}>Personas</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => setParty((n) => Math.max(1, n - 1))}
          style={styles.stepButton}
          accessibilityRole="button"
          accessibilityLabel="Menos personas"
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{Math.min(party, partyLimit)}</Text>
        <Pressable
          onPress={() => setParty((n) => Math.min(partyLimit, n + 1))}
          style={styles.stepButton}
          accessibilityRole="button"
          accessibilityLabel="Más personas"
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
        <Text style={styles.muted}>máx. {maxParty}</Text>
      </View>

      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        maxLength={300}
        multiline
        textAlignVertical="top"
        placeholder="Nota (opcional)"
        placeholderTextColor={colors.fgDisabled}
        accessibilityLabel="Nota de la reserva"
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button label="Solicitar reserva" onPress={() => void submit()} loading={busy} disabled={!slot} />
    </View>
  );
}

/**
 * Reservas en la ficha (ADR-040 fases 8 y 9). El formulario solo aparece si el negocio las
 * acepta; el cupo, el horario y los cierres los valida el servidor al enviar. Una reserva
 * queda «Pendiente» hasta que el negocio la confirme o la rechace.
 */
export function PlaceReservations({
  placeId,
  accepts,
  claimed = true,
}: {
  placeId: string;
  accepts: boolean;
  /** `false`: nadie gestiona el lugar en THERS, así que la solicitud puede no ser atendida. */
  claimed?: boolean;
}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [mine, setMine] = useState<Reservation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [hours, all] = await Promise.all([
          fetchSchedule(placeId, signal),
          fetchMyReservations(signal),
        ]);
        setSchedule(hours);
        setMine(all.filter((r) => r.place.id === placeId));
        setLoadError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setLoadError(message(e, 'No pudimos cargar las reservas.'));
      }
    },
    [placeId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function confirmCancel(reservation: Reservation) {
    Alert.alert('¿Cancelar la reserva?', 'El lugar quedará libre para otras personas.', [
      { text: 'Volver', style: 'cancel' },
      {
        text: 'Cancelar reserva',
        style: 'destructive',
        onPress: () => {
          setBusyId(reservation.id);
          cancelReservation(reservation.id)
            .then(() => load())
            .catch((e: unknown) => Alert.alert('No pudimos cancelarla', message(e, 'Intentá de nuevo.')))
            .finally(() => setBusyId(null));
        },
      },
    ]);
  }

  const active = (r: Reservation) => r.status === 'pending' || r.status === 'confirmed';
  const visible = mine.filter((r) => new Date(r.starts_at).getTime() > Date.now() || active(r));

  if (!accepts && visible.length === 0 && !schedule) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        Reservas
      </Text>
      {schedule ? <Hours schedule={schedule} /> : null}
      {!claimed ? (
        <Text style={styles.muted}>
          Este negocio aún no ha reclamado su lugar en THERS: tu solicitud puede no ser atendida.
        </Text>
      ) : null}
      {loadError ? <Banner tone="error">{loadError}</Banner> : null}

      {accepts ? (
        creating ? (
          <ReservationForm
            placeId={placeId}
            onDone={() => {
              setCreating(false);
              void load();
            }}
          />
        ) : (
          <Button label="Reservar" onPress={() => setCreating(true)} />
        )
      ) : (
        <Text style={styles.muted}>Este lugar todavía no recibe reservas por THERS.</Text>
      )}
      {creating ? <Button label="Cancelar" variant="ghost" onPress={() => setCreating(false)} /> : null}

      {visible.map((reservation) => (
        <View key={reservation.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {formatPlanDate(reservation.starts_at)} · {reservation.party_size}{' '}
            {reservation.party_size === 1 ? 'persona' : 'personas'}
          </Text>
          <Text style={[styles.status, reservation.status === 'confirmed' && styles.statusOk]}>
            {STATUS_LABEL[reservation.status]}
          </Text>
          {reservation.note ? <Text style={styles.muted}>Tu nota: {reservation.note}</Text> : null}
          {reservation.decision_note ? (
            <Text style={styles.muted}>Respuesta del lugar: {reservation.decision_note}</Text>
          ) : null}
          <Button
            label="Descargar PDF"
            variant="secondary"
            onPress={() =>
              shareReservationPdf(reservation.id).catch((e: unknown) =>
                Alert.alert('No pudimos abrir el PDF', message(e, 'Intentá de nuevo.')),
              )
            }
          />
          {active(reservation) ? (
            <Button
              label="Cancelar reserva"
              variant="danger"
              onPress={() => confirmCancel(reservation)}
              disabled={busyId === reservation.id}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginTop: space[6], gap: space[3] },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  subtitle: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fgMuted },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  box: {
    gap: space[1],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hourRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  hourDay: { fontSize: fontSize.bodyMd, color: colors.fg, fontWeight: '600' },
  hourText: { flex: 1, textAlign: 'right', fontSize: fontSize.bodyMd, color: colors.fgMuted },
  form: {
    gap: space[3],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fgMuted },
  chips: { gap: space[2] },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  chipText: { fontSize: fontSize.bodyMd, color: colors.fg },
  chipTextOn: { color: colors.onBrand, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  stepText: { fontSize: fontSize.headlineSm, color: colors.fg },
  stepValue: { minWidth: 28, textAlign: 'center', fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  input: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  card: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  status: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fgMuted },
  statusOk: { color: colors.successFg },
}));
