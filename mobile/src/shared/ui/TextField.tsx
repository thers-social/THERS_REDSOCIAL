import { Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

type Props = Omit<TextInputProps, 'style'> & {
  label: string;
  hint?: string;
  error?: string | null;
};

/** Campo de texto con etiqueta, ayuda y error accesibles. */
export function TextField({ label, hint, error, ...inputProps }: Props) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={colors.fgDisabled}
        style={[styles.input, error ? styles.inputError : null]}
      />
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
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  inputError: { borderColor: colors.dangerAccent },
  error: { color: colors.dangerFg, fontSize: fontSize.labelMd, marginTop: space[1] },
}));
