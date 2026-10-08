import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import {
  MIN_AGE_MESSAGE,
  isValidISODate,
  meetsMinimumAge,
} from '@features/auth/lib/age';
import {
  MIN_PASSWORD_LENGTH,
  isValidCountryCode,
  isValidEmail,
  isValidPhone,
  isValidUsername,
} from '@features/auth/lib/validators';
import { ApiError, request } from '@shared/lib/api';
import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { BirthDateInput } from '@shared/ui/BirthDateInput';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

type Errors = Partial<Record<
  'name' | 'username' | 'email' | 'countryCode' | 'phone' | 'birthDate' | 'password' | 'confirm',
  string
>>;

/**
 * Registro tradicional (`POST /api/register`, `ADR-002`/`ADR-011`).
 *
 * THERS es solo para personas de 18 años o más: la fecha de nacimiento es
 * obligatoria y se valida aquí **y** en el servidor, que es la barrera real. Es
 * la fecha que la persona declara; no se piden documentos.
 */
export default function Register() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+503');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): Errors {
    const next: Errors = {};
    if (!name.trim()) next.name = 'Escribe tu nombre.';
    if (!username.trim()) next.username = 'Elige un nombre de usuario.';
    else if (!isValidUsername(username)) {
      next.username = 'De 3 a 20 caracteres: letras, números o guion bajo.';
    }
    if (!email.trim()) next.email = 'Escribe tu correo.';
    else if (!isValidEmail(email)) next.email = 'El correo no es válido.';
    if (!isValidCountryCode(countryCode)) next.countryCode = 'Ejemplo: +503';
    if (!phone.trim()) next.phone = 'Escribe tu teléfono.';
    else if (!isValidPhone(phone)) next.phone = 'El teléfono no es válido.';
    if (!birthDate) next.birthDate = 'Completa tu fecha de nacimiento.';
    else if (!isValidISODate(birthDate)) next.birthDate = 'La fecha no es válida.';
    else if (!meetsMinimumAge(birthDate)) next.birthDate = MIN_AGE_MESSAGE;
    if (!password) next.password = 'Elige una contraseña.';
    else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    }
    if (confirm !== password) next.confirm = 'Las contraseñas no coinciden.';
    return next;
  }

  async function handleSubmit() {
    if (submitting) return;
    setFormError(null);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await request('/register', {
        method: 'POST',
        body: {
          name: name.trim(),
          username: username.trim(),
          email: email.trim(),
          phone: phone.trim(),
          country_code: countryCode.trim(),
          birth_date: birthDate,
          password,
          confirm_password: confirm,
        },
      });
      // El registro no inicia sesión: primero se verifica el correo (ADR-011).
      router.replace({ pathname: '/verify-registration', params: { email: email.trim() } });
    } catch (e) {
      if (e instanceof ApiError) {
        // El servidor revalida la edad: si rechaza, se muestra bajo el campo.
        const body = e.body as { min_age?: number } | null;
        if (e.status === 400 && body?.min_age) setErrors({ birthDate: e.message });
        else setFormError(e.message);
      } else {
        setFormError('Ocurrió un error inesperado. Inténtalo de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen title="Crear cuenta" back>
      <Text style={styles.intro}>
        Únete a THERS. Te enviaremos un código para verificar tu correo.
      </Text>

      {formError ? <Banner tone="error">{formError}</Banner> : null}

      <TextField
        label="Nombre"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        textContentType="name"
        error={errors.name}
        editable={!submitting}
      />
      <TextField
        label="Nombre de usuario"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        error={errors.username}
        editable={!submitting}
      />
      <TextField
        label="Correo"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        error={errors.email}
        editable={!submitting}
      />

      <View style={styles.phoneRow}>
        <View style={styles.country}>
          <TextField
            label="País"
            value={countryCode}
            onChangeText={setCountryCode}
            keyboardType="phone-pad"
            error={errors.countryCode}
            editable={!submitting}
          />
        </View>
        <View style={styles.phone}>
          <TextField
            label="Teléfono"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            error={errors.phone}
            editable={!submitting}
          />
        </View>
      </View>

      <BirthDateInput onChange={setBirthDate} error={errors.birthDate} />

      <TextField
        label="Contraseña"
        hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        error={errors.password}
        editable={!submitting}
      />
      <TextField
        label="Repite la contraseña"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        error={errors.confirm}
        editable={!submitting}
      />

      <Text style={styles.legal}>
        Al crear tu cuenta confirmas que tienes 18 años o más. Los términos de uso y la política de
        privacidad se publicarán en la web de THERS antes del lanzamiento.
      </Text>

      <Button label="Crear cuenta" onPress={handleSubmit} loading={submitting} />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  intro: {
    fontSize: fontSize.bodyMd,
    color: colors.fgSecondary,
    marginBottom: space[4],
  },
  phoneRow: { flexDirection: 'row', gap: space[2] },
  country: { flex: 1 },
  phone: { flex: 2 },
  legal: {
    fontSize: fontSize.labelMd,
    color: colors.fgMuted,
    lineHeight: 17,
    marginBottom: space[4],
  },
}));
