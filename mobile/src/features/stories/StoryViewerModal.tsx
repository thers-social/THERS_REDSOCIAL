import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageOf } from '@features/posts/PostsContext';
import { useOpenProfile } from '@features/profile/useOpenProfile';
import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { formatRelativeTime } from '@shared/lib/time';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';

import { deleteStory, fetchUserStories, fetchViews, markViewed } from './api';
import {
  STORY_DURATION_MS,
  barFill,
  firstUnseenIndex,
  nextPosition,
  previousPosition,
} from './storyProgress';
import type { Position } from './storyProgress';
import type { Story, StoryViewer, StripAuthor } from './types';

const TICK_MS = 100;

type Loaded = { status: 'loading' | 'ready' | 'error'; stories: Story[] };
type ViewsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; count: number; views: StoryViewer[] };

type Props = {
  authors: StripAuthor[];
  startIndex: number;
  onClose: () => void;
  /** Algo cambió en el servidor (vista registrada o historia borrada): refrescar la tira. */
  onChanged: () => void;
};

/**
 * Visor de historias (ADR-042): pantalla completa, una persona tras otra. Toca el tercio
 * izquierdo para volver, el resto para avanzar; mantener pulsado pausa. Quien publicó ve cuántas
 * personas la vieron y puede borrarla.
 */
