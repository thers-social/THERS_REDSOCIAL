import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import {
  cancelPlan,
  createPlan,
  fetchFriends,
  fetchUpcomingPlans,
  leavePlan,
  respondToPlan,
} from './api';
import { formatPlanDate, planStartsAt } from './planTime';
import type { Plan, PlanMemberStatus, PlanPerson } from './types';

const STATUS_LABEL: Record<PlanMemberStatus, string> = {
  going: 'va',
  invited: 'invitado',
  declined: 'no va',
};

function message(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

type FormProps = { placeId: string; onCancel: () => void; onCreated: () => void };

function CreatePlanForm({ placeId, onCancel, onCreated }: FormProps) {
  const [friends, setFriends] = useState<PlanPerson[] | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchFriends(controller.signal)
      .then(setFriends)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(message(e, 'No pudimos cargar tus amigos.'));
        setFriends([]);
      });
    return () => controller.abort();
  }, []);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function submit() {
    if (busy) return;
    const startsAt = planStartsAt(date, time);
    if (!title.trim()) return setError('Ponle un nombre al plan.');
    if (!startsAt) return setError('Escribí una fecha y hora futuras: AAAA-MM-DD y HH:MM.');
    setBusy(true);
    setError(null);
    try {
      await createPlan(placeId, {
        title: title.trim(),
        starts_at: startsAt,
        ...(note.trim() ? { note: note.trim() } : {}),
        user_ids: selected,
      });
      onCreated();
    } catch (e) {
      setError(message(e, 'No pudimos crear el plan. Intentá de nuevo.'));
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.label}>¿Qué van a hacer?</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        maxLength={80}
        placeholder="Café el sábado"
        placeholderTextColor={colors.fgDisabled}
        accessibilityLabel="Nombre del plan"
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.label}>Fecha</Text>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            maxLength={10}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.fgDisabled}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Fecha del plan"
          />
        </View>
        <View style={styles.flex}>
          <Text style={styles.label}>Hora</Text>
          <TextInput
            style={styles.input}
            value={time}
            onChangeText={setTime}
            maxLength={5}
            placeholder="HH:MM"
            placeholderTextColor={colors.fgDisabled}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Hora del plan"
          />
        </View>
      </View>
      <TextInput
        style={[styles.input, styles.noteInput]}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        textAlignVertical="top"
        placeholder="Nota (opcional)"
        placeholderTextColor={colors.fgDisabled}
        accessibilityLabel="Nota del plan"
      />

      <Text style={styles.label}>Invitar amigos</Text>
      {friends === null ? <Text style={styles.muted}>Cargando…</Text> : null}
      {friends && friends.length === 0 ? (
        <Text style={styles.muted}>
          Aún no tenés amigos para invitar. Un amigo es alguien a quien seguís y que te sigue.
        </Text>
      ) : null}
      {friends?.map((friend) => {
        const on = selected.includes(friend.id);
        return (
          <Pressable
            key={friend.id}
            onPress={() => toggle(friend.id)}
            style={[styles.friend, on && styles.friendOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={friend.name}
          >
            <Avatar name={friend.name} uri={friend.avatar_url} size={32} />
            <Text style={styles.friendName} numberOfLines={1}>
              {friend.name}
            </Text>
            <Text style={styles.friendMark}>{on ? '✓' : ''}</Text>
          </Pressable>
        );
      })}

      {error ? <Banner tone="error">{error}</Banner> : null}
      <View style={styles.row}>
        <Button label="Crear plan" onPress={() => void submit()} loading={busy} style={styles.flex} />
        <Button label="Cancelar" variant="ghost" onPress={onCancel} disabled={busy} style={styles.flex} />
      </View>
    </View>
  );
}

/**
 * Planes con amistades en la ficha de un lugar (ADR-040 fase 5). Muestra los planes
 * próximos de la persona en ESTE lugar y deja crear uno invitando a amistades. Los textos
 * (títulos, notas, nombres) se pintan siempre como `<Text>`.
 */
