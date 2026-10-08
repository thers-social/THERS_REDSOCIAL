import { Text, View } from 'react-native';

import { colors, fonts } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

/** Emblema de marca: círculo violeta sólido con «TH» en blanco (`THERS_CLAUDE_MASTER` §4.3). */
export function BrandEmblem({ size = 32 }: { size?: number }) {
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="THERS"
    >
      <Text style={[styles.text, { fontSize: Math.round(size * 0.4) }]}>TH</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  circle: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.onBrand, fontFamily: fonts.display, letterSpacing: 0.5 },
}));
