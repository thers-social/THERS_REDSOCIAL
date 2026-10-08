import { Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

/**
 * Aviso de vista previa. Toda pantalla de Tero con datos de ejemplo lo muestra:
 * nada se presenta como actividad real de la persona.
 */
export function TeroPreviewNotice({ message }: { message: string }) {
  return (
    <View style={styles.box} accessibilityRole="text">
      <Text style={styles.label}>Vista previa</Text>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  box: {
    backgroundColor: colors.brandSoft,
    borderRadius: radius.input,
    padding: space[3],
    marginBottom: space[4],
  },
  label: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.brandText, marginBottom: 2 },
  text: { fontSize: fontSize.bodySm, color: colors.fgSecondary, lineHeight: 18 },
}));
