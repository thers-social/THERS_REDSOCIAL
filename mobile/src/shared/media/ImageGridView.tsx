import { useState } from 'react';
import { Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

export type PublicImage = { url: string; width: number; height: number };

type Props = {
  images: PublicImage[] | undefined;
  /** Texto para el lector de pantalla, p. ej. «Imagen de Ana». */
  label?: string;
  /** Más pequeñas, para dentro de una burbuja de chat. */
  compact?: boolean;
};

/**
 * Fotos de una publicación o un mensaje (ADR-039/046), con visor a pantalla completa al tocarlas. Las
 * dimensiones que calculó el servidor reservan el espacio antes de que cargue la imagen, para que la
 * lista no salte. Una sola foto conserva su proporción; varias se recortan a cuadrados parejos.
 */
export function ImageGridView({ images, label = 'Imagen', compact = false }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const insets = useSafeAreaInsets();
  if (!images || images.length === 0) return null;

  const single = images.length === 1;
  return (
    <>
      <View style={[styles.grid, compact && styles.compact]}>
        {images.map((image, index) => (
          <Pressable
            key={image.url}
            onPress={() => setOpen(index)}
            style={[
              styles.cell,
              // Sin `width` una celda de una fila con `flexWrap` mide 0: la foto sola ocupa todo el ancho.
              single
                ? { width: '100%', aspectRatio: image.width / Math.max(1, image.height), maxHeight: compact ? 280 : 420 }
                : styles.square,
            ]}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${label} ${index + 1} de ${images.length}. Tocar para verla en grande`}
          >
            <Image source={{ uri: image.url }} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors />
          </Pressable>
        ))}
      </View>

      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={styles.viewer}>
          {open !== null ? (
            <Image source={{ uri: images[open].url }} style={styles.full} resizeMode="contain" accessibilityLabel={label} />
          ) : null}
          <Pressable
            onPress={() => setOpen(null)}
            style={[styles.close, { top: insets.top + space[2] }]}
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
            hitSlop={12}
          >
            <Icon name="close" size={24} color="#ffffff" />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = themedStyles(() => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: space[2], borderRadius: radius.card, overflow: 'hidden' },
  compact: { maxWidth: 240 },
  cell: { overflow: 'hidden', backgroundColor: colors.bgSubtle },
  square: { width: '49%', aspectRatio: 1 },
  image: { width: '100%', height: '100%' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  close: { position: 'absolute', right: space[3], padding: space[2], backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999 },
}));
