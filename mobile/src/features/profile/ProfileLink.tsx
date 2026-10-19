import { Pressable } from 'react-native';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { space } from '@shared/design/tokens';

import { useOpenProfile } from './useOpenProfile';

type Props = {
  userId: string;
  /** Para el lector de pantalla: «Ver el perfil de <nombre>». */
  name: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Envuelve una «pastilla» de persona (foto + nombre) y la vuelve un botón que abre su perfil. Por
 * defecto ocupa el espacio libre de la fila y alinea a sus hijos en horizontal; `style` lo ajusta.
 */
export function ProfileLink({ userId, name, children, style }: Props) {
  const openProfile = useOpenProfile();
  return (
    <Pressable
      onPress={() => openProfile(userId)}
      style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3] }, style]}
      accessibilityRole="button"
      accessibilityLabel={`Ver el perfil de ${name}`}
    >
      {children}
    </Pressable>
  );
}
