import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

import type { SharedPlace } from './types';

/**
 * Tarjeta de un lugar compartido en el chat (ADR-040 fase 4c). Toda la información sale
 * de `message.place`, que nunca trae coordenadas ni teléfono. Si el lugar ya no es público
 * solo se dice eso. Los textos se pintan como texto de React, nunca como HTML.
 */
export function SharedPlaceCard({ place, mine }: { place: SharedPlace; mine: boolean }) {
  const router = useRouter();
  const tint = mine ? colors.onBrand : colors.fg;
  const box = [styles.card, mine ? styles.cardMine : styles.cardTheirs];

  if (!place.available) {
    return (
      <View style={box} accessibilityLabel="Este lugar ya no está disponible">
        <Icon name="pin" size={20} color={tint} />
        <Text style={[styles.sub, { color: tint }]}>Este lugar ya no está disponible</Text>
      </View>
    );
  }

  const area = [place.municipality, place.department].filter(Boolean).join(', ');
  const detail = [place.category?.name, area].filter(Boolean).join(' · ');
  return (
    <Pressable
      style={box}
      onPress={() => router.push({ pathname: '/places/[id]', params: { id: place.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Lugar compartido: ${place.name}. ${detail}`}
      accessibilityHint="Abre la ficha del lugar"
    >
      <Icon name="pin" size={22} color={tint} />
      <View style={styles.text}>
        <Text style={[styles.name, { color: tint }]} numberOfLines={1}>
          {place.name}
        </Text>
        {detail ? (
          <Text style={[styles.sub, { color: tint }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space[2],
    paddingVertical: space[2],
    marginBottom: space[1],
  },
  cardMine: { borderColor: colors.onBrandMuted },
  cardTheirs: { borderColor: colors.border },
  text: { flexShrink: 1 },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700' },
  sub: { fontSize: fontSize.labelMd, opacity: 0.85 },
}));
