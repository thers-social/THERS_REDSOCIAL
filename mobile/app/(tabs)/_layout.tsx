import { Redirect, useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@features/auth/context/AuthContext';
import { colors, fontSize, fonts } from '@shared/design/tokens';
import { Icon } from '@shared/ui/Icon';
import { useUnreadCount } from '@features/messages/useUnreadCount';
import { Avatar } from '@shared/ui/Avatar';
import { TRayoButton } from '@shared/ui/TRayoButton';

/**
 * Navegación principal de cinco puntos (`THERS_CLAUDE_MASTER` §5): Inicio,
 * Reels, T-Rayo (crear), Mensajes y Perfil.
 *
 * Buscar y Avisos siguen siendo rutas de esta carpeta, pero salen de la barra
 * (`href: null`) y se abren desde la cabecera de Inicio. Reels aún no tiene
 * backend (no hay video), así que muestra un estado «Próximamente». Todas son
 * pantallas de la sesión: sin sesión se vuelve al inicio de sesión.
 */
export default function TabsLayout() {
  const { user, isRestoring } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const unread = useUnreadCount(Boolean(user));

  if (isRestoring) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandText,
        tabBarInactiveTintColor: colors.fgMuted,
        tabBarLabelStyle: { fontSize: fontSize.labelSm, fontFamily: fonts.displayMedium },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.borderSubtle,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, focused }) => <Icon name="home" color={color} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="reels"
        options={{
          title: 'Reels',
          tabBarIcon: ({ color }) => <Icon name="reels" color={color} />,
        }}
      />
      {/* Botón central: no es una pantalla, abre la pantalla de creación. */}
      <Tabs.Screen
        name="create"
        options={{
          title: 'Crear',
          tabBarLabel: () => null,
          tabBarButton: () => (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <TRayoButton onPress={() => router.push('/create')} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Mensajes',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.brand, color: colors.onBrand },
          tabBarIcon: ({ color, focused }) => <Icon name="messages" color={color} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color }) =>
            user ? <Avatar name={user.name} uri={user.avatar_url} size={26} /> : <Icon name="profile" color={color} />,
        }}
      />
      <Tabs.Screen name="search" options={{ title: 'Buscar', href: null }} />
      <Tabs.Screen name="notifications" options={{ title: 'Avisos', href: null }} />
    </Tabs>
  );
}
