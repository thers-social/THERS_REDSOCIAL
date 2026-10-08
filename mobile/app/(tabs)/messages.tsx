import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { fetchConversations } from '@features/messages/api';
import type { ConversationSummary } from '@features/messages/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { comingSoon } from '@shared/lib/comingSoon';
import { formatRelativeTime } from '@shared/lib/time';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

const REFRESH_MS = 15000;
/** Una persona cuenta «en línea» si estuvo activa en los últimos 5 minutos (y permite mostrarlo). */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

type Filter = 'all' | 'unread';

/**
 * Lista de conversaciones (`GET /api/conversations`). Se actualiza por consulta
 * periódica, SOLO mientras esta pestaña está enfocada y la app en primer plano.
 * Una conversación se abre desde aquí o desde el menú «⋯» de una publicación
 * («Enviar mensaje»): el servidor no tiene un directorio de personas para
 * empezar una desde cero.
 */
export default function Messages() {
  const { user } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const focused = useRef(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (item) =>
        (filter === 'all' || item.unread_count > 0) &&
        (!q || item.user.name.toLowerCase().includes(q) || item.user.username.toLowerCase().includes(q)),
    );
  }, [items, query, filter]);
  const unreadTotal = useMemo(
    () => (items ?? []).reduce((sum, item) => sum + item.unread_count, 0),
    [items],
  );

  const load = useCallback(async () => {
    try {
      setItems(await fetchConversations());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cargar tus mensajes.');
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

  // Al volver de segundo plano se actualiza al instante.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused.current) void load();
    });
    return () => sub.remove();
  }, [load]);

  if (!user) return null;

  return (
    <Screen
      title="Mensajes"
      scroll={false}
      withBottomInset={false}
      headerRight={
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => comingSoon('Los chats de grupo')}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Grupos (próximamente)"
          >
            <Icon name="group" size={20} color={colors.fg} />
          </Pressable>
          <Pressable
            onPress={() => comingSoon('Más opciones de mensajes')}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Más opciones (próximamente)"
          >
            <Icon name="more" size={20} color={colors.fg} />
          </Pressable>
        </View>
      }
    >
      <FlatList
        data={visible}
        keyExtractor={(item) => item.user.id}
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
        ListHeaderComponent={
          <View>
            <View style={styles.search}>
              <Icon name="search" size={18} color={colors.fgMuted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar personas o chats…"
                placeholderTextColor={colors.fgDisabled}
                accessibilityLabel="Buscar en tus conversaciones"
                autoCorrect={false}
              />
              <Icon name="filter" size={18} color={colors.fgMuted} />
            </View>
            <View style={styles.chips}>
              {(
                [
                  ['all', 'Todos'],
                  ['unread', unreadTotal > 0 ? `Sin leer · ${unreadTotal}` : 'Sin leer'],
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  onPress={() => setFilter(id)}
                  style={[styles.chip, filter === id && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === id }}
                >
                  <Text style={[styles.chipText, filter === id && styles.chipTextOn]}>{label}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => comingSoon('Los chats de grupo')}
                style={styles.chip}
                accessibilityRole="button"
                accessibilityHint="Próximamente"
              >
                <Text style={styles.chipText}>Grupos</Text>
              </Pressable>
            </View>
            <Text style={styles.note}>
              Chat privado de texto. Los mensajes no están cifrados de extremo a extremo.
            </Text>
          </View>
        }
        ListEmptyComponent={
          items === null && !error ? (
            <StateMessage kind="loading" message="Cargando conversaciones…" />
          ) : error && items === null ? (
            <StateMessage
              kind="error"
              title="No pudimos cargar tus mensajes"
              message={error}
              actionLabel="Reintentar"
              onAction={load}
            />
          ) : (items?.length ?? 0) > 0 ? (
            <StateMessage
              kind="empty"
              title="Sin resultados"
              message="Prueba con otro nombre o cambia el filtro."
            />
          ) : (
            <StateMessage
              kind="empty"
              title="Todavía no tienes conversaciones"
              message="Toca «⋯» en una publicación y elige «Enviar mensaje» para escribirle a alguien."
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.row,
              item.unread_count > 0 && styles.rowUnread,
              pressed && styles.rowPressed,
            ]}
            onPress={() =>
              router.push({
                pathname: '/chat/[userId]',
                params: {
                  userId: item.user.id,
                  name: item.user.name,
                  username: item.user.username,
                  avatar: item.user.avatar_url ?? '',
                },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`Conversación con ${item.user.name}${
              item.unread_count > 0 ? `, ${item.unread_count} sin leer` : ''
            }`}
          >
            <View>
              <Avatar name={item.user.name} uri={item.user.avatar_url} size={48} />
              {item.user.last_seen_at &&
              Date.now() - new Date(item.user.last_seen_at).getTime() < ONLINE_WINDOW_MS ? (
                <View style={styles.online} accessibilityLabel="En línea" />
              ) : null}
            </View>
            <View style={styles.rowText}>
              <View style={styles.rowTop}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.user.name}
                </Text>
              </View>
              <Text
                style={[styles.preview, item.unread_count > 0 && styles.previewUnread]}
                numberOfLines={1}
              >
                {item.last_message.sender_id === user.id ? 'Tú: ' : ''}
                {item.last_message.content}
              </Text>
            </View>
            <View style={styles.rowEnd}>
              <Text style={styles.time}>{formatRelativeTime(item.last_message.created_at)}</Text>
              {item.unread_count > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  list: { padding: space[4], paddingBottom: space[8] },
  note: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginBottom: space[3] },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    marginBottom: space[3],
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: fontSize.bodyMd, color: colors.fg, padding: 0 },
  chips: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: fontSize.labelLg, fontWeight: '600', color: colors.fgSecondary },
  chipTextOn: { color: colors.onBrand },
  online: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.successAccent,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Filas separadas por un hilo sutil, como en las capturas aprobadas.
    backgroundColor: 'transparent',
    padding: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  rowEnd: { alignItems: 'flex-end', gap: space[1] },
  headerActions: { flexDirection: 'row', gap: space[2] },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowPressed: { backgroundColor: colors.surface },
  rowUnread: { backgroundColor: colors.brandSoft },
  rowText: { flex: 1, marginHorizontal: space[3] },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  name: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  time: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginLeft: space[2] },
  preview: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2 },
  previewUnread: { color: colors.fg, fontWeight: '600' },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.onBrand, fontSize: fontSize.labelMd, fontWeight: '700' },
}));
