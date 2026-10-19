import { Image, Pressable, ScrollView, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

import { VIDEO_ENABLED } from './mediaConfig';
import { formatDuration } from './mediaRules';
import type { MediaAttachments } from './useMediaAttachments';

type Props = {
  media: MediaAttachments;
  maxImages: number;
  disabled?: boolean;
  /** Sin el botón de video aunque el interruptor esté encendido (p. ej. donde no tiene sentido). */
  allowVideo?: boolean;
};

/**
 * Botones «Foto» y «Video» y las vistas previas de lo adjuntado (ADR-046). Sin estado propio: lo gobierna
 * `useMediaAttachments`. Cada vista previa tiene su botón para quitarla.
 */
export function MediaAttachmentBar({ media, maxImages, disabled = false, allowVideo = true }: Props) {
  const hasVideo = media.video !== null;
  const imagesFull = media.images.length >= maxImages;
  const busy = disabled || media.picking;

  return (
    <View>
      {media.items.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previews}>
          {media.items.map((item, index) => (
            <View key={`${item.uri}-${index}`} style={styles.preview}>
              {item.kind === 'image' ? (
                <Image source={{ uri: item.uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
              ) : (
                <View style={[styles.thumb, styles.videoThumb]}>
                  <Icon name="play" size={22} color="#ffffff" filled />
                  <Text style={styles.videoLength}>{formatDuration(item.durationMs)}</Text>
                </View>
              )}
              <Pressable
                onPress={() => media.remove(index)}
                disabled={disabled}
                style={styles.remove}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={item.kind === 'image' ? `Quitar la foto ${index + 1}` : 'Quitar el video'}
              >
                <Icon name="close" size={14} color="#ffffff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => void media.addImages()}
          disabled={busy || hasVideo || imagesFull}
          style={[styles.action, (busy || hasVideo || imagesFull) && styles.actionOff]}
          accessibilityRole="button"
          accessibilityLabel="Adjuntar foto"
        >
          <Icon name="image" size={20} color={colors.fgSecondary} />
          <Text style={styles.actionText}>
            {maxImages > 1 ? `Foto ${media.images.length}/${maxImages}` : 'Foto'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void media.addCameraPhoto()}
          disabled={busy || hasVideo || imagesFull}
          style={[styles.action, (busy || hasVideo || imagesFull) && styles.actionOff]}
          accessibilityRole="button"
          accessibilityLabel="Tomar una foto"
        >
          <Icon name="camera" size={20} color={colors.fgSecondary} />
          <Text style={styles.actionText}>Cámara</Text>
        </Pressable>
        {VIDEO_ENABLED && allowVideo ? (
          <Pressable
            onPress={() => void media.addVideo()}
            disabled={busy || media.items.length > 0}
            style={[styles.action, (busy || media.items.length > 0) && styles.actionOff]}
            accessibilityRole="button"
            accessibilityLabel="Adjuntar video"
          >
            <Icon name="play" size={20} color={colors.fgSecondary} />
            <Text style={styles.actionText}>Video</Text>
          </Pressable>
        ) : null}
        {media.picking ? <Text style={styles.hint}>Abriendo galería…</Text> : null}
      </View>
      {media.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {media.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  previews: { gap: space[2], paddingBottom: space[2] },
  preview: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: radius.input, backgroundColor: colors.bgSubtle },
  videoThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },
  videoLength: { color: '#ffffff', fontSize: fontSize.labelMd, marginTop: 2 },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  action: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingVertical: space[1] },
  actionOff: { opacity: 0.4 },
  actionText: { fontSize: fontSize.labelLg, color: colors.fgSecondary },
  hint: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  error: { fontSize: fontSize.labelMd, color: colors.dangerFg, marginTop: space[1] },
}));
