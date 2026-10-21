import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import type { IconName } from '@shared/ui/Icon';

import { canPlay, formatCount } from './reelsLogic';
import type { ReelVideo } from './types';

const DOUBLE_TAP_MS = 280;
const LIKED = '#ff3b5c';

type Props = {
  video: ReelVideo;
  /** Ocupa la pantalla: el único que suena y avanza. */
  active: boolean;
  /** Está al lado del activo: su reproductor ya está montado y preparado, pero en pausa. */
  near: boolean;
  muted: boolean;
  height: number;
  currentUserId: string | undefined;
  onMutedChange: (muted: boolean) => void;
  onLike: (video: ReelVideo) => void;
  onSave: (video: ReelVideo) => void;
  onShare: (video: ReelVideo) => void;
  onFollow: (video: ReelVideo) => void;
  onOpenComments: (video: ReelVideo) => void;
  onOpenAuthor: (video: ReelVideo) => void;
  /** El enlace firmado de reproducción venció o falló: hay que pedir uno nuevo. */
  onExpired: (id: string) => void;
};

function RailButton({
  icon,
  label,
  count,
  active = false,
  activeColor = '#ffffff',
  onPress,
}: {
  icon: IconName;
  label: string;
  count?: string;
  active?: boolean;
  activeColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} style={styles.railButton} hitSlop={6}>
      <View style={styles.railIcon}>
        <Icon name={icon} size={28} color={active ? activeColor : '#ffffff'} filled={active} />
      </View>
      {count !== undefined ? <Text style={styles.railCount}>{count}</Text> : null}
    </Pressable>
  );
}

/**
 * Reproductor de un Reel (HLS firmado por espectador, ADR-043-A) con `expo-video`. Se monta solo para el
 * Reel activo y sus vecinos: nunca hay más de tres reproductores a la vez.
 */
function SlidePlayer({
  video,
  active,
  muted,
  paused,
  onProgress,
  onExpired,
}: {
  video: ReelVideo;
  active: boolean;
  muted: boolean;
  paused: boolean;
  onProgress: (fraction: number) => void;
  onExpired: (id: string) => void;
}) {
  const player = useVideoPlayer({ uri: video.playback?.hls_url ?? '' }, (instance) => {
    instance.loop = true;
    instance.muted = muted;
    instance.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // Solo el Reel activo (y no pausado por la persona) reproduce; al salir de pantalla vuelve al inicio.
  useEffect(() => {
    if (active && !paused) {
      player.play();
    } else {
      player.pause();
      if (!active) {
        try {
          player.currentTime = 0;
        } catch {
          /* sin metadatos todavía */
        }
        onProgress(0);
      }
    }
  }, [player, active, paused, onProgress]);

  useEffect(() => {
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      const duration = player.duration || (video.duration_ms ?? 0) / 1000;
      if (duration > 0) onProgress(Math.min(1, Math.max(0, currentTime / duration)));
    });
    const status = player.addListener('statusChange', ({ status: next }) => {
      if (next === 'error') onExpired(video.id);
    });
    return () => {
      time.remove();
      status.remove();
    };
  }, [player, video.id, video.duration_ms, onProgress, onExpired]);

  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="cover" />;
}

/**
 * Un Reel a pantalla completa (ADR-055): video, acciones laterales, autor y texto. Un toque pausa o
 * reanuda; dos toques seguidos dan «me gusta» (nunca lo quitan).
 */
