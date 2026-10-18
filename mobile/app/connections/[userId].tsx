import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import { followUser, unfollowUser } from '@features/posts/api';
import { messageOf } from '@features/posts/PostsContext';
import { fetchConnections } from '@features/profile/connections';
import type { Connection, ConnectionKind } from '@features/profile/connections';
import { ApiError } from '@shared/lib/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

const TABS: { id: ConnectionKind; label: string }[] = [
  { id: 'followers', label: 'Seguidores' },
  { id: 'following', label: 'Siguiendo' },
];

/**
 * Seguidores y seguidos de una persona (`ADR-050`), la propia o la de otra. Cada fila lleva a su perfil
 * y permite seguir o dejar de seguir. En una cuenta privada que no sigues el servidor no entrega la
 * lista (403) y se explica.
 */
export default function Connections() {
  const params = useLocalSearchParams<{ userId: string; tab?: string; username?: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<ConnectionKind>(params.tab === 'following' ? 'following' : 'followers');
  const [items, setItems] = useState<Connection[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setItems(null);
    setError(null);
    try {
      const page = await fetchConnections(params.userId, tab, 0);
      if (mine !== seq.current) return;
      setItems(page.users);
      setHasMore(page.has_more);
    } catch (e) {
      if (mine !== seq.current) return;
      setError({ message: messageOf(e), denied: e instanceof ApiError && e.status === 403 });
    }
  }, [params.userId, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!hasMore || loadingMore || !items) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const page = await fetchConnections(params.userId, tab, items.length);
      if (mine !== seq.current) return;
      setItems((current) => {
        const known = new Set((current ?? []).map((p) => p.id));
        return [...(current ?? []), ...page.users.filter((p) => !known.has(p.id))];
      });
      setHasMore(page.has_more);
    } catch {
      // Se reintenta al volver a llegar al final.
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleFollow(person: Connection) {
    const apply = (status: Connection['follow_status']) =>
      setItems((current) => current?.map((p) => (p.id === person.id ? { ...p, follow_status: status } : p)) ?? current);
    try {
      const result =
        person.follow_status === null ? await followUser(person.id) : await unfollowUser(person.id);
      apply(result.follow_status);
    } catch (e) {
      Alert.alert('No se pudo actualizar el seguimiento', messageOf(e));
    }
  }

  return (
    <Screen title={params.username ? `@${params.username}` : 'Conexiones'} back scroll={false}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            style={[styles.tab, tab === t.id && styles.tabOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t.id }}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {items === null ? (
        error ? (
          <StateMessage
            kind="error"
            title={error.denied ? 'Esta cuenta es privada' : undefined}
            message={error.denied ? 'Sigue a esta cuenta para ver a quién sigue y quién la sigue.' : error.message}
            actionLabel={error.denied ? undefined : 'Reintentar'}
            onAction={error.denied ? undefined : load}
          />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            <StateMessage
              kind="empty"
              title={tab === 'followers' ? 'Sin seguidores todavía' : 'No sigue a nadie todavía'}
            />
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={colors.brand} /> : null}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                item.is_me
                  ? router.push('/profile')
                  : router.push({ pathname: '/user/[userId]', params: { userId: item.id } })
              }
              style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={`Ver el perfil de ${item.name}`}
            >
              <Avatar name={item.name} uri={item.avatar_url} size={48} />
              <View style={styles.text}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.username} numberOfLines={1}>
                  @{item.username}
                </Text>
              </View>
              {!item.is_me ? (
                <Pressable
                  onPress={() => toggleFollow(item)}
                  style={[styles.followBtn, item.follow_status ? styles.followBtnOn : null]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.followText, item.follow_status ? styles.followTextOn : null]}>
                    {item.follow_status === 'accepted'
                      ? 'Siguiendo'
                      : item.follow_status === 'pending'
                        ? 'Solicitado'
                        : item.is_private
                          ? 'Solicitar'
                          : 'Seguir'}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space[3], borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.brandText },
  tabText: { fontSize: fontSize.bodyMd, fontWeight: '600', color: colors.fgMuted },
  tabTextOn: { color: colors.brandText },
  list: { padding: space[4], paddingBottom: space[8] },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space[2] },
  text: { flex: 1, marginHorizontal: space[3] },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  username: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  followBtn: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  followBtnOn: { borderColor: colors.borderStrong, backgroundColor: colors.bgSubtle },
  followText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  followTextOn: { color: colors.fgSecondary },
  more: { padding: space[4] },
}));
