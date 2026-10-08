import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

/**
 * Puerta de entrada: decide a dónde va la app según la sesión.
 *
 * Tres casos al arrancar:
 * - restaurando: spinner (evita parpadear el login);
 * - sesión válida: inicio (feed);
 * - sin sesión: login.
 *
 * Y un cuarto, `restoreFailed` (ADR-017 §7 decisión 2): hay una sesión
 * guardada pero no se pudo comprobar (sin red o servidor caído). NO se manda al
 * login: parecería que la sesión se cerró cuando sigue viva. Se ofrece
 * reintentar, o salir a propósito.
 */
export default function Index() {
  const { user, isRestoring, restoreFailed, refreshUser, logout } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);

  if (isRestoring) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!user && restoreFailed) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Sin conexión</Text>
        <Text style={styles.body}>
          No pudimos conectar con THERS. Tu sesión sigue guardada: revisá tu conexión e intentá de
          nuevo.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
          disabled={isRetrying}
          onPress={async () => {
            setIsRetrying(true);
            await refreshUser();
            setIsRetrying(false);
          }}
          accessibilityRole="button"
        >
          {isRetrying ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={styles.primaryText}>Reintentar</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.linkButton, pressed && styles.linkPressed]}
          disabled={isRetrying}
          onPress={() => logout()}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>Cerrar sesión</Text>
        </Pressable>
      </View>
    );
  }

  return <Redirect href={user ? '/home' : '/login'} />;
}

const styles = themedStyles(() => ({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: space[6],
  },
  title: {
    fontSize: fontSize.headlineMd,
    fontWeight: '700',
    color: colors.fg,
    marginBottom: space[3],
  },
  body: {
    fontSize: fontSize.bodyMd,
    color: colors.fgSecondary,
    textAlign: 'center',
    marginBottom: space[6],
  },
  primaryButton: {
    minHeight: 52,
    minWidth: 200,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.input,
    backgroundColor: colors.brand,
    paddingHorizontal: space[6],
  },
  primaryPressed: { backgroundColor: colors.brandHover },
  primaryText: { color: colors.onBrand, fontWeight: '700', fontSize: fontSize.bodyMd },
  linkButton: { marginTop: space[4], padding: space[3] },
  linkPressed: { opacity: 0.6 },
  linkText: { color: colors.fgSecondary, fontSize: fontSize.bodyMd, fontWeight: '600' },
}));
