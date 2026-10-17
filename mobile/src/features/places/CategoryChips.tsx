import { Pressable, ScrollView, Text } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import type { PlaceCategory } from './types';

type Props = { categories: PlaceCategory[]; value: string; onChange: (slug: string) => void };

/**
 * Filtro por categoría. Si todavía no cargaron las categorías (o fallaron), solo se muestra
 * «Todas»: el filtro es opcional y la pantalla sigue funcionando.
 */
export function CategoryChips({ categories, value, onChange }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Filtrar por categoría"
    >
      <Chip label="Todas" active={!value} onPress={() => onChange('')} />
      {categories.map((category) => (
        <Chip
          key={category.id}
          label={category.name}
          active={value === category.slug}
          onPress={() => onChange(value === category.slug ? '' : category.slug)}
        />
      ))}
    </ScrollView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  row: { gap: space[2], paddingVertical: space[1] },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg },
  chipTextActive: { color: colors.onBrand },
}));
