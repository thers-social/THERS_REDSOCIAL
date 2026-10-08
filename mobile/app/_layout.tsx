import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@features/auth/context/AuthContext';
import { PostsProvider } from '@features/posts/PostsContext';
import { colors, setColorScheme } from '@shared/design/tokens';

/**
 * Layout raíz. Monta los proveedores una sola vez para toda la app.
 *
 * `headerShown: false`: las pantallas de esta entrega dibujan su propia
 * cabecera con los tokens de THERS, para no mezclar el estilo nativo por
 * defecto con la identidad del producto.
 *
 * Tema: sigue el del sistema (claro u oscuro). `setColorScheme` se fija durante
 * el render, antes que los hijos lean `colors`; y el navegador lleva `key={scheme}`
 * para que se vuelva a pintar entero cuando el sistema cambia de tema (los
 * proveedores de sesión y de publicaciones quedan por encima y no se pierden).
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  setColorScheme(scheme);

  // Mientras cargan las fuentes (locales, milisegundos) se pinta solo el fondo. Si
  // fallaran, la app sigue con la fuente del sistema en vez de quedarse en blanco.
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* Las publicaciones se cargan al iniciar sesión y se vacían al cerrarla. */}
        <PostsProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Stack
            key={scheme}
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          />
        </PostsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