export function StoryViewerModal({ authors, startIndex, onClose, onChanged }: Props) {
  const insets = useSafeAreaInsets();
  const openProfile = useOpenProfile();
  const { t } = useLanguage();
  const [position, setPosition] = useState<Position>({ authorIndex: startIndex, storyIndex: 0 });
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [elapsed, setElapsed] = useState(0);
  const [holding, setHolding] = useState(false);
  const [views, setViews] = useState<ViewsState | null>(null);
  const [busy, setBusy] = useState(false);
  const viewed = useRef(new Set<string>());

  const strip = authors[position.authorIndex];
  const entry = loaded[strip.author.id];
  const stories = entry?.stories ?? [];
  const story = stories[position.storyIndex];
  const counts = authors.map((a, i) =>
    i === position.authorIndex && entry?.status === 'ready' ? stories.length : a.stories_count,
  );

  // Carga las historias de la persona actual la primera vez que se llega a ella.
  useEffect(() => {
    const id = strip.author.id;
    if (loaded[id]) return undefined;
    const controller = new AbortController();
    setLoaded((state) => ({ ...state, [id]: { status: 'loading', stories: [] } }));
    fetchUserStories(id, controller.signal)
      .then((list) => {
        setLoaded((state) => ({ ...state, [id]: { status: 'ready', stories: list } }));
        setPosition((current) =>
          current.authorIndex === position.authorIndex && current.storyIndex === 0
            ? { ...current, storyIndex: firstUnseenIndex(list) }
            : current,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoaded((state) => ({ ...state, [id]: { status: 'error', stories: [] } }));
        }
      });
    return () => controller.abort();
    // Solo al cambiar de persona.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.authorIndex]);

  const advance = useCallback(() => {
    const next = nextPosition(position, counts);
    if (next === null) {
      onClose();
      return;
    }
    setElapsed(0);
    setViews(null);
    setPosition(next);
    // `counts` se recalcula en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, onClose, entry?.status, stories.length]);

  const back = useCallback(() => {
    setElapsed(0);
    setViews(null);
    setPosition((current) => previousPosition(current, counts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.status, stories.length]);

  // Registrar la vista de las ajenas, una sola vez por historia mientras el visor está abierto.
  useEffect(() => {
    if (!story || strip.is_me || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    markViewed(story.id)
      .then(onChanged)
      .catch(() => viewed.current.delete(story.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // Avance automático (se pausa mientras se mantiene pulsado o se trabaja con el servidor).
  useEffect(() => {
    if (!story || holding || busy) return undefined;
    const id = setInterval(() => setElapsed((value) => value + TICK_MS), TICK_MS);
    return () => clearInterval(id);
  }, [story, holding, busy]);

  useEffect(() => {
    if (elapsed >= STORY_DURATION_MS) advance();
  }, [elapsed, advance]);

  async function toggleViews() {
    if (views) {
      setViews(null);
      return;
    }
    setViews({ status: 'loading' });
    try {
      const data = await fetchViews(story.id);
      setViews({ status: 'ready', count: data.views_count, views: data.views });
    } catch {
      setViews({ status: 'error' });
    }
  }

  function confirmDelete() {
    setHolding(true);
    Alert.alert(t('viewer.delete.title'), t('viewer.delete.body'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => setHolding(false) },
      { text: t('viewer.delete.confirm'), style: 'destructive', onPress: doDelete },
    ]);
  }

  async function doDelete() {
    setBusy(true);
    try {
      await deleteStory(story.id);
      onChanged();
      const remaining = stories.filter((item) => item.id !== story.id);
      if (remaining.length === 0) {
        onClose();
        return;
      }
      setLoaded((state) => ({ ...state, [strip.author.id]: { status: 'ready', stories: remaining } }));
      setPosition((current) => ({
        ...current,
        storyIndex: Math.min(current.storyIndex, remaining.length - 1),
      }));
      setElapsed(0);
      setViews(null);
    } catch (e) {
      Alert.alert(t('viewer.error.delete'), messageOf(e));
    } finally {
      setBusy(false);
      setHolding(false);
    }
  }

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {entry?.status === 'loading' ? (
          <ActivityIndicator style={styles.center} color="#fff" />
        ) : null}
        {entry?.status === 'error' ? (
          <View style={styles.center}>
            <Text style={styles.message}>{t('viewer.error.load')}</Text>
          </View>
        ) : null}
        {entry?.status === 'ready' && stories.length === 0 ? (
          <Pressable style={styles.center} onPress={advance} accessibilityRole="button">
            <Text style={styles.message}>{t('viewer.unavailable')}</Text>
          </Pressable>
        ) : null}

        {story ? (
          <>
            {story.image.url ? (
              <Image
                source={{ uri: story.image.url }}
                style={styles.image}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                accessibilityLabel={story.content || t('viewer.storyOf', { name: strip.author.name })}
              />
            ) : (
              // Moderación (ADR-044): sin URL = todavía no aprobada; solo la ve quien la publicó.
              <View style={styles.center}>
                <Text style={styles.message}>{t('viewer.inReview')}</Text>
              </View>
            )}
            <View style={styles.shade} pointerEvents="none" />

            <View style={styles.tapRow}>
              <Pressable
                style={styles.tapBack}
                onPress={back}
                onPressIn={() => setHolding(true)}
                onPressOut={() => setHolding(false)}
                accessibilityRole="button"
                accessibilityLabel={t('viewer.previous')}
              />
              <Pressable
                style={styles.tapNext}
                onPress={advance}
                onPressIn={() => setHolding(true)}
                onPressOut={() => setHolding(false)}
                accessibilityRole="button"
                accessibilityLabel={t('viewer.next')}
              />
            </View>

            <View style={[styles.top, { paddingTop: insets.top + space[2] }]} pointerEvents="box-none">
              <View style={styles.bars} pointerEvents="none">
                {stories.map((item, i) => (
                  <View key={item.id} style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${barFill(i, position.storyIndex, elapsed) * 100}%` },
                      ]}
                    />
                  </View>
                ))}
              </View>
              <View style={styles.header}>
                {/* Foto y nombre de quien publicó -> su perfil (cierra el visor primero: está sobre la pantalla). */}
                <Pressable
                  onPress={() => {
                    onClose();
                    openProfile(strip.author.id);
                  }}
                  disabled={strip.is_me}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3] }}
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.viewOf', { name: strip.author.name })}
                >
                  <Avatar name={strip.author.name} uri={strip.author.avatar_url} size={36} />
                  <View style={styles.headerText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {strip.is_me ? t('strip.mine') : strip.author.name}
                    </Text>
                    <Text style={styles.time}>{formatRelativeTime(story.created_at)}</Text>
                  </View>
                </Pressable>
                {/* Etiqueta verde: esta historia es solo para mejores amigos (ADR-054). */}
                {story.audience === 'close_friends' ? (
                  <View style={styles.closeFriends} accessibilityLabel={t('story.audience.closeFriends')}>
                    <Text style={styles.closeFriendsText}>★ {t('story.audience.closeFriends')}</Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={t('viewer.close')}
                  style={styles.close}
                >
                  <Text style={styles.closeText}>✕</Text>
                </Pressable>
              </View>
            </View>

            {story.content ? <Text style={[styles.caption, { bottom: insets.bottom + 72 }]}>{story.content}</Text> : null}

            {strip.is_me ? (
              <View style={[styles.owner, { paddingBottom: insets.bottom + space[3] }]} pointerEvents="box-none">
                {views ? (
                  <ScrollView style={styles.viewsBox}>
                    {views.status === 'loading' ? <ActivityIndicator color="#fff" /> : null}
                    {views.status === 'error' ? <Text style={styles.viewsText}>{t('viewer.views.error')}</Text> : null}
                    {views.status === 'ready' && views.views.length === 0 ? (
                      <Text style={styles.viewsText}>{t('viewer.views.empty')}</Text>
                    ) : null}
                    {views.status === 'ready'
                      ? views.views.map((viewer) => (
                          <Pressable
                            key={viewer.id}
                            style={styles.viewer}
                            onPress={() => {
                              onClose();
                              openProfile(viewer.id);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={t('profile.viewOf', { name: viewer.name })}
                          >
                            <Avatar name={viewer.name} uri={viewer.avatar_url} size={28} />
                            <Text style={styles.viewerName} numberOfLines={1}>
                              {viewer.name}
                            </Text>
                            <Text style={styles.time}>{formatRelativeTime(viewer.viewed_at)}</Text>
                          </Pressable>
                        ))
                      : null}
                  </ScrollView>
                ) : null}
                <View style={styles.ownerRow}>
                  <Pressable onPress={toggleViews} style={styles.pill} accessibilityRole="button">
                    <Text style={styles.pillText}>
                      {views?.status === 'ready' ? t('viewer.views.count', { count: views.count }) : t('viewer.views')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={confirmDelete}
                    style={styles.pill}
                    accessibilityRole="button"
                    accessibilityLabel={t('viewer.delete.a11y')}
                  >
                    <Icon name="trash" size={18} color="#fff" />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View style={[styles.top, { paddingTop: insets.top + space[2] }]} pointerEvents="box-none">
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('viewer.close')} style={styles.close}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  root: { flex: 1, backgroundColor: '#000' },
  center: { ...absoluteFill(), alignItems: 'center', justifyContent: 'center', padding: space[6] },
  message: { color: '#fff', fontSize: fontSize.bodyMd, textAlign: 'center' },
  image: absoluteFill(),
  shade: { ...absoluteFill(), backgroundColor: 'rgba(0,0,0,0.25)' },
  tapRow: { ...absoluteFill(), flexDirection: 'row' },
  tapBack: { flex: 1 },
  tapNext: { flex: 2 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space[3] },
  bars: { flexDirection: 'row', gap: 4, marginBottom: space[3] },
  barTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  headerText: { flex: 1 },
  name: { color: '#fff', fontSize: fontSize.bodyMd, fontWeight: '700' },
  time: { color: 'rgba(255,255,255,0.75)', fontSize: fontSize.labelMd },
  closeFriends: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: space[2],
    paddingVertical: 3,
  },
  closeFriendsText: { color: '#fff', fontSize: fontSize.labelSm, fontWeight: '700' },
  close: { padding: space[2] },
  closeText: { color: '#fff', fontSize: 20 },
  caption: {
    position: 'absolute',
    left: space[4],
    right: space[4],
    color: '#fff',
    fontSize: fontSize.bodyLg,
    fontWeight: '700',
    textAlign: 'center',
  },
  owner: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space[4] },
  ownerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  pill: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 999,
    paddingHorizontal: space[4],
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { color: '#fff', fontSize: fontSize.labelLg, fontWeight: '700' },
  viewsBox: {
    maxHeight: 200,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 16,
    padding: space[3],
    marginBottom: space[3],
  },
  viewsText: { color: '#fff', fontSize: fontSize.bodySm },
  viewer: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[1] },
  viewerName: { flex: 1, color: '#fff', fontSize: fontSize.bodySm, fontWeight: '700' },
}));

function absoluteFill() {
  return { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
}
