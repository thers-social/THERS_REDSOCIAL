import { Image, Text, View } from 'react-native';

import { colors, fontSize, radius } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

type Props = { name: string; uri?: string | null; size?: number };

/** Foto de perfil, o la inicial del nombre si la persona no subió una. */
export function Avatar({ name, uri, size = 40 }: Props) {
  const box = { width: size, height: size, borderRadius: radius.pill };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, box]}
        accessibilityIgnoresInvertColors
        accessibilityLabel={`Foto de ${name}`}
      />
    );
  }

  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.fallback, box]} accessible={false}>
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>{initial}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  image: { backgroundColor: colors.bgSubtle },
  fallback: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  initial: { color: colors.onBrand, fontWeight: '800', fontSize: fontSize.bodyLg },
}));
