import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { MIN_PASSWORD_LENGTH, isValidEmail } from '@features/auth/lib/validators';
import { ApiError, request } from '@shared/lib/api';
import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

type Step = 'email' | 'code' | 'password';

/**
 * Recuperar la contraseña con un código por correo (`ADR-010`), en tres pasos:
 * `POST /api/forgot-password` → `POST /api/verify-reset-code` →
 * `POST /api/reset-password`. El servidor responde igual exista o no la cuenta
 * (no revela qué correos están registrados), y esta pantalla tampoco lo hace.
 */
export default function ForgotPassword() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [authorization, setAuthorization] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function fail(e: unknown) {
    setError(e instanceof ApiError ? e.message : 'Ocurrió un error inesperado. Inténtalo de nuevo.');
  }

  async function sendCode() {
    if (busy) return;
    setError(null);
    setInfo(null);
    if (!isValidEmail(email)) {
      setError('El correo no es válido.');
      return;
    }
    setBusy(true);
    try {
      await request('/forgot-password', { method: 'POST', body: { email: email.trim() } });
      setStep('code');
      setCooldown(60);
      setInfo('Si existe una cuenta con ese correo, te enviamos un código.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await request<{ reset_authorization: string }>('/verify-reset-code', {
        method: 'POST',
        body: { email: email.trim(), code },
      });
      setAuthorization(result.reset_authorization);
      setStep('password');
    } catch (e) {
      setCode('');
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (busy) return;
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      await request('/reset-password', {
        method: 'POST',
        body: { reset_authorization: authorization, password, confirm_password: confirm },
      });
      router.replace('/login');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Recuperar contraseña" back>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {info ? <Banner tone="info">{info}</Banner> : null}

      {step === 'email' ? (
        <>
          <Text style={styles.intro}>Escribe el correo de tu cuenta y te enviaremos un código.</Text>
          <TextField
            label="Correo"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!busy}
          />
          <Button label="Enviar código" onPress={sendCode} loading={busy} />
        </>
      ) : null}

      {step === 'code' ? (
        <>
          <Text style={styles.intro}>Escribe el código de 6 dígitos. Vence en 10 minutos.</Text>
          <TextField
            label="Código"
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            textContentType="oneTimeCode"
            editable={!busy}
          />
          <Button label="Verificar" onPress={verifyCode} loading={busy} disabled={code.length !== 6} />
          <Button
            label={cooldown > 0 ? `Reenviar código (${cooldown} s)` : 'Reenviar código'}
            variant="ghost"
            onPress={sendCode}
            disabled={cooldown > 0 || busy}
            style={styles.again}
          />
        </>
      ) : null}

      {step === 'password' ? (
        <>
          <Text style={styles.intro}>Elige una contraseña nueva. Cerraremos tus otras sesiones.</Text>
          <TextField
            label="Contraseña nueva"
            hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            editable={!busy}
          />
          <TextField
            label="Repite la contraseña"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            editable={!busy}
          />
          <Button label="Cambiar contraseña" onPress={resetPassword} loading={busy} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  intro: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginBottom: space[4], lineHeight: 21 },
  again: { marginTop: space[2] },
}));
