import { useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

import { frameAspect, pageIndex } from './carousel';

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
 * lista no salte. Una sola foto conserva su proporción; varias (hasta 10) van en un carrusel que se
 * desliza con el dedo, como en Instagram, con un contador y unos puntos.
 */
export function ImageGridView({ images, label = 'Imagen', compact = false }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [frameWidth, setFrameWidth] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!images || images.length === 0) return null;

  const count = images.length;
  const onCarouselScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(pageIndex(event.nativeEvent.contentOffset.x, frameWidth, count));
  };

  return (
    <>
      {count === 1 ? (
        <View style={[styles.grid, compact && styles.compact]}>
          <Pressable
            onPress={() => setOpen(0)}
            style={[
              styles.cell,
              // Sin `width` la celda mide 0: la foto sola ocupa todo el ancho.
              { width: '100%', aspectRatio: images[0].width / Math.max(1, images[0].height), maxHeight: compact ? 280 : 420 },
            ]}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${label} 1 de 1. Tocar para verla en grande`}
          >
            <Image source={{ uri: images[0].url }} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors />
          </Pressable>
        </View>
      ) : (
        <View
          style={[styles.grid, compact && styles.compact]}
          onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}
        >
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onCarouselScroll}
            scrollEventThrottle={16}
            style={{ aspectRatio: frameAspect(images[0]), width: '100%' }}
            accessibilityLabel={`${label}: ${count} fotos`}
          >
            {images.map((image, index) => (
              <Pressable
                key={image.url}
                onPress={() => setOpen(index)}
                style={[styles.cell, { width: frameWidth || '100%', height: '100%' }]}
                accessibilityRole="imagebutton"
                accessibilityLabel={`${label} ${index + 1} de ${count}. Tocar para verla en grande`}
              >
                <Image source={{ uri: image.url }} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors />
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.counter} pointerEvents="none">
            <Text style={styles.counterText}>
              {page + 1}/{count}
            </Text>
          </View>
          <View style={styles.dots} pointerEvents="none">
            {images.map((image, index) => (
              <View key={image.url} style={[styles.dot, index === page && styles.dotActive]} />
            ))}
          </View>
        </View>
      )}

      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={styles.viewer}>
          {open !== null ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentOffset={{ x: open * screenWidth, y: 0 }}
              style={styles.full}
            >
              {images.map((image, index) => (
                <Image
                  key={image.url}
                  source={{ uri: image.url }}
                  style={{ width: screenWidth, height: '100%' }}
                  resizeMode="contain"
                  accessibilityLabel={`${label} ${index + 1} de ${count}`}
                />
              ))}
            </ScrollView>
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
  grid: { marginTop: space[2], borderRadius: radius.card, overflow: 'hidden' },
  compact: { maxWidth: 240, marginTop: 0, borderRadius: radius.input - 2 },
  cell: { overflow: 'hidden', backgroundColor: colors.bgSubtle },
  image: { width: '100%', height: '100%' },
  counter: {
    position: 'absolute',
    top: space[2],
    right: space[2],
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  counterText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  dots: { position: 'absolute', bottom: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { width: 16, backgroundColor: '#ffffff' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  close: { position: 'absolute', right: space[3], padding: space[2], backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999 },
}));
