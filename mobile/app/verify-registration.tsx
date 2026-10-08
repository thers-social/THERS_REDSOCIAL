import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { ApiError, request } from '@shared/lib/api';
import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Verificación del correo con el código de 6 dígitos (`ADR-011`):
 * `POST /api/verify-registration-code` y `POST /api/resend-registration-code`.
 * El correo llega por parámetro de ruta desde el registro o desde un intento de
 * inicio de sesión con una cuenta todavía sin verificar.
 */
export default function VerifyRegistration() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!email) {
    return (
      <Screen title="Verificar correo" back>
        <Banner tone="error">
          No sabemos qué correo verificar. Vuelve a crear tu cuenta o inicia sesión.
        </Banner>
        <Button label="Ir al inicio de sesión" onPress={() => router.replace('/login')} />
      </Screen>
    );
  }

  async function handleVerify() {
    if (verifying || code.length !== 6) return;
    setVerifying(true);
    setError(null);
    setInfo(null);
    try {
      await request('/verify-registration-code', { method: 'POST', body: { email, code } });
      // Cuenta verificada: ya puede iniciar sesión.
      router.replace('/login');
    } catch (e) {
      setCode('');
      setError(e instanceof ApiError ? e.message : 'Ocurrió un error inesperado. Inténtalo de nuevo.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      await request('/resend-registration-code', { method: 'POST', body: { email } });
      setInfo('Te enviamos un código nuevo.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ocurrió un error inesperado. Inténtalo de nuevo.');
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen title="Verificar correo" back>
      <Text style={styles.intro}>
        Enviamos un código de 6 dígitos a <Text style={styles.strong}>{email}</Text>. Vence en 10
        minutos.
      </Text>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {info ? <Banner tone="success">{info}</Banner> : null}

      <TextField
        label="Código"
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        editable={!verifying}
      />

      <Button
        label="Verificar"
        onPress={handleVerify}
        loading={verifying}
        disabled={code.length !== 6}
      />
      <Button
        label={cooldown > 0 ? `Reenviar código (${cooldown} s)` : 'Reenviar código'}
        variant="ghost"
        onPress={handleResend}
        loading={resending}
        disabled={cooldown > 0}
        style={styles.resend}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  intro: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginBottom: space[4] },
  strong: { fontWeight: '700', color: colors.fg },
  resend: { marginTop: space[2] },
}));
