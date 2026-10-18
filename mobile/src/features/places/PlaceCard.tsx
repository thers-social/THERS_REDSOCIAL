import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

import { formatDistance } from './coordinates';
import type { PlaceSummary } from './types';

type Props = { place: PlaceSummary; selected?: boolean; onPress: (id: string) => void };

/** Tarjeta de resultado. Toda la tarjeta es un botón: abre la ficha del lugar. */
export function PlaceCard({ place, selected = false, onPress }: Props) {
  const distance = formatDistance(place.distance_meters);
  return (
    <Pressable
      onPress={() => onPress(place.id)}
      style={[styles.card, selected && styles.cardSelected]}
      accessibilityRole="button"
      accessibilityLabel={`${place.name}, ${place.category.name}${distance ? `, a ${distance}` : ''}`}
    >
      <View style={styles.iconBox}>
        <Icon name="pin" size={20} color={colors.brandText} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {place.name}
          </Text>
          {place.is_saved ? <Icon name="bookmark" size={16} color={colors.brandText} filled /> : null}
        </View>
        <Text style={styles.category}>{place.category.name}</Text>
        {place.address ? (
          <Text style={styles.address} numberOfLines={1}>
            {place.address}
          </Text>
        ) : null}
        <View style={styles.meta}>
          {distance ? <Text style={styles.distance}>{distance}</Text> : null}
          {place.verification_status === 'verified' ? (
            <Text style={styles.verified}>Verificado</Text>
          ) : place.verification_status === 'unverified' ? (
            <Text style={styles.unverified}>Sin verificar</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  card: {
    flexDirection: 'row',
    gap: space[3],
    padding: space[3],
    marginBottom: space[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
  },
  cardSelected: { borderColor: colors.brand },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  category: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  address: { fontSize: fontSize.labelMd, color: colors.fgSecondary, marginTop: space[1] },
  meta: { flexDirection: 'row', gap: space[3], marginTop: space[1] },
  distance: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.fg },
  verified: { fontSize: fontSize.labelMd, color: colors.successFg },
  unverified: { fontSize: fontSize.labelMd, color: colors.fgMuted },
}));
