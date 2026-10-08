import { Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, radius } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

type Props = { onPress: () => void };

/**
 * T-Rayo: acción central de creación (`THERS_CLAUDE_MASTER` §4.3 y §5). Una «T»
 * cuyo tallo es un rayo, sobre un cuadrado redondeado con brillo violeta.
 */
export function TRayoButton({ onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Crear publicación"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Svg
        width={26}
        height={26}
        viewBox="0 0 24 24"
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Path
          d="M5 3.5h14"
          stroke={colors.brandText}
          strokeWidth={2.6}
          strokeLinecap="round"
          fill="none"
        />
        <Path d="M13.5 5.5 7.5 14h4.2L10.3 21.5 17 12.2h-4.3z" fill={colors.brandText} />
      </Svg>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  button: {
    // Cuadrado redondeado oscuro con borde violeta luminoso (capturas aprobadas).
    width: 48,
    height: 48,
    borderRadius: radius.card,
    backgroundColor: colors.brandSoft,
    borderWidth: 2,
    borderColor: colors.brandText,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brand,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  pressed: { backgroundColor: colors.brandSoftStrong },
}));
