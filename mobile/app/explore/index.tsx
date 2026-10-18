import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View, useWindowDimensions } from 'react-native';

import { fetchExplore } from '@features/explore/api';
import type { ExploreKind } from '@features/explore/api';
import { messageOf, usePosts } from '@features/posts/PostsContext';
import type { Post } from '@features/posts/types';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

const COLUMNS = 3;
const GAP = 2;

const FILTERS: { id: ExploreKind; label: string }[] = [
  { id: 'all', label: 'Para ti' },
  { id: 'images', label: 'Fotos' },
  { id: 'videos', label: 'Videos' },
];

/**
 * Explorar (`ADR-050`): cuadrícula de fotos y videos populares de personas que no sigues, como el
 * Explorar de Instagram. Tocar una miniatura abre la publicación (con sus comentarios). Se pagina al
 * llegar al final y se actualiza arrastrando hacia abajo.
 */
export default function Explore() {
  const router = useRouter();
  const { adopt } = usePosts();
  const { width } = useWindowDimensions();
  const size = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  const [kind, setKind] = useState<ExploreKind>('all');
  const [items, setItems] = useState<Post[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Descarta respuestas de un filtro o una recarga anteriores.
  const seq = useRef(0);

  const load = useCallback(
    async (pull = false) => {
      const mine = ++seq.current;
      if (pull) setRefreshing(true);
      else setItems(null);
      try {
        const page = await fetchExplore(kind, 0);
        if (mine !== seq.current) return;
        setItems(page.posts);
        setHasMore(page.has_more);
        setError(null);
      } catch (e) {
        if (mine !== seq.current) return;
        setError(messageOf(e));
      } finally {
        if (mine === seq.current) setRefreshing(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!hasMore || loadingMore || !items) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const page = await fetchExplore(kind, items.length);
      if (mine !== seq.current) return;
      setItems((current) => {
        const known = new Set((current ?? []).map((p) => p.id));
        return [...(current ?? []), ...page.posts.filter((p) => !known.has(p.id))];
      });
      setHasMore(page.has_more);
    } catch {
      // Un fallo al paginar no vacía lo ya cargado; se reintenta al volver a llegar al final.
    } finally {
      setLoadingMore(false);
    }
  }

  function open(post: Post) {
    adopt([post]);
    router.push({ pathname: '/post/[id]', params: { id: post.id } });
  }

  return (
    <Screen title="Explorar" back scroll={false} withBottomInset={false}>
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setKind(f.id)}
            style={[styles.chip, kind === f.id && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === f.id }}
          >
            <Text style={[styles.chipText, kind === f.id && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {items === null ? (
        error ? (
          <StateMessage kind="error" message={error} actionLabel="Reintentar" onAction={() => load()} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : (
        <FlatList
          key={kind}
          data={items}
          numColumns={COLUMNS}
          keyExtractor={(post) => post.id}
          columnWrapperStyle={{ gap: GAP }}
          ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          ListEmptyComponent={
            <StateMessage
              kind="empty"
              title="Aún no hay nada que explorar"
              message="Cuando otras personas publiquen fotos o videos, aparecerán aquí."
            />
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={colors.brand} /> : null}
          renderItem={({ item }) => <Tile post={item} size={size} onPress={() => open(item)} />}
        />
      )}
    </Screen>
  );
}

function Tile({ post, size, onPress }: { post: Post; size: number; onPress: () => void }) {
  const uri = post.video?.thumbnail_url ?? post.images?.[0]?.url;
  const several = (post.images?.length ?? 0) > 1;
  return (
    <Pressable
      onPress={onPress}
      style={{ width: size, height: size, backgroundColor: colors.surface }}
      accessibilityRole="button"
      accessibilityLabel={`${post.video ? 'Video' : 'Foto'} de ${post.author.name}`}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.fill} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : null}
      {post.video || several ? (
        <View style={styles.badge}>
          <Icon name={post.video ? 'play' : 'grid'} size={14} color="#fff" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  chips: { flexDirection: 'row', gap: space[2], padding: space[3] },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: fontSize.labelLg, color: colors.fgSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.onBrand },
  fill: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    top: space[1],
    right: space[1],
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    padding: 4,
  },
  more: { padding: space[4] },
}));
