import { useCallback, useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';

import { colors } from '@shared/design/tokens';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import {
  decideReservation,
  fetchManagedReservations,
  fetchReservationSettings,
  saveReservationSettings,
} from '../api';
import { formatPlanDate } from '../planTime';
import type { Reservation, ReservationSettings } from '../types';
import { Card, errorMessage, Field, manageStyles as ms, Section } from './ui';

function Settings({ placeId }: { placeId: string }) {
  const [settings, setSettings] = useState<ReservationSettings | null>(null);
  const [capacity, setCapacity] = useState('');
  const [maxParty, setMaxParty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchReservationSettings(placeId, controller.signal)
      .then((value) => {
        setSettings(value);
        setCapacity(String(value.capacity));
        setMaxParty(String(value.max_party_size));
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(e, 'No pudimos cargar la configuración.'));
      });
    return () => controller.abort();
  }, [placeId]);

  async function save(next: Partial<ReservationSettings>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const value = await saveReservationSettings(placeId, next);
      setSettings(value);
      setCapacity(String(value.capacity));
      setMaxParty(String(value.max_party_size));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e, 'No pudimos guardar la configuración.'));
    } finally {
      setBusy(false);
    }
  }

  function saveNumbers() {
    // Enteros estrictos: el servidor rechaza decimales y textos.
    if (!/^\d{1,3}$/.test(capacity.trim()) || !/^\d{1,2}$/.test(maxParty.trim())) {
      setError('El cupo y el máximo por reserva deben ser números enteros.');
      return;
    }
    void save({ capacity: Number(capacity), max_party_size: Number(maxParty) });
  }

  if (!settings) return error ? <Banner tone="error">{error}</Banner> : null;

  return (
    <Card>
      <View style={ms.rowBetween}>
        <Text style={[ms.strong, ms.flex]}>Aceptar reservas</Text>
        <Switch
          value={settings.enabled}
          onValueChange={(enabled) => void save({ enabled })}
          disabled={busy}
          trackColor={{ true: colors.brand, false: colors.borderStrong }}
          accessibilityLabel="Aceptar reservas"
        />
      </View>
      <Field
        label="Personas por horario (1 a 500)"
        value={capacity}
        onChangeText={setCapacity}
        keyboardType="number-pad"
        maxLength={3}
      />
      <Field
        label="Máximo de personas por reserva (1 a 50)"
        value={maxParty}
        onChangeText={setMaxParty}
        keyboardType="number-pad"
        maxLength={2}
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {saved ? <Banner tone="success">Configuración guardada.</Banner> : null}
      <Button label="Guardar cupos" variant="secondary" onPress={saveNumbers} loading={busy} />
    </Card>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  declined: 'Rechazada',
  cancelled: 'Cancelada',
};

/**
 * Reservas del negocio (ADR-040 fases 8 y 9): activar y dimensionar el cupo, y la bandeja de
 * solicitudes. Del cliente solo se ve lo necesario para atender; nunca correo ni teléfono.
 */
export function ManageReservations({ placeId, onChanged }: { placeId: string; onChanged: () => void }) {
  const [items, setItems] = useState<Reservation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setItems(await fetchManagedReservations(placeId, undefined, signal));
        setLoadError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setLoadError(errorMessage(e, 'No pudimos cargar las solicitudes.'));
        setItems((current) => current ?? []);
      }
    },
    [placeId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function decide(reservation: Reservation, decision: 'confirm' | 'decline') {
    if (busyId) return;
    setBusyId(reservation.id);
    try {
      await decideReservation(placeId, reservation.id, decision);
      await load();
      onChanged();
    } catch (e) {
      Alert.alert('No pudimos hacerlo', errorMessage(e, 'Intentá de nuevo.'));
    } finally {
      setBusyId(null);
    }
  }

  const upcoming = (r: Reservation) => new Date(r.starts_at).getTime() > Date.now();

  return (
    <Section title="Reservas">
      <Settings placeId={placeId} />
      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {items && items.length === 0 && !loadError ? (
        <Text style={ms.muted}>No hay solicitudes todavía.</Text>
      ) : null}
      {items?.map((reservation) => (
        <Card key={reservation.id}>
          <Text style={ms.strong}>
            {formatPlanDate(reservation.starts_at)} · {reservation.party_size}{' '}
            {reservation.party_size === 1 ? 'persona' : 'personas'}
          </Text>
          <Text style={ms.muted}>
            {reservation.user ? `${reservation.user.name || reservation.user.username} · ` : ''}
            {STATUS_LABEL[reservation.status] ?? reservation.status}
          </Text>
          {reservation.note ? <Text style={ms.muted}>Nota: {reservation.note}</Text> : null}
          {reservation.status === 'pending' && upcoming(reservation) ? (
            <View style={ms.row}>
              <Button
                label="Confirmar"
                onPress={() => void decide(reservation, 'confirm')}
                disabled={busyId === reservation.id}
                style={ms.flex}
              />
              <Button
                label="Rechazar"
                variant="danger"
                onPress={() => void decide(reservation, 'decline')}
                disabled={busyId === reservation.id}
                style={ms.flex}
              />
            </View>
          ) : null}
        </Card>
      ))}
    </Section>
  );
}
