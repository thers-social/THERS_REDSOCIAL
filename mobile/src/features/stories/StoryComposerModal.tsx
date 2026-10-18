import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, Text, TextInput, View } from 'react-native';

import { messageOf } from '@features/posts/PostsContext';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { createStory } from './api';
import type { PickedImage } from './api';

/** Mismo máximo que el servidor (`MAX_STORY_TEXT`, ADR-042). */
export const MAX_STORY_TEXT = 200;

type Props = {
  image: PickedImage;
  onClose: () => void;
  onPublished: () => void;
};

/** Vista previa de la imagen elegida, texto opcional y publicar. El servidor valida y reduce todo. */
export function StoryComposerModal({ image, onClose, onPublished }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function publish() {
    if (busy) return;
    setBusy(true);
    try {
      await createStory(image, text);
      onPublished();
      onClose();
    } catch (e) {
      Alert.alert('No se pudo publicar la historia', messageOf(e));
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <View style={styles.root}>
        <Text style={styles.title}>Nueva historia</Text>
        <Image
          source={{ uri: image.uri }}
          style={styles.preview}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          accessibilityLabel="Vista previa de la historia"
        />
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(value) => setText(value.slice(0, MAX_STORY_TEXT))}
          placeholder="Texto (opcional)"
          placeholderTextColor={colors.fgDisabled}
          multiline
          editable={!busy}
          accessibilityLabel="Texto de la historia"
        />
        <Text style={styles.counter}>
          {text.length}/{MAX_STORY_TEXT}
        </Text>
        <Text style={styles.note}>Dura 24 horas. La verán quienes te siguen.</Text>

        <Pressable
          onPress={publish}
          disabled={busy}
          style={[styles.primary, busy && styles.disabled]}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>Publicar historia</Text>}
        </Pressable>
        <Pressable onPress={onClose} disabled={busy} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>Cancelar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg, padding: space[4], paddingTop: space[8] },
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, marginBottom: space[3] },
  preview: { width: '100%', height: '46%', borderRadius: radius.card, backgroundColor: colors.bgSubtle },
  input: {
    marginTop: space[3],
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    color: colors.fg,
    fontSize: fontSize.bodyMd,
    padding: space[3],
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: space[1] },
  note: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginVertical: space[2] },
  primary: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  primaryText: { color: colors.onBrand, fontSize: fontSize.bodyMd, fontWeight: '700' },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  secondaryText: { color: colors.fgSecondary, fontSize: fontSize.bodyMd, fontWeight: '600' },
}));
