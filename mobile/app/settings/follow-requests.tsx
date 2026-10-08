import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { acceptFollowRequest, fetchFollowRequests, rejectFollowRequest } from '@features/settings/api';
import type { FollowRequest } from '@features/settings/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { formatRelativeTime } from '@shared/lib/time';
import { Avatar } from '@shared/ui/Avatar';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/** Solicitudes pendientes de seguirte (`ADR-022`, cuentas privadas). */
export default function FollowRequests() {
  const [items, setItems] = useState<FollowRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchFollowRequests());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cargar tus solicitudes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(request: FollowRequest, accept: boolean) {
    setBusyId(request.user.id);
    try {
      if (accept) await acceptFollowRequest(request.user.id);
      else await rejectFollowRequest(request.user.id);
      setItems((current) => current?.filter((r) => r.user.id !== request.user.id) ?? current);
    } catch (e) {
      Alert.alert('No se pudo responder', e instanceof ApiError ? e.message : 'Inténtalo de nuevo.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen title="Solicitudes de seguimiento" back>
      {items === null ? (
        error ? (
          <StateMessage kind="error" message={error} actionLabel="Reintentar" onAction={load} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : items.length === 0 ? (
        <StateMessage kind="empty" title="Sin solicitudes" message="Aquí aparecen quienes quieren seguirte cuando tu cuenta es privada." />
      ) : (
        items.map((request) => (
          <View key={request.user.id} style={styles.row}>
            <Avatar name={request.user.name} size={44} />
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {request.user.name}
              </Text>
              <Text style={styles.meta}>
                @{request.user.username} · {formatRelativeTime(request.requested_at)}
              </Text>
              <View style={styles.buttons}>
                <Button
                  label="Aceptar"
                  onPress={() => respond(request, true)}
                  loading={busyId === request.user.id}
                  style={styles.flex}
                />
                <Button
                  label="Rechazar"
                  variant="secondary"
                  onPress={() => respond(request, false)}
                  disabled={busyId === request.user.id}
                  style={styles.flex}
                />
              </View>
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[3],
    marginBottom: space[2],
    gap: space[3],
  },
  text: { flex: 1 },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  meta: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  flex: { flex: 1, paddingHorizontal: space[2] },
}));
