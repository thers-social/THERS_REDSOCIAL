import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import {
  describeNotification,
  fetchNotifications,
  markNotificationRead,
} from '@features/notifications/api';
import type { AppNotification } from '@features/notifications/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { formatRelativeTime } from '@shared/lib/time';
import { Avatar } from '@shared/ui/Avatar';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

const REFRESH_MS = 30000;

/**
 * Avisos dentro de la app (`GET /api/notifications`). NO son notificaciones push:
 * son filas del servidor que se consultan al abrir la pestaña y cada 30 s mientras
 * está a la vista. Las push (avisos con la app cerrada) son una fase posterior.
 */
export default function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const focused = useRef(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchNotifications());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cargar tus avisos.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void load();
      const timer = setInterval(() => {
        if (focused.current && AppState.currentState === 'active') void load();
      }, REFRESH_MS);
      return () => {
        focused.current = false;
        clearInterval(timer);
      };
    }, [load]),
  );

  async function open(item: AppNotification) {
    if (!item.read) {
      // Optimista: el punto desaparece al instante; si falla, la próxima carga lo corrige.
      setItems((current) => current?.map((n) => (n.id === item.id ? { ...n, read: true } : n)) ?? current);
      markNotificationRead(item.id).catch(() => undefined);
    }
    if (item.post_id) router.push({ pathname: '/post/[id]', params: { id: item.post_id } });
  }

  const unread = items?.filter((n) => !n.read).length ?? 0;

  return (
    <Screen
      back
      title="Avisos"
      scroll={false}
      withBottomInset={false}
      headerRight={unread > 0 ? <Text style={styles.unread}>{unread} sin leer</Text> : null}
    >
      <FlatList
        data={items ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.brand}
          />
        }
        ListEmptyComponent={
          items === null && !error ? (
            <StateMessage kind="loading" message="Cargando avisos…" />
          ) : error && items === null ? (
            <StateMessage
              kind="error"
              title="No pudimos cargar tus avisos"
              message={error}
              actionLabel="Reintentar"
              onAction={load}
            />
          ) : (
            <StateMessage kind="empty" title="Sin avisos" message="Aquí verás me gusta, comentarios y nuevos seguidores." />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, !item.read && styles.rowUnread, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${item.actor.name} ${describeNotification(item.type)}${item.read ? '' : ', sin leer'}`}
          >
            <Avatar name={item.actor.name} uri={item.actor.avatar_url} size={44} />
            <View style={styles.text}>
              <Text style={styles.body}>
                <Text style={styles.actor}>{item.actor.name}</Text> {describeNotification(item.type)}
              </Text>
              <Text style={styles.time}>{formatRelativeTime(item.created_at)}</Text>
            </View>
            {!item.read ? <View style={styles.dot} accessibilityElementsHidden /> : null}
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  list: { padding: space[4], paddingBottom: space[8] },
  unread: { fontSize: fontSize.labelMd, color: colors.brandText, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[3],
    marginBottom: space[2],
  },
  rowUnread: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoftStrong },
  rowPressed: { opacity: 0.8 },
  text: { flex: 1, marginHorizontal: space[3] },
  body: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 20 },
  actor: { fontWeight: '700' },
  time: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
}));
