import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { closeOtherSessions, closeSession, fetchSessions } from '@features/settings/api';
import type { ActiveSession } from '@features/settings/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { formatRelativeTime } from '@shared/lib/time';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/** Una descripción corta del navegador/dispositivo a partir del User-Agent. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Dispositivo desconocido';
  if (/THERS|okhttp|Expo/i.test(userAgent)) return 'App de THERS (Android)';
  if (/Android/i.test(userAgent)) return 'Navegador en Android';
  if (/iPhone|iPad/i.test(userAgent)) return 'Navegador en iPhone/iPad';
  if (/Windows/i.test(userAgent)) return 'Navegador en Windows';
  if (/Mac OS/i.test(userAgent)) return 'Navegador en Mac';
  if (/Linux/i.test(userAgent)) return 'Navegador en Linux';
  return userAgent.slice(0, 40);
}

/**
 * Sesiones activas (`ADR-025`). Cerrar una sesión invalida su token de inmediato.
 * La sesión de ESTE dispositivo no se puede cerrar desde aquí: para eso está
 * «Cerrar sesión» en el perfil.
 */
export default function Sessions() {
  const [items, setItems] = useState<ActiveSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cargar tus sesiones.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function confirmClose(session: ActiveSession) {
    Alert.alert('Cerrar esta sesión', `${describeDevice(session.user_agent)} dejará de tener acceso.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await closeSession(session.id);
            await load();
          } catch (e) {
            Alert.alert('No se pudo cerrar', e instanceof ApiError ? e.message : 'Inténtalo de nuevo.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  function confirmCloseOthers() {
    Alert.alert('Cerrar las demás sesiones', 'Todos los otros dispositivos perderán el acceso.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar las demás',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await closeOtherSessions();
            await load();
          } catch (e) {
            Alert.alert('No se pudo cerrar', e instanceof ApiError ? e.message : 'Inténtalo de nuevo.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  const others = items?.filter((s) => !s.is_current) ?? [];

  return (
    <Screen title="Sesiones activas" back>
      {error && items ? <Banner tone="error">{error}</Banner> : null}

      {items === null ? (
        error ? (
          <StateMessage kind="error" message={error} actionLabel="Reintentar" onAction={load} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : (
        <>
          {items.map((session) => (
            <View key={session.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.device}>
                  {describeDevice(session.user_agent)}
                  {session.is_current ? '  · este dispositivo' : ''}
                </Text>
                <Text style={styles.meta}>
                  Último uso: {session.last_used_at ? formatRelativeTime(session.last_used_at) : 'sin registro'}
                  {session.ip_address ? ` · IP ${session.ip_address}` : ''}
                </Text>
              </View>
              {!session.is_current ? (
                <Button label="Cerrar" variant="secondary" onPress={() => confirmClose(session)} disabled={busy} />
              ) : null}
            </View>
          ))}

          {others.length > 0 ? (
            <Button
              label="Cerrar todas las demás"
              variant="danger"
              onPress={confirmCloseOthers}
              loading={busy}
              style={styles.closeAll}
            />
          ) : (
            <Text style={styles.note}>No hay otras sesiones abiertas.</Text>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[4],
    marginBottom: space[2],
    gap: space[3],
  },
  rowText: { flex: 1 },
  device: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  meta: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: 2, lineHeight: 17 },
  closeAll: { marginTop: space[4] },
  note: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: space[4], textAlign: 'center' },
}));
