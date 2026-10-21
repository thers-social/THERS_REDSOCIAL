import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@features/auth/context/AuthContext';
import { followUser } from '@features/posts/api';
import {
  deleteVideo,
  fetchFeed,
  fetchMine,
  fetchSaved,
  fetchVideo,
  setLike,
  setSave,
} from '@features/videos/api';
import { ReelComments } from '@features/videos/ReelComments';
import { ReelSlide } from '@features/videos/ReelSlide';
import { ReelUploadSheet } from '@features/videos/ReelUploadSheet';
import { POLL_INTERVAL_MS, isInProgress, mergeVideos, reelUrl, withLike, withSaved } from '@features/videos/reelsLogic';
import type { ReelVideo } from '@features/videos/types';
import { ApiError } from '@shared/lib/api';
import { Icon } from '@shared/ui/Icon';

/** Origen de la web: el enlace compartido abre ese Reel primero (la web lee `?v=<id>`). No es un secreto. */
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? 'https://staging.thersweb.com').replace(/\/$/, '');

type Tab = 'foryou' | 'saved';

/**
 * Reels (ADR-043, ADR-043-A, ADR-055): video vertical a pantalla completa, uno por pantalla, con paso por
 * deslizamiento como TikTok o Instagram. Con el módulo apagado en el servidor (`VIDEOS_ENABLED`) la API
 * responde 404 y la pestaña muestra «Próximamente». Nada de esto concede permisos: el servidor lo
 * comprueba siempre.
 *
 * Reproducción con `expo-video` (módulo nativo, exige recompilar). Solo hay reproductores montados para el
 * Reel activo y sus dos vecinos.
 */