export function PlacePlans({ placeId }: { placeId: string }) {
  const { user } = useAuth();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const all = await fetchUpcomingPlans(signal);
        setPlans(all.filter((plan) => plan.place.id === placeId));
        setLoadError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setLoadError(message(e, 'No pudimos cargar tus planes.'));
        setPlans((current) => current ?? []);
      }
    },
    [placeId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function act(plan: Plan, action: () => Promise<unknown>) {
    if (busyId) return;
    setBusyId(plan.id);
    try {
      await action();
      await load();
    } catch (e) {
      Alert.alert('No pudimos hacerlo', message(e, 'Intentá de nuevo.'));
    } finally {
      setBusyId(null);
    }
  }

  function confirmCancel(plan: Plan) {
    Alert.alert('¿Cancelar el plan?', 'Tus amigos verán que se canceló.', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Cancelar plan', style: 'destructive', onPress: () => void act(plan, () => cancelPlan(plan.id)) },
    ]);
  }

  if (!user) return null;

  return (
    <View style={styles.section}>
      <View style={styles.rowBetween}>
        <Text style={styles.title} accessibilityRole="header">
          Planes con amigos
        </Text>
        {!creating ? (
          <Pressable onPress={() => setCreating(true)} accessibilityRole="button">
            <Text style={styles.link}>Crear plan</Text>
          </Pressable>
        ) : null}
      </View>

      {creating ? (
        <CreatePlanForm
          placeId={placeId}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}

      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {plans && plans.length === 0 && !creating && !loadError ? (
        <Text style={styles.muted}>No tenés planes próximos en este lugar.</Text>
      ) : null}

      {plans?.map((plan) => {
        const mine = plan.creator.id === user.id;
        const busy = busyId === plan.id;
        return (
          <View key={plan.id} style={styles.plan}>
            <Text style={styles.planTitle}>{plan.title}</Text>
            <Text style={styles.muted}>
              {formatPlanDate(plan.starts_at)}
              {plan.status === 'cancelled' ? ' · Cancelado' : ''}
            </Text>
            {plan.note ? <Text style={styles.body}>{plan.note}</Text> : null}
            {plan.members.map((member) => (
              <View key={member.id} style={styles.member}>
                <Avatar name={member.name} uri={member.avatar_url} size={24} />
                <Text style={styles.memberText} numberOfLines={1}>
                  {member.name} · {STATUS_LABEL[member.status]}
                </Text>
              </View>
            ))}
            {plan.status === 'active' ? (
              <View style={styles.row}>
                {!mine && plan.my_status !== 'going' ? (
                  <Button
                    label="Voy"
                    onPress={() => void act(plan, () => respondToPlan(plan.id, 'going'))}
                    disabled={busy}
                    style={styles.flex}
                  />
                ) : null}
                {!mine && plan.my_status !== 'declined' ? (
                  <Button
                    label="No voy"
                    variant="secondary"
                    onPress={() => void act(plan, () => respondToPlan(plan.id, 'declined'))}
                    disabled={busy}
                    style={styles.flex}
                  />
                ) : null}
                {!mine ? (
                  <Button
                    label="Salirme"
                    variant="ghost"
                    onPress={() => void act(plan, () => leavePlan(plan.id, user.id))}
                    disabled={busy}
                    style={styles.flex}
                  />
                ) : (
                  <Button
                    label="Cancelar plan"
                    variant="danger"
                    onPress={() => confirmCancel(plan)}
                    disabled={busy}
                    style={styles.flex}
                  />
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginTop: space[6], gap: space[3] },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  link: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  body: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 21 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  form: {
    gap: space[3],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fgMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  noteInput: { minHeight: 70 },
  friend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[2],
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  friendOn: { borderColor: colors.brand },
  friendName: { flex: 1, fontSize: fontSize.bodyMd, color: colors.fg },
  friendMark: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.brandText },
  plan: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planTitle: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  member: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  memberText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.fgMuted },
}));
