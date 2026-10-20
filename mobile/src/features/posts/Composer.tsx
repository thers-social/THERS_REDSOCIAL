import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { MediaAttachmentBar } from '@shared/media/MediaAttachmentBar';
import { MAX_POST_IMAGES } from '@shared/media/mediaRules';
import type { PickedMedia } from '@shared/media/mediaRules';
import { useMediaAttachments } from '@shared/media/useMediaAttachments';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Icon } from '@shared/ui/Icon';

import { MAX_POST_LENGTH } from './types';

type Props = {
  /** Debe lanzar con un mensaje legible si falla. */
  onPublish: (
    content: string,
    isSensitive: boolean,
    media: PickedMedia[],
    audience: 'everyone' | 'close_friends',
  ) => Promise<void>;
};

/** Caja para escribir una publicación: hasta 2000 caracteres y, si se quiere, hasta 10 fotos o un video corto. */
export function Composer({ onPublish }: Props) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [closeFriends, setCloseFriends] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const media = useMediaAttachments({ maxImages: MAX_POST_IMAGES });

  const trimmed = text.trim();
  // Con fotos o video el texto es opcional (ADR-039, ADR-046).
  const canPublish = trimmed.length > 0 || media.items.length > 0;

  async function publish() {
    if (busy || !canPublish) return;
    setBusy(true);
    setError(null);
    try {
      await onPublish(trimmed, sensitive, media.items, closeFriends ? 'close_friends' : 'everyone');
      // Solo se limpia si salió bien: perder lo escrito por un fallo de red es
      // lo peor que puede pasar en un campo de texto.
      setText('');
      setSensitive(false);
      setCloseFriends(false);
      media.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('composer.error'));
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
        placeholder={t('composer.placeholder')}
        placeholderTextColor={colors.fgDisabled}
        multiline
        maxLength={MAX_POST_LENGTH}
        textAlignVertical="top"
        accessibilityLabel={t('composer.a11y')}
        editable={!busy}
      />
      <View style={styles.row}>
        <View style={styles.sensitive}>
          <Switch
            value={sensitive}
            onValueChange={setSensitive}
            trackColor={{ true: colors.brand, false: colors.borderStrong }}
            accessibilityLabel={t('composer.sensitive.a11y')}
            disabled={busy}
          />
          <Text style={styles.sensitiveText}>{t('composer.sensitive')}</Text>
        </View>
        <View style={styles.tools}>
          <Text style={styles.counter}>
            {text.length}/{MAX_POST_LENGTH}
          </Text>
        </View>
      </View>
      {/* Solo para la lista de mejores amigos (ADR-054); se gestiona en Ajustes. */}
      <Pressable
        onPress={() => setCloseFriends((value) => !value)}
        disabled={busy}
        style={[styles.audienceChip, closeFriends && styles.audienceChipOn]}
        accessibilityRole="switch"
        accessibilityState={{ checked: closeFriends, disabled: busy }}
        accessibilityLabel={t('composer.closeFriends.a11y')}
      >
        <Icon name="star" size={18} color={colors.brandText} filled={closeFriends} />
        <Text style={[styles.audienceText, closeFriends && styles.audienceTextOn]}>
          {t('composer.closeFriends')}
        </Text>
      </Pressable>
      <View style={styles.media}>
        <MediaAttachmentBar media={media} maxImages={MAX_POST_IMAGES} disabled={busy} />
      </View>
      <Button label={t('composer.publish')} onPress={publish} loading={busy} disabled={!canPublish || media.picking} />
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
  audienceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[2],
    minHeight: 40,
    paddingHorizontal: space[3],
    marginBottom: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  audienceChipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  audienceText: { fontSize: fontSize.bodySm, color: colors.fgSecondary, fontWeight: '600' },
  audienceTextOn: { color: colors.fg },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  counter: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  media: { marginBottom: space[3] },
}));
