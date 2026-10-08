import { ActivityIndicator, Text, View } from 'react-native';

import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { Button } from './Button';

type Props = {
  kind: 'loading' | 'empty' | 'error';
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * Los cuatro estados que toda lista debe distinguir (cargando, vacío, error y, por
 * fuera de este componente, con datos): sin esto una pantalla en blanco no dice
 * si falló, está cargando o simplemente no hay nada.
 */
export function StateMessage({ kind, title, message, actionLabel, onAction }: Props) {
  if (kind === 'loading') {
    return (
      <View style={styles.box} accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" color={colors.brand} />
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.box} accessibilityLiveRegion={kind === 'error' ? 'polite' : 'none'}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { alignItems: 'center', justifyContent: 'center', padding: space[8] },
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, textAlign: 'center' },
  message: {
    fontSize: fontSize.bodyMd,
    color: colors.fgSecondary,
    textAlign: 'center',
    marginTop: space[2],
    lineHeight: 21,
  },
  action: { marginTop: space[4], alignSelf: 'stretch' },
}));
