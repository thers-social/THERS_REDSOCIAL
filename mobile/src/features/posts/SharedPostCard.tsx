import { useRouter } from 'expo-router';
import { Image, Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';

import type { SharedPost } from './types';

/**
 * Tarjeta de una publicación compartida en el chat (`ADR-047`). La calcula el servidor PARA QUIEN MIRA:
 * si esta persona no puede ver la publicación llega `available: false` y no hay nada más que enseñar.
 * Una publicación sensible llega sin texto ni miniatura. Todo se pinta como texto de React.
 */
export function SharedPostCard({ post, mine }: { post: SharedPost; mine: boolean }) {
  const router = useRouter();
  const tint = mine ? colors.onBrand : colors.fg;
  const box = [styles.card, mine ? styles.cardMine : styles.cardTheirs];

  if (!post.available) {
    return (
      <View style={box} accessibilityLabel="Esta publicación ya no está disponible">
        <Text style={[styles.sub, { color: tint }]}>Esta publicación ya no está disponible</Text>
      </View>
    );
  }

  const hiddenSensitive = post.is_sensitive && post.excerpt === null;
  // Abre la publicación completa. El servidor ya comprobó que esta persona puede verla
  // (`available: true`); el detalle vuelve a comprobarlo al cargarla.
  return (
    <Pressable
      style={box}
      accessibilityRole="button"
      accessibilityLabel={`Abrir la publicación de ${post.author.name}`}
      onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
    >
      <View style={styles.author}>
        <Avatar name={post.author.name} uri={post.author.avatar_url} size={24} />
        <Text style={[styles.name, { color: tint }]} numberOfLines={1}>
          {post.author.name}
        </Text>
      </View>
      {hiddenSensitive ? (
        <Text style={[styles.sub, { color: tint }]}>Contenido marcado como sensible por su autor.</Text>
      ) : (
        <>
          {post.excerpt ? (
            <Text style={[styles.text, { color: tint }]} numberOfLines={4}>
              {post.excerpt}
            </Text>
          ) : null}
          {post.thumbnail_url ? (
            <View style={styles.thumbBox}>
              <Image source={{ uri: post.thumbnail_url }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
              {post.has_video ? (
                <View style={styles.play}>
                  <Icon name="play" size={28} color="#ffffff" />
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  card: {
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius.input,
    padding: space[2],
    marginBottom: space[1],
    width: 240,
    maxWidth: '100%',
  },
  cardMine: { borderColor: colors.onBrandMuted },
  cardTheirs: { borderColor: colors.border },
  author: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: { flexShrink: 1, fontSize: fontSize.labelMd, fontWeight: '700' },
  text: { fontSize: fontSize.bodyMd },
  sub: { fontSize: fontSize.labelMd, opacity: 0.85 },
  thumbBox: { borderRadius: radius.input, overflow: 'hidden' },
  thumb: { width: '100%', height: 140, backgroundColor: colors.bgSubtle },
  play: { ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' } as const) },
}));
