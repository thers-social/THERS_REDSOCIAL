import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, Text, TextInput, View } from 'react-native';

import { messageOf } from '@features/posts/PostsContext';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';

import { createStory } from './api';
import type { PickedImage } from './api';
import type { StoryAudience } from './types';

/** Mismo máximo que el servidor (`MAX_STORY_TEXT`, ADR-042). */
export const MAX_STORY_TEXT = 200;

type Props = {
  image: PickedImage;
  onClose: () => void;
  onPublished: () => void;
};

/**
 * Vista previa de la imagen elegida, texto opcional, para quién va (`ADR-054`) y publicar. El servidor
 * valida y reduce todo, y es quien aplica la audiencia: aquí solo se elige.
 */
export function StoryComposerModal({ image, onClose, onPublished }: Props) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<StoryAudience>('everyone');
  const [busy, setBusy] = useState(false);

  async function publish() {
    if (busy) return;
    setBusy(true);
    try {
      await createStory(image, text, audience);
      onPublished();
      onClose();
    } catch (e) {
      Alert.alert(t('story.error.publish'), messageOf(e));
      setBusy(false);
    }
  }

  const options: { id: StoryAudience; label: string }[] = [
    { id: 'everyone', label: t('story.audience.everyone') },
    { id: 'close_friends', label: t('story.audience.closeFriends') },
  ];

  return (
    <Modal visible animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <View style={styles.root}>
        <Text style={styles.title}>{t('story.new')}</Text>
        <Image
          source={{ uri: image.uri }}
          style={styles.preview}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          accessibilityLabel={t('story.preview')}
        />
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(value) => setText(value.slice(0, MAX_STORY_TEXT))}
          placeholder={t('story.text.placeholder')}
          placeholderTextColor={colors.fgDisabled}
          multiline
          editable={!busy}
          accessibilityLabel={t('story.text.a11y')}
        />
        <Text style={styles.counter}>
          {text.length}/{MAX_STORY_TEXT}
        </Text>

        <View style={styles.audience} accessibilityRole="radiogroup">
          {options.map((option) => {
            const selected = option.id === audience;
            const green = option.id === 'close_friends';
            return (
              <Pressable
                key={option.id}
                onPress={() => setAudience(option.id)}
                disabled={busy}
                style={[styles.choice, selected && (green ? styles.choiceGreen : styles.choiceOn)]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>
                  {green ? '★ ' : ''}
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.note}>
          {audience === 'close_friends' ? t('story.note.closeFriends') : t('story.note.everyone')}
        </Text>

        <Pressable
          onPress={publish}
          disabled={busy}
          style={[styles.primary, busy && styles.disabled]}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>{t('story.publish')}</Text>}
        </Pressable>
        <Pressable onPress={onClose} disabled={busy} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg, padding: space[4], paddingTop: space[8] },
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, marginBottom: space[3] },
  preview: { width: '100%', height: '40%', borderRadius: radius.card, backgroundColor: colors.bgSubtle },
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
  audience: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  choice: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space[2],
  },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  // La estrella de «Mejores amigos» es morada en toda la app (el anillo de la tira sigue verde).
  choiceGreen: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  choiceText: { fontSize: fontSize.bodySm, fontWeight: '600', color: colors.fgSecondary },
  choiceTextOn: { color: colors.fg },
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
