import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { MIN_AGE_YEARS } from '@features/auth/lib/age';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

type Props = {
  /** Recibe `yyyy-mm-dd` cuando los tres campos forman una fecha completa, o `''`. */
  onChange: (iso: string) => void;
  error?: string | null;
};

/**
 * Fecha de nacimiento en tres campos numéricos (día, mes, año). En el teléfono
 * es más rápido y menos propenso a error que un calendario de cientos de años, y
 * no necesita una dependencia nueva. El foco avanza solo al completar cada campo.
 *
 * Emite la fecha ISO únicamente cuando está completa; si falta algo emite `''`.
 * Si es una fecha real y si cumple la edad lo decide quien la recibe.
 */
export function BirthDateInput({ onChange, error }: Props) {
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  function emit(d: string, m: string, y: string) {
    if (d.length >= 1 && m.length >= 1 && y.length === 4) {
      onChange(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    } else {
      onChange('');
    }
  }

  function digits(value: string, max: number) {
    return value.replace(/\D/g, '').slice(0, max);
  }

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>Fecha de nacimiento</Text>
      <Text style={styles.hint}>THERS es solo para personas de {MIN_AGE_YEARS} años o más.</Text>
      <View style={styles.row} accessibilityRole="none">
        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          placeholder="Día"
          accessibilityLabel="Día de nacimiento"
          placeholderTextColor={colors.fgDisabled}
          keyboardType="number-pad"
          maxLength={2}
          value={day}
          onChangeText={(value) => {
            const next = digits(value, 2);
            setDay(next);
            emit(next, month, year);
            if (next.length === 2) monthRef.current?.focus();
          }}
        />
        <TextInput
          ref={monthRef}
          style={[styles.input, error ? styles.inputError : null]}
          placeholder="Mes"
          accessibilityLabel="Mes de nacimiento"
          placeholderTextColor={colors.fgDisabled}
          keyboardType="number-pad"
          maxLength={2}
          value={month}
          onChangeText={(value) => {
            const next = digits(value, 2);
            setMonth(next);
            emit(day, next, year);
            if (next.length === 2) yearRef.current?.focus();
          }}
        />
        <TextInput
          ref={yearRef}
          style={[styles.input, styles.inputYear, error ? styles.inputError : null]}
          placeholder="Año"
          accessibilityLabel="Año de nacimiento"
          placeholderTextColor={colors.fgDisabled}
          keyboardType="number-pad"
          maxLength={4}
          value={year}
          onChangeText={(value) => {
            const next = digits(value, 4);
            setYear(next);
            emit(day, month, next);
          }}
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  wrapper: { marginBottom: space[4] },
  label: { fontSize: fontSize.labelLg, fontWeight: '600', color: colors.fg, marginBottom: space[1] },
  hint: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginBottom: space[1] },
  row: { flexDirection: 'row', gap: space[2] },
  input: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
    textAlign: 'center',
  },
  inputYear: { flex: 1.5 },
  inputError: { borderColor: colors.dangerAccent },
  error: { color: colors.dangerFg, fontSize: fontSize.labelMd, marginTop: space[1] },
}));
