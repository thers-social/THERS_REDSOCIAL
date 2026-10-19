import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { addCloseFriend, fetchCloseFriends, removeCloseFriend } from '@features/closeFriends/api';
import type { CloseFriend } from '@features/closeFriends/api';
import { fetchConnections } from '@features/profile/connections';
import type { Connection } from '@features/profile/connections';
import { ProfileLink } from '@features/profile/ProfileLink';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { ApiError } from '@shared/lib/api';
import { Avatar } from '@shared/ui/Avatar';
import { Button } from '@shared/ui/Button';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

type Person = { id: string; name: string; username: string; avatar_url: string | null };

/**
 * Mejores amigos (`ADR-054`): una lista PRIVADA de personas. Tus historias marcadas «Mejores amigos» solo
 * las ven ellas (y solo si te siguen). No se avisa a nadie de que lo añadiste ni de que lo quitaste. Para
 * elegir se ofrecen tus seguidores, que son quienes pueden llegar a ver tus historias.
 */
export default function CloseFriends() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [friends, setFriends] = useState<CloseFriend[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [followers, setFollowers] = useState<Connection[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [list, page] = await Promise.all([fetchCloseFriends(), fetchConnections(user.id, 'followers', 0)]);
      setFriends(list.friends);
      setLimit(list.limit);
      setFollowers(page.users);
      setHasMore(page.has_more);
      setError(null);
    } catch (e) {
      // 404: las historias están apagadas en el servidor y Mejores amigos con ellas.
      if (e instanceof ApiError && e.status === 404) setUnavailable(true);
      else setError(e instanceof ApiError ? e.message : t('closeFriends.error.load'));
    }
  }, [user, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!user) return;
    try {
      const page = await fetchConnections(user.id, 'followers', followers.length);
      setFollowers((current) => [...current, ...page.users.filter((p) => !current.some((c) => c.id === p.id))]);
      setHasMore(page.has_more);
    } catch {
      // Se reintenta con el mismo botón.
    }
  }

  async function add(person: Person) {
    setBusyId(person.id);
    try {
      await addCloseFriend(person.id);
      setFriends((current) => [
        { ...person, added_at: new Date().toISOString() },
        ...(current ?? []).filter((f) => f.id !== person.id),
      ]);
    } catch (e) {
      Alert.alert(t('closeFriends.error.add'), e instanceof ApiError ? e.message : t('common.tryAgain'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(person: Person) {
    setBusyId(person.id);
    try {
      await removeCloseFriend(person.id);
      setFriends((current) => current?.filter((f) => f.id !== person.id) ?? current);
    } catch (e) {
      Alert.alert(t('closeFriends.error.remove'), e instanceof ApiError ? e.message : t('common.tryAgain'));
    } finally {
      setBusyId(null);
    }
  }

  const needle = query.trim().toLowerCase();
  const matches = (p: Person) =>
    !needle || p.name.toLowerCase().includes(needle) || p.username.toLowerCase().includes(needle);

  const listIds = useMemo(() => new Set((friends ?? []).map((f) => f.id)), [friends]);
  const shownFriends = (friends ?? []).filter(matches);
  const candidates = followers.filter((f) => !f.is_me && !listIds.has(f.id) && matches(f));
  const full = friends !== null && limit > 0 && friends.length >= limit;

  return (
    <Screen title={t('closeFriends.title')} back>
      {unavailable ? (
        <StateMessage kind="empty" title={t('closeFriends.unavailable.title')} message={t('closeFriends.unavailable.body')} />
      ) : friends === null ? (
        error ? (
          <StateMessage kind="error" message={error} actionLabel={t('common.retry')} onAction={load} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : (
        <>
          <Text style={styles.intro}>{t('closeFriends.intro')}</Text>

          <View style={styles.search}>
            <Icon name="search" size={18} color={colors.fgMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('closeFriends.search')}
              placeholderTextColor={colors.fgDisabled}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t('closeFriends.search')}
            />
          </View>

          <Text style={styles.section}>{t('closeFriends.yourList', { count: friends.length })}</Text>
          {shownFriends.length === 0 ? (
            <Text style={styles.empty}>{friends.length === 0 ? t('closeFriends.empty') : t('closeFriends.noMatches')}</Text>
          ) : (
            shownFriends.map((person) => (
              <View key={person.id} style={styles.row}>
                <ProfileLink userId={person.id} name={person.name}>
                  <Avatar name={person.name} uri={person.avatar_url} size={44} />
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {person.name}
                    </Text>
                    <Text style={styles.username} numberOfLines={1}>
                      @{person.username}
                    </Text>
                  </View>
                </ProfileLink>
                <Button
                  label={t('closeFriends.remove')}
                  variant="secondary"
                  onPress={() => remove(person)}
                  disabled={busyId === person.id}
                />
              </View>
            ))
          )}

          <Text style={styles.section}>{t('closeFriends.followers')}</Text>
          {full ? <Text style={styles.empty}>{t('closeFriends.full', { limit })}</Text> : null}
          {candidates.length === 0 ? (
            <Text style={styles.empty}>{t('closeFriends.followers.empty')}</Text>
          ) : (
            candidates.map((person) => (
              <View key={person.id} style={styles.row}>
                <ProfileLink userId={person.id} name={person.name}>
                  <Avatar name={person.name} uri={person.avatar_url} size={44} />
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {person.name}
                    </Text>
                    <Text style={styles.username} numberOfLines={1}>
                      @{person.username}
                    </Text>
                  </View>
                </ProfileLink>
                <Button
                  label={t('closeFriends.add')}
                  onPress={() => add(person)}
                  disabled={busyId === person.id || full}
                />
              </View>
            ))
          )}
          {hasMore ? (
            <Pressable onPress={loadMore} style={styles.more} accessibilityRole="button">
              <Text style={styles.moreText}>{t('common.seeMore')}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  intro: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginBottom: space[4], lineHeight: 20 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    paddingHorizontal: space[3],
    marginBottom: space[4],
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: fontSize.bodyMd, color: colors.fg, padding: 0 },
  section: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginTop: space[4], marginBottom: space[2] },
  empty: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginBottom: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[3],
    marginBottom: space[2],
    gap: space[3],
  },
  rowText: { flex: 1 },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  username: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  more: { alignItems: 'center', padding: space[3] },
  moreText: { color: colors.brandText, fontSize: fontSize.bodyMd, fontWeight: '600' },
}));