export default function Reels() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const focused = useIsFocused();
  const [tab, setTab] = useState<Tab>('foryou');
  const [state, setState] = useState<'loading' | 'ready' | 'off' | 'error'>('loading');
  const [feed, setFeed] = useState<ReelVideo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [mine, setMine] = useState<ReelVideo[]>([]);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(false);
  const [height, setHeight] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const loadingMore = useRef(false);
  const refreshedAt = useRef(new Map<string, number>());

  const loadMine = useCallback(async () => {
    try {
      setMine(await fetchMine());
    } catch {
      /* secundario */
    }
  }, []);

  const loadFeed = useCallback(async (offset: number, which: Tab) => {
    try {
      const data = which === 'saved' ? await fetchSaved(offset) : await fetchFeed(offset);
      setFeed((current) => (offset ? mergeVideos(current, data.videos) : data.videos));
      setHasMore(data.has_more);
      setState('ready');
    } catch (e) {
      if (!offset) setState(e instanceof ApiError && e.status === 404 ? 'off' : 'error');
    } finally {
      loadingMore.current = false;
    }
  }, []);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  // Cambia de pestaña (o primera carga): vuelve al primer Reel.
  useEffect(() => {
    setState('loading');
    setActive(0);
    void loadFeed(0, tab);
  }, [tab, loadFeed]);

  // Mientras algo propio se sube o procesa se consulta su estado; al publicarse entra al feed.
  useEffect(() => {
    if (!mine.some(isInProgress)) return undefined;
    const timer = setInterval(() => void loadMine(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [mine, loadMine]);

  // Al acercarse al final se pide la página siguiente.
  useEffect(() => {
    if (state !== 'ready' || !hasMore || loadingMore.current || active < feed.length - 3) return;
    loadingMore.current = true;
    void loadFeed(feed.length, tab);
  }, [active, feed.length, hasMore, state, tab, loadFeed]);

  const patchVideo = useCallback((id: string, change: (video: ReelVideo) => ReelVideo) => {
    setFeed((current) => current.map((video) => (video.id === id ? change(video) : video)));
  }, []);

  async function handleLike(video: ReelVideo) {
    const next = !video.liked_by_me;
    patchVideo(video.id, (v) => withLike(v, next));
    try {
      await setLike(video.id, next);
    } catch {
      patchVideo(video.id, (v) => withLike(v, !next));
      Alert.alert('No se pudo actualizar tu me gusta');
    }
  }

  async function handleSave(video: ReelVideo) {
    const next = !video.saved_by_me;
    patchVideo(video.id, (v) => withSaved(v, next));
    try {
      await setSave(video.id, next);
    } catch {
      patchVideo(video.id, (v) => withSaved(v, !next));
      Alert.alert('No se pudo guardar el Reel');
    }
  }

  async function handleShare(video: ReelVideo) {
    try {
      await Share.share({ message: `Mira este Reel de @${video.author.username} en THERS\n${reelUrl(WEB_URL, video.id)}` });
    } catch {
      Alert.alert('No se pudo compartir el Reel');
    }
  }

  async function handleFollow(video: ReelVideo) {
    try {
      const result = await followUser(video.author.id);
      const pending = result.follow_status === 'pending';
      setFeed((current) =>
        current.map((item) =>
          item.author.id === video.author.id
            ? { ...item, author: { ...item.author, is_following: !pending && result.following, follow_pending: pending } }
            : item,
        ),
      );
    } catch {
      Alert.alert('No se pudo seguir a esta persona');
    }
  }

  const handleCommentsCount = useCallback(
    (id: string, delta: number) => {
      patchVideo(id, (v) => ({ ...v, comments_count: Math.max(0, (v.comments_count ?? 0) + delta) }));
    },
    [patchVideo],
  );

  // El enlace firmado dura 1 hora: si falla la reproducción se pide uno nuevo (como mucho una vez por minuto).
  const handleExpired = useCallback(
    async (id: string) => {
      const last = refreshedAt.current.get(id) ?? 0;
      if (Date.now() - last < 60_000) return;
      refreshedAt.current.set(id, Date.now());
      try {
        const fresh = await fetchVideo(id);
        patchVideo(id, () => fresh);
      } catch {
        /* sigue sin poder reproducirse */
      }
    },
    [patchVideo],
  );

  async function handleDeleted(id: string) {
    setMine((current) => current.filter((v) => v.id !== id));
    setFeed((current) => current.filter((v) => v.id !== id));
  }

  function onLayout(event: LayoutChangeEvent) {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next > 0 && next !== height) setHeight(next);
  }

  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!height) return;
    setActive(Math.max(0, Math.round(event.nativeEvent.contentOffset.y / height)));
  }

  const commentsVideo = commentsFor ? feed.find((video) => video.id === commentsFor) : undefined;

  let body;
  if (state === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color="#ffffff" size="large" />
      </View>
    );
  } else if (state === 'off') {
    body = (
      <View style={styles.center}>
        <Text style={styles.centerTitle}>Próximamente</Text>
        <Text style={styles.centerText}>Reels, el video vertical de THERS, llegará pronto.</Text>
      </View>
    );
  } else if (state === 'error') {
    body = (
      <View style={styles.center}>
        <Text style={styles.centerTitle}>No se pudieron cargar los Reels</Text>
        <Pressable onPress={() => void loadFeed(0, tab)} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  } else if (feed.length === 0) {
    body = (
      <View style={styles.center}>
        <Text style={styles.centerText}>{tab === 'saved' ? 'Todavía no guardaste ningún Reel.' : 'Todavía no hay Reels para mostrar.'}</Text>
      </View>
    );
  } else if (height > 0) {
    body = (
      <FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={height}
        snapToAlignment="start"
        disableIntervalMomentum
        getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
        onMomentumScrollEnd={onScrollEnd}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        extraData={[active, muted, focused]}
        renderItem={({ item, index }) => (
          <ReelSlide
            video={item}
            active={index === active && focused && !uploadOpen}
            near={Math.abs(index - active) <= 1}
            muted={muted}
            height={height}
            currentUserId={user?.id}
            onMutedChange={setMuted}
            onLike={handleLike}
            onSave={handleSave}
            onShare={handleShare}
            onFollow={handleFollow}
            onOpenComments={(video) => setCommentsFor(video.id)}
            onOpenAuthor={(video) => router.push(`/user/${video.author.id}`)}
            onExpired={handleExpired}
          />
        )}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.stage} onLayout={onLayout}>
        {body}
      </View>

      {state === 'ready' || state === 'loading' || state === 'error' ? (
        <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <View style={styles.tabs}>
            {(
              [
                ['foryou', 'Para ti'],
                ['saved', 'Guardados'],
              ] as const
            ).map(([id, label]) => (
              <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={[styles.tab, tab === id && styles.tabOn]}>
                <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setUploadOpen(true)} accessibilityRole="button" accessibilityLabel="Subir un Reel" style={styles.upload}>
            <Icon name="plus" size={18} color="#ffffff" />
            <Text style={styles.uploadText}>Subir</Text>
          </Pressable>
        </View>
      ) : null}

      {commentsVideo ? (
        <ReelComments
          videoId={commentsVideo.id}
          count={commentsVideo.comments_count ?? 0}
          onClose={() => setCommentsFor(null)}
          onCountChange={(delta) => handleCommentsCount(commentsVideo.id, delta)}
        />
      ) : null}

      {uploadOpen ? (
        <ReelUploadSheet
          mine={mine}
          onClose={() => setUploadOpen(false)}
          onChanged={() => {
            void loadMine();
            if (tab === 'foryou') void loadFeed(0, 'foryou');
          }}
          onDeleted={(id) => void handleDeleted(id)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  centerText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center' },
  retry: { backgroundColor: '#7c3aed', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, padding: 4 },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  tabOn: { backgroundColor: '#7c3aed' },
  tabText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: '#fff' },
  upload: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  uploadText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
