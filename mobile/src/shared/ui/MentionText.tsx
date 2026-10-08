import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { colors } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

type Props = {
  text: string;
  /** Solo se resaltan los @usuario que el servidor confirmó que existen. */
  usernames: string[];
  style?: StyleProp<TextStyle>;
};

/**
 * Texto con las menciones resaltadas. El servidor resuelve qué `@usuario` son
 * cuentas reales (`mentions`), así que un `@algo` que no existe se queda como
 * texto normal en vez de parecer un enlace roto.
 */
export function MentionText({ text, usernames, style }: Props) {
  if (usernames.length === 0) return <Text style={style}>{text}</Text>;

  const known = new Set(usernames.map((name) => name.toLowerCase()));
  const parts = text.split(/(@[A-Za-z0-9_]{3,20})/g);

  return (
    <Text style={style}>
      {parts.map((part, index) =>
        part.startsWith('@') && known.has(part.slice(1).toLowerCase()) ? (
          <Text key={index} style={styles.mention}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

const styles = themedStyles(() => ({
  mention: { color: colors.brandText, fontWeight: '600' },
}));
