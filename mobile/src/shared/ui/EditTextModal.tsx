import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { Banner } from './Banner';
import { Button } from './Button';

type Props = {
  visible: boolean;
  title: string;
  initialValue: string;
  maxLength: number;
  confirmLabel?: string;
  /** Debe lanzar un `Error` con un mensaje legible si falla: se muestra aquí mismo. */
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
};

/** Ventana para editar un texto (una publicación, un comentario, un mensaje). */
export function EditTextModal({
  visible,
  title,
  initialValue,
  maxLength,
  confirmLabel = 'Guardar',
  onSubmit,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada vez que se abre, parte del texto actual y sin errores viejos.
  useEffect(() => {
    if (visible) {
      setText(initialValue);
      setError(null);
      setBusy(false);
    }
  }, [visible, initialValue]);

  const trimmed = text.trim();
  const changed = trimmed !== initialValue.trim();

  async function submit() {
    if (busy || !trimmed || !changed) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos guardar los cambios.');
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior="padding"
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space[4] }]}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={maxLength}
            autoFocus
            textAlignVertical="top"
            accessibilityLabel={title}
            editable={!busy}
          />
          <Text style={styles.counter}>
            {text.length}/{maxLength}
          </Text>
          <View style={styles.buttons}>
            <Button label="Cancelar" variant="secondary" onPress={onClose} disabled={busy} style={styles.flex} />
            <Button
              label={confirmLabel}
              onPress={submit}
              loading={busy}
              disabled={!trimmed || !changed}
              style={styles.flex}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.dialog,
    borderTopRightRadius: radius.dialog,
    padding: space[4],
  },
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, marginBottom: space[3] },
  input: {
    minHeight: 120,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space[3],
    fontSize: fontSize.bodyLg,
    color: colors.fg,
  },
  counter: { alignSelf: 'flex-end', fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: space[1] },
  buttons: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  flex: { flex: 1 },
}));
