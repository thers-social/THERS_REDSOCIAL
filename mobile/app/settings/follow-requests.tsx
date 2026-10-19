import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { ProfileLink } from '@features/profile/ProfileLink';
import { useLanguage } from '@shared/i18n';
import { useOpenProfile } from '@features/profile/useOpenProfile';
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
  const openProfile = useOpenProfile();
  const { t } = useLanguage();
  const [items, setItems] = useState<FollowRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchFollowRequests());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('requests.error.load'));
    }
  }, [t]);

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
      Alert.alert(t('requests.error.respond'), e instanceof ApiError ? e.message : t('common.tryAgain'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen title={t('requests.title')} back>
      {items === null ? (
        error ? (
          <StateMessage kind="error" message={error} actionLabel={t('common.retry')} onAction={load} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : items.length === 0 ? (
        <StateMessage kind="empty" title={t('requests.empty.title')} message={t('requests.empty.body')} />
      ) : (
        items.map((request) => (
          <View key={request.user.id} style={styles.row}>
            <ProfileLink userId={request.user.id} name={request.user.name} style={{ flex: 0, alignItems: 'flex-start' }}>
              <Avatar name={request.user.name} size={44} />
            </ProfileLink>
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1} onPress={() => openProfile(request.user.id)}>
                {request.user.name}
              </Text>
              <Text style={styles.meta}>
                @{request.user.username} · {formatRelativeTime(request.requested_at)}
              </Text>
              <View style={styles.buttons}>
                <Button
                  label={t('requests.accept')}
                  onPress={() => respond(request, true)}
                  loading={busyId === request.user.id}
                  style={styles.flex}
                />
                <Button
                  label={t('requests.reject')}
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
