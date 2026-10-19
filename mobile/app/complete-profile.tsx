import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { MIN_AGE_YEARS, isValidISODate, meetsMinimumAge } from '@features/auth/lib/age';
import { isValidCountryCode, isValidPhone, isValidUsername } from '@features/auth/lib/validators';
import { ApiError, request } from '@shared/lib/api';
import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { Banner } from '@shared/ui/Banner';
import { BirthDateInput } from '@shared/ui/BirthDateInput';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

type Errors = Partial<Record<'username' | 'countryCode' | 'phone' | 'birthDate', string>>;

/**
 * Completa una cuenta nacida de «Continuar con Google» (`ADR-012`): Google no entrega teléfono, país
 * ni fecha de nacimiento, y THERS es solo para mayores de 18. Reutiliza `PATCH /api/users/me`
 * (`ADR-003`); no hay endpoint nuevo.
 *
 * El nombre de usuario arranca VACÍO a propósito: el servidor generó uno provisional
 * (`user_xxxxxxxxxxxx`) y no se ofrece como sugerencia para que no se quede así por inercia.
 *
 * No hay «Atrás»: salir de aquí es cerrar sesión, no saltarse el paso. El servidor es quien decide
 * `profile_completed`; esta pantalla no se puede esquivar cambiando de ruta (lo vigilan `index` y las
 * pestañas).
 */
export default function CompleteProfile() {
  const { user, refreshUser, logout } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [countryCode, setCountryCode] = useState('+503');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) return <Redirect href="/login" />;
  if (user.profile_completed) return <Redirect href="/home" />;

  function validate(): Errors {
    const next: Errors = {};
    if (!username.trim()) next.username = t('form.error.usernameRequired');
    else if (!isValidUsername(username)) {
      next.username = t('form.error.usernameInvalid');
    }
    if (!isValidCountryCode(countryCode)) next.countryCode = t('form.error.country');
    if (!phone.trim()) next.phone = t('form.error.phoneRequired');
    else if (!isValidPhone(phone)) next.phone = t('form.error.phoneInvalid');
    if (!birthDate) next.birthDate = t('form.error.birthRequired');
    else if (!isValidISODate(birthDate)) next.birthDate = t('form.error.birthInvalid');
    else if (!meetsMinimumAge(birthDate)) next.birthDate = t('age.min', { years: MIN_AGE_YEARS });
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
      await request('/users/me', {
        method: 'PATCH',
        authenticated: true,
        body: {
          username: username.trim(),
          phone: phone.trim(),
          country_code: countryCode.trim(),
          birth_date: birthDate,
        },
      });
      // El servidor recalcula `profile_completed`: se vuelve a leer el usuario en vez de suponerlo.
      await refreshUser();
      router.replace('/home');
    } catch (e) {
      if (e instanceof ApiError) {
        // El servidor revalida la edad: si rechaza, se muestra bajo el campo.
        const body = e.body as { min_age?: number } | null;
        if (e.status === 400 && body?.min_age) setErrors({ birthDate: e.message });
        else if (e.status === 409) setErrors({ username: e.message });
        else setFormError(e.message);
      } else {
        setFormError(t('common.unexpected'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen title={t('complete.title')}>
      <Text style={styles.intro}>{t('complete.intro')}</Text>

      {formError ? <Banner tone="error">{formError}</Banner> : null}

      <TextField
        label={t('form.username')}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        error={errors.username}
        editable={!submitting}
      />

      <View style={styles.phoneRow}>
        <View style={styles.country}>
          <TextField
            label={t('form.country')}
            value={countryCode}
            onChangeText={setCountryCode}
            keyboardType="phone-pad"
            error={errors.countryCode}
            editable={!submitting}
          />
        </View>
        <View style={styles.phone}>
          <TextField
            label={t('form.phone')}
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

      <Text style={styles.legal}>{t('complete.legal')}</Text>

      <Button label={t('common.continue')} onPress={handleSubmit} loading={submitting} />
      <Button
        label={t('settings.logout')}
        variant="ghost"
        onPress={() => {
          void logout().then(() => router.replace('/login'));
        }}
        disabled={submitting}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  intro: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginBottom: space[4] },
  phoneRow: { flexDirection: 'row', gap: space[2] },
  country: { flex: 1 },
  phone: { flex: 2 },
  legal: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginBottom: space[4] },
}));
