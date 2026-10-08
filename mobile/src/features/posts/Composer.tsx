import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { comingSoon } from '@shared/lib/comingSoon';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Icon } from '@shared/ui/Icon';

import { MAX_POST_LENGTH } from './types';

type Props = {
  /** Debe lanzar con un mensaje legible si falla. */
  onPublish: (content: string, isSensitive: boolean) => Promise<void>;
};

/** Caja para escribir una publicación (solo texto, hasta 2000 caracteres). */
export function Composer({ onPublish }: Props) {
  const [text, setText] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();

  async function publish() {
    if (busy || !trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onPublish(trimmed, sensitive);
      // Solo se limpia si salió bien: perder lo escrito por un fallo de red es
      // lo peor que puede pasar en un campo de texto.
      setText('');
      setSensitive(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos publicar. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="¿Qué estás creando hoy?"
        placeholderTextColor={colors.fgDisabled}
        multiline
        maxLength={MAX_POST_LENGTH}
        textAlignVertical="top"
        accessibilityLabel="Escribir una publicación"
        editable={!busy}
      />
      <View style={styles.row}>
        <View style={styles.sensitive}>
          <Switch
            value={sensitive}
            onValueChange={setSensitive}
            trackColor={{ true: colors.brand, false: colors.borderStrong }}
            accessibilityLabel="Marcar como contenido sensible"
            disabled={busy}
          />
          <Text style={styles.sensitiveText}>Contenido sensible</Text>
        </View>
        <View style={styles.tools}>
          <Pressable
            onPress={() => comingSoon('Los atajos de IA')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Asistente de IA (próximamente)"
          >
            <Icon name="sparkle" size={20} color={colors.brandText} />
          </Pressable>
          <Pressable
            onPress={() => comingSoon('Adjuntar fotos y videos')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Adjuntar imagen (próximamente)"
          >
            <Icon name="image" size={20} color={colors.fgSecondary} />
          </Pressable>
          <Text style={styles.counter}>
            {text.length}/{MAX_POST_LENGTH}
          </Text>
        </View>
      </View>
      <Button label="Publicar" onPress={publish} loading={busy} disabled={!trimmed} />
    </View>
  );
}

const styles = themedStyles(() => ({
  box: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[4],
    marginBottom: space[4],
  },
  input: {
    minHeight: 80,
    maxHeight: 200,
    fontSize: fontSize.bodyLg,
    color: colors.fg,
    padding: 0,
    marginBottom: space[3],
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  sensitive: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  sensitiveText: { fontSize: fontSize.bodySm, color: colors.fgSecondary },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  counter: { fontSize: fontSize.labelMd, color: colors.fgMuted },
}));
