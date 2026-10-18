import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useAuth } from '@features/auth/context/AuthContext';
import {
  AUTH_BUTTON_BORDER_COLOR,
  AUTH_BUTTON_MIN_HEIGHT,
  AUTH_BUTTON_RADIUS,
} from '@features/auth/lib/authButtonStyle';
import { GoogleSignInError, isGoogleSignInAvailable } from '@features/auth/lib/googleSignIn';
import { ApiError } from '@shared/lib/api';
import { fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

type Props = {
  /** Recibe el mensaje a mostrar, o `null` para limpiarlo al empezar. */
  onError: (message: string | null) => void;
  /** Para bloquear el botón mientras el formulario de arriba se envía. */
  disabled?: boolean;
};

/**
 * «Continuar con Google»: sirve igual para crear la cuenta y para entrar (`ADR-012`). El servidor
 * decide: si el correo ya existe, vincula o inicia sesión; si no, crea la cuenta.
 *
 * Una cuenta nueva llega sin teléfono, país ni fecha de nacimiento (`profile_completed: false`) y
 * pasa por `/complete-profile` antes de entrar a la app, igual que en la web.
 *
 * Aspecto: el del botón «outline» de Google que ya usa la web (fondo blanco, forma de píldora, logo
 * a la izquierda), siguiendo la guía de marca de Google: siempre blanco, también en tema oscuro.
 *
 * No se dibuja si esta compilación no tiene el Client ID de Google: nada de botones que no hacen nada.
 */
export function GoogleSignInButton({ onError, disabled = false }: Props) {
  const { loginWithGoogle } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!isGoogleSignInAvailable) return null;

  const inactive = busy || disabled;

  async function handlePress() {
    if (inactive) return;
    onError(null);
    setBusy(true);
    try {
      const result = await loginWithGoogle();
      if (result.status === 'two_factor') {
        router.push('/two-factor');
        return;
      }
      router.replace(result.profileCompleted ? '/home' : '/complete-profile');
    } catch (e) {
      if (e instanceof GoogleSignInError) {
        // Cerrar el selector no es un error: no se muestra nada.
        if (e.reason !== 'cancelled' && e.reason !== 'in_progress') onError(e.message);
      } else if (e instanceof ApiError) {
        onError(e.message);
      } else {
        onError('Ocurrió un error inesperado. Inténtalo de nuevo.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel="Continuar con Google"
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, inactive && styles.disabled]}
    >
      <View style={styles.logo}>
        <GoogleLogo />
      </View>
      {busy ? (
        <ActivityIndicator color={GOOGLE_TEXT} />
      ) : (
        <Text style={styles.label}>Continuar con Google</Text>
      )}
    </Pressable>
  );
}

/** Logo «G» oficial de Google (4 colores). Se dibuja en un viewBox de 48 para que escale limpio. */
function GoogleLogo() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

// Colores de la guía de marca de Google: fijos y NO del tema, porque el botón es blanco en claro y en oscuro.
const GOOGLE_TEXT = '#1F1F1F';

const styles = themedStyles(() => ({
  button: {
    minHeight: AUTH_BUTTON_MIN_HEIGHT,
    marginTop: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: AUTH_BUTTON_BORDER_COLOR,
    borderRadius: AUTH_BUTTON_RADIUS,
    paddingHorizontal: space[6],
    paddingVertical: space[3],
  },
  pressed: { backgroundColor: '#F1F3F4' },
  disabled: { opacity: 0.6 },
  // El logo queda pegado a la izquierda y el texto centrado, como el botón de Google de la web.
  logo: { position: 'absolute', left: space[4] },
  label: { color: GOOGLE_TEXT, fontSize: fontSize.bodyLg, fontWeight: '600' },
}));
