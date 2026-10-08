import { ActivityIndicator, Pressable, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themed, themedStyles } from '@shared/design/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

/**
 * Botón de THERS. Área táctil mínima de 48 dp (Material, accesibilidad) y
 * `loading` que bloquea el doble toque: sin eso, dos pulsaciones rápidas
 * disparan dos peticiones.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  accessibilityHint,
}: Props) {
  const inactive = disabled || loading;
  const palette = PALETTE[variant];

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && !inactive && { backgroundColor: palette.bgPressed },
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const PALETTE = themed((): Record<
  Variant,
  { bg: string; bgPressed: string; border: string; fg: string }
> => ({
  primary: {
    bg: colors.brand,
    bgPressed: colors.brandHover,
    border: colors.brand,
    fg: colors.onBrand,
  },
  secondary: {
    bg: colors.surface,
    bgPressed: colors.bgSubtle,
    border: colors.borderStrong,
    fg: colors.fg,
  },
  danger: {
    bg: colors.dangerAccent,
    bgPressed: colors.dangerPressed,
    border: colors.dangerAccent,
    fg: colors.onBrand,
  },
  ghost: {
    bg: 'transparent',
    bgPressed: colors.bgSubtle,
    border: 'transparent',
    fg: colors.brandText,
  },
}));

const styles = themedStyles(() => ({
  base: {
    minHeight: 48,
    borderRadius: radius.input,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[6],
  },
  label: { fontSize: fontSize.bodyMd, fontWeight: '700' },
  disabled: { opacity: 0.5 },
}));