export function ReelSlide({
  video,
  active,
  near,
  muted,
  height,
  currentUserId,
  onMutedChange,
  onLike,
  onSave,
  onShare,
  onFollow,
  onOpenComments,
  onOpenAuthor,
  onExpired,
}: Props) {
  const insets = useSafeAreaInsets();
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [flash, setFlash] = useState<'heart' | 'play' | 'pause' | null>(null);
  const [progress, setProgress] = useState(0);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playable = canPlay(video);
  const mine = String(video.author.id) === String(currentUserId);
  const showFollow = !mine && !video.author.is_following;

  // Al salir de pantalla se quita la pausa: el siguiente regreso arranca solo.
  useEffect(() => {
    if (!active) {
      pausedRef.current = false;
      setPaused(false);
    }
  }, [active]);

  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const showFlash = useCallback((kind: 'heart' | 'play' | 'pause') => {
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 650);
  }, []);

  function handleTap() {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (!video.liked_by_me) onLike(video);
      showFlash('heart');
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => {
      const next = !pausedRef.current;
      pausedRef.current = next;
      setPaused(next);
      showFlash(next ? 'pause' : 'play');
    }, DOUBLE_TAP_MS);
  }

  return (
    <View style={[styles.slide, { height }]} accessibilityLabel={`Reel de @${video.author.username}`}>
      {near && playable ? (
        <SlidePlayer video={video} active={active} muted={muted} paused={paused} onProgress={setProgress} onExpired={onExpired} />
      ) : !playable ? (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>No disponible.</Text>
        </View>
      ) : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handleTap}
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Reanudar Reel' : 'Pausar Reel'}
      />

      <View pointerEvents="none" style={styles.shade} />

      {flash ? (
        <View pointerEvents="none" style={styles.flashWrap}>
          <View style={styles.flash}>
            <Icon name={flash === 'heart' ? 'heart' : flash === 'play' ? 'play' : 'pause'} size={44} color={flash === 'heart' ? LIKED : '#ffffff'} filled />
          </View>
        </View>
      ) : null}

      <Pressable
        onPress={() => onMutedChange(!muted)}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Activar sonido' : 'Silenciar'}
        style={[styles.mute, { top: insets.top + 56 }]}
      >
        <Icon name={muted ? 'volumeOff' : 'volume'} size={22} color="#ffffff" />
      </Pressable>

      <View style={styles.info} pointerEvents="box-none">
        <View style={styles.authorRow} pointerEvents="box-none">
          <Pressable onPress={() => onOpenAuthor(video)} style={styles.author} accessibilityRole="button" accessibilityLabel={`Ver el perfil de @${video.author.username}`}>
            <Avatar name={video.author.name || video.author.username} uri={video.author.avatar_url} size={36} />
            <Text style={styles.username} numberOfLines={1}>
              @{video.author.username}
            </Text>
          </Pressable>
          {showFollow ? (
            <Pressable
              onPress={() => onFollow(video)}
              disabled={video.author.follow_pending}
              accessibilityRole="button"
              style={[styles.follow, video.author.follow_pending && styles.followPending]}
            >
              <Text style={styles.followText}>{video.author.follow_pending ? 'Solicitado' : 'Seguir'}</Text>
            </Pressable>
          ) : null}
        </View>
        {video.caption ? (
          <Text style={styles.caption} numberOfLines={3}>
            {video.caption}
          </Text>
        ) : null}
      </View>

      <View style={styles.rail} pointerEvents="box-none">
        <RailButton icon="heart" label={video.liked_by_me ? 'Quitar me gusta' : 'Me gusta'} count={formatCount(video.likes_count)} active={!!video.liked_by_me} activeColor={LIKED} onPress={() => onLike(video)} />
        <RailButton icon="comment" label="Comentarios" count={formatCount(video.comments_count)} onPress={() => onOpenComments(video)} />
        <RailButton icon="bookmark" label={video.saved_by_me ? 'Quitar de guardados' : 'Guardar'} active={!!video.saved_by_me} onPress={() => onSave(video)} />
        <RailButton icon="share" label="Compartir" onPress={() => onShare(video)} />
      </View>

      <View style={styles.progressTrack} pointerEvents="none">
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  unavailable: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  unavailableText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '38%', backgroundColor: 'rgba(0,0,0,0.38)' },
  flashWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  flash: { width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  mute: { position: 'absolute', right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  info: { position: 'absolute', left: 16, right: 84, bottom: 18, gap: 8 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  username: { color: '#fff', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  follow: { borderColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  followPending: { opacity: 0.7 },
  followText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  caption: { color: '#fff', fontSize: 14, lineHeight: 19 },
  rail: { position: 'absolute', right: 10, bottom: 24, alignItems: 'center', gap: 18 },
  railButton: { alignItems: 'center', gap: 2 },
  railIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  railCount: { color: '#fff', fontSize: 12, fontWeight: '700' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  progressFill: { height: 3, backgroundColor: '#fff' },
});
