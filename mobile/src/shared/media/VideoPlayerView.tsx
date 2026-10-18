import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

import { formatDuration } from './mediaRules';

export type PublicVideo = {
  url: string;
  thumbnail_url: string;
  width: number;
  height: number;
  duration_ms: number;
};

type Props = {
  video: PublicVideo;
  /** Más pequeño, para dentro de una burbuja de chat. */
  compact?: boolean;
  accessibilityLabel?: string;
};

/**
 * Video de una publicación o de un mensaje (ADR-046). Hasta que la persona lo toca solo se ve la
 * miniatura: no se descarga ni se decodifica nada (en un feed con varios videos eso importa). Reserva su
 * espacio con las dimensiones que calculó el servidor, para que la lista no salte al cargar.
 */
export function VideoPlayerView({ video, compact = false, accessibilityLabel = 'Video' }: Props) {
  const [started, setStarted] = useState(false);
  const ratio = video.width > 0 && video.height > 0 ? video.width / video.height : 16 / 9;
  // Un video vertical muy alto no debe ocupar toda la pantalla.
  const maxHeight = compact ? 280 : 480;
  const box = [styles.box, { aspectRatio: ratio, maxHeight }, compact && styles.compact];

  if (!started) {
    return (
      <Pressable
        onPress={() => setStarted(true)}
        style={box}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}, ${formatDuration(video.duration_ms)}. Tocar para reproducir`}
      >
        <Image source={{ uri: video.thumbnail_url }} style={styles.fill} resizeMode="cover" accessibilityIgnoresInvertColors />
        <View style={styles.playWrap} pointerEvents="none">
          <View style={styles.play}>
            <Icon name="play" size={28} color="#ffffff" filled />
          </View>
        </View>
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{formatDuration(video.duration_ms)}</Text>
        </View>
      </Pressable>
    );
  }

  return <StartedVideo video={video} style={box} />;
}

function StartedVideo({ video, style }: { video: PublicVideo; style: object }) {
  const player = useVideoPlayer(video.url, (instance) => {
    instance.loop = false;
  });
  useEffect(() => {
    player.play();
    return () => {
      try {
        player.pause();
      } catch {
        // el reproductor ya se liberó
      }
    };
  }, [player]);

  return (
    <View style={style}>
      <VideoView player={player} style={styles.fill} nativeControls fullscreenOptions={{ enable: true }} contentFit="contain" />
    </View>
  );
}

const styles = themedStyles(() => ({
  box: {
    width: '100%',
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: '#000000',
    marginTop: space[2],
  },
  compact: { maxWidth: 240 },
  fill: { width: '100%', height: '100%' },
  playWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  play: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    left: space[2],
    top: space[2],
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.xs,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
  badgeText: { color: '#ffffff', fontSize: fontSize.labelMd, fontWeight: '600' },
}));
