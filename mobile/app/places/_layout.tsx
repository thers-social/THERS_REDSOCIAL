import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TeroFloating } from '@features/tero/components/TeroFloating';

/**
 * THERS Places queda fuera de las pestañas, así que la burbuja de Tero que monta
 * `app/(tabs)/_layout.tsx` no llegaba aquí. Esta capa la repite sobre el mapa, el
 * detalle y el panel de negocio; sin barra inferior, el tope es el borde seguro.
 */
export default function PlacesLayout() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <TeroFloating bottomOffset={insets.bottom} />
    </View>
  );
}
