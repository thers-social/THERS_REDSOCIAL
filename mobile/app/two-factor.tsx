import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@features/auth/context/AuthContext';
import { ApiError } from '@shared/lib/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

/**
 * Segundo paso del login para cuentas con 2FA (`ADR-026`).
 *
 * El `two_factor_token` NO pasa por esta pantalla: vive solo en `AuthContext`
 * (memoria), igual que en la web, que lo guarda en el estado del router y no en
 * `localStorage`. Aquí solo se escribe el código.
 *
 * El campo acepta **un TOTP de 6 dígitos o un código de recuperación**, y no se
 * valida el formato en el cliente: el servidor prueba primero el TOTP y luego la
 * recuperación, y responde con un único error para los dos (distinguirlos
 * revelaría qué espera). Adivinar el formato acá solo bloquearía a quien escribe
 * un código de recuperación con guion.
 */
export default function TwoFactor() {
  const { user, hasPendingTwoFactor, verifyTwoFactor, cancelTwoFactor } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sin desafío pendiente no hay nada que verificar: p. ej. la app se cerró y se
  // reabrió (el desafío vive solo 5 minutos y solo en memoria), o se llegó sin
  // pasar por el login.
  if (user) return <Redirect href="/home" />;
  if (!hasPendingTwoFactor) return <Redirect href="/login" />;

  function goBackToLogin() {
    cancelTwoFactor();
    router.replace('/login');
  }

  async function handleSubmit() {
    if (isSubmitting) return;

    setError(null);
    if (!code.trim()) {
      setError('Escribí el código de tu app de autenticación o un código de recuperación.');
      return;
    }

    setIsSubmitting(true);
    try {
      const outcome = await verifyTwoFactor(code);

      if (outcome.usedRecoveryCode) {
        // Avisarlo, no dejarlo pasar: un código de recuperación se consume.
        Alert.alert(
          'Usaste un código de recuperación',
          `Te quedan ${outcome.recoveryCodesRemaining}. Generá códigos nuevos desde la web de THERS ` +
            'cuando puedas.',
          [{ text: 'Entendido', onPress: () => router.replace('/home') }],
          { cancelable: false },
        );
      } else {
        router.replace('/home');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        // ADR-027: 429 con `retry_after_seconds`. Sin decir cuándo volver, la
        // persona reintenta a ciegas y empeora el bloqueo.
        const body = e.body as { retry_after_seconds?: number } | null;
        const seconds = body?.retry_after_seconds;
        setError(
          seconds
            ? `Demasiados intentos. Esperá ${seconds} segundos antes de volver a probar.`
            : e.message,
        );
      } else if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError('Ocurrió un error inesperado. Intentá de nuevo.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space[10], paddingBottom: insets.bottom + space[6] },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>THERS</Text>
        <Text style={styles.title}>Verificación en dos pasos</Text>
        <Text style={styles.subtitle}>
          Escribí el código de 6 dígitos de tu app de autenticación, o uno de tus códigos de
          recuperación.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Código</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={colors.fgDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="oneTimeCode"
            editable={!isSubmitting}
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
            autoFocus
          />
        </View>

        {error ? (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            isSubmitting && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={styles.buttonText}>Verificar</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.linkButton, pressed && styles.linkPressed]}
          onPress={goBackToLogin}
          disabled={isSubmitting}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>Volver al inicio de sesión</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = themedStyles(() => ({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space[6],
  },
  brand: {
    fontSize: fontSize.headlineXl,
    fontWeight: '800',
    color: colors.brandText,
    textAlign: 'center',
    letterSpacing: 1,
  },
  title: {
    fontSize: fontSize.headlineMd,
    fontWeight: '700',
    color: colors.fg,
    textAlign: 'center',
    marginTop: space[6],
  },
  subtitle: {
    fontSize: fontSize.bodyMd,
    color: colors.fgSecondary,
    textAlign: 'center',
    marginTop: space[2],
    marginBottom: space[8],
  },
  field: { marginBottom: space[4] },
  label: {
    fontSize: fontSize.labelLg,
    fontWeight: '600',
    color: colors.fg,
    marginBottom: space[2],
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    paddingHorizontal: space[4],
    paddingVertical: Platform.OS === 'ios' ? space[4] : space[3],
    fontSize: fontSize.bodyLg,
    color: colors.fg,
    letterSpacing: 2,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.sm,
    padding: space[3],
    marginBottom: space[4],
  },
  errorText: { color: colors.dangerFg, fontSize: fontSize.bodySm },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.input,
    paddingVertical: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonPressed: { backgroundColor: colors.brandHover },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: colors.onBrand,
    fontSize: fontSize.bodyLg,
    fontWeight: '700',
  },
  linkButton: { marginTop: space[4], padding: space[3], alignItems: 'center' },
  linkPressed: { opacity: 0.6 },
  linkText: { color: colors.fgSecondary, fontSize: fontSize.bodyMd, fontWeight: '600' },
}));
