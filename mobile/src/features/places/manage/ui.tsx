import type { ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';

/** Mensaje legible de un error de la API o el de respaldo. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Sección del panel: título y contenido con el mismo espaciado en todo el panel. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences';
};

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  multiline = false,
  keyboardType,
  autoCapitalize = 'sentences',
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.fgDisabled}
        maxLength={maxLength}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );
}

export const manageStyles = themedStyles(() => ({
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  strong: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  row: { flexDirection: 'row', gap: space[2] },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  link: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
}));

const styles = themedStyles(() => ({
  section: { marginTop: space[6], gap: space[3] },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  card: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: { gap: space[1] },
  label: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fgMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  multiline: { minHeight: 80 },
}));
