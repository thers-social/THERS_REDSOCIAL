import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { ApiError, request } from '@shared/lib/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

/**
 * Eliminación de cuenta dentro de la app (`ADR-031-account-deletion.md`;
 * requisito de Google Play: ruta dentro de la app + recurso web).
 *
 * Mismos pasos que la web (`/eliminar-cuenta`), sobre los mismos endpoints
 * públicos:
 *  1. se pide un código al correo de la cuenta;
 *  2. se introduce el código (y el de 2FA si la cuenta lo tiene);
 *  3. se escribe a mano el correo y la palabra DELETE;
 *  4. «Eliminar cuenta» abre una última advertencia.
 *
 * La validación real es del servidor; aquí solo se evita pedirle algo que ya se
 * sabe incompleto. No se ofrece «suspender en su lugar»: esa función todavía no
 * existe (ADR-031 §B).
 */

const CONFIRM_WORD = 'DELETE';
const RESEND_COOLDOWN_SECONDS = 60;

type Step = 'email' | 'confirm' | 'done';

export default function DeleteAccount() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(user?.email ?? '');
  const [code, setCode] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [word, setWord] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    if (busy) return;
    setError(null);
    if (!email.trim()) {
      setError('Escribe el correo de tu cuenta.');
      return;
    }
    setBusy(true);
    try {
      await request('/account-deletion/request', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setStep('confirm');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ocurrió un error inesperado. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  const typedEmailMatches = confirmEmail.trim().toLowerCase() === email.trim().toLowerCase();
  const canSubmit =
    code.length === 6 &&
    typedEmailMatches &&
    word === CONFIRM_WORD &&
    (!needsTwoFactor || twoFactorCode.trim().length > 0);

  function askFinalConfirmation() {
    if (!canSubmit || busy) return;
    setError(null);
    Alert.alert(
      'Última advertencia',
      'Vas a eliminar tu cuenta de THERS y sus datos de forma definitiva. No podremos recuperarla. ¿Estás totalmente seguro?',
      [
        { text: 'No, volver', style: 'cancel' },
        { text: 'Sí, eliminar mi cuenta', style: 'destructive', onPress: deleteAccount },
      ],
      { cancelable: true },
    );
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await request('/account-deletion/confirm', {
        method: 'POST',
        body: {
          email: email.trim(),
          code,
          confirm_email: confirmEmail.trim(),
          confirmation: word,
          ...(needsTwoFactor ? { two_factor_code: twoFactorCode.trim() } : {}),
        },
      });
      // La sesión ya no existe en el servidor: se limpia también la local.
      await logout();
      setStep('done');
    } catch (e) {
      if (e instanceof ApiError) {
        const body = e.body as { two_factor_required?: boolean } | null;
        if (e.status === 403 && body?.two_factor_required) setNeedsTwoFactor(true);
        setError(e.message);
      } else {
        setError('Ocurrió un error inesperado. Inténtalo de nuevo.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <Screen title="Cuenta eliminada">
        <Text style={styles.body}>
          Eliminamos tu perfil y los datos asociados, y te enviamos un correo de confirmación.
          Gracias por haber estado en THERS.
        </Text>
        <Button label="Ir al inicio" onPress={() => router.replace('/login')} />
      </Screen>
    );
  }

  return (
    <Screen title="Eliminar cuenta" back>
      <Text style={styles.body}>
        Aquí puedes eliminar tu cuenta y sus datos.{' '}
        <Text style={styles.strong}>Es definitiva: no se puede deshacer.</Text>
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Qué se elimina</Text>
        <Text style={styles.cardText}>
          Tu perfil, publicaciones, comentarios, me gusta, seguidores y seguidos, notificaciones,
          mensajes (enviados y recibidos, en las dos bandejas), sesiones e imágenes. Quienes
          hablaban contigo dejarán de encontrarte («Usuario no encontrado»).
        </Text>
        <Text style={[styles.cardTitle, styles.cardTitleSpaced]}>Qué puede quedar</Text>
        <Text style={styles.cardText}>
          Las copias de seguridad del proveedor de base de datos y los registros del servidor pueden
          conservar datos un tiempo limitado hasta que caduquen. El plazo exacto se indicará en la
          política de privacidad (pendiente de publicar).
        </Text>
      </View>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {step === 'email' ? (
        <>
          <TextField
            label="Correo de tu cuenta"
            hint="Te enviaremos un código de confirmación a esta dirección."
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
          />
          <Button label="Enviar código" onPress={requestCode} loading={busy} />
        </>
      ) : (
        <>
          <Banner tone="info">
            {`Si existe una cuenta con ${email.trim()}, te enviamos un código. Vence en 10 minutos.`}
          </Banner>

          <TextField
            label="Código de 6 dígitos"
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            textContentType="oneTimeCode"
            editable={!busy}
          />

          {needsTwoFactor ? (
            <TextField
              label="Código de verificación en dos pasos"
              hint="El de tu app autenticadora, o un código de recuperación."
              value={twoFactorCode}
              onChangeText={setTwoFactorCode}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
          ) : null}

          <TextField
            label="Escribe tu correo para confirmar"
            hint="Debe coincidir con el correo de la cuenta."
            value={confirmEmail}
            onChangeText={setConfirmEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
          />

          <TextField
            label={`Escribe ${CONFIRM_WORD} para continuar`}
            hint="En mayúsculas, tal como se muestra."
            value={word}
            onChangeText={setWord}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
          />

          <Button
            label="Eliminar cuenta"
            variant="danger"
            onPress={askFinalConfirmation}
            loading={busy}
            disabled={!canSubmit}
          />
          <Button
            label={cooldown > 0 ? `Reenviar código (${cooldown} s)` : 'Reenviar código'}
            variant="ghost"
            onPress={requestCode}
            disabled={cooldown > 0 || busy}
            style={styles.resend}
          />
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  body: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginBottom: space[4], lineHeight: 22 },
  strong: { fontWeight: '700', color: colors.fg },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[4],
    marginBottom: space[4],
  },
  cardTitle: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg },
  cardTitleSpaced: { marginTop: space[3] },
  cardText: { fontSize: fontSize.bodySm, color: colors.fgSecondary, marginTop: space[1], lineHeight: 19 },
  resend: { marginTop: space[2] },
}));
