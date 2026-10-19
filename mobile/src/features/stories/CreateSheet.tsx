import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { Icon } from '@shared/ui/Icon';
import type { IconName } from '@shared/ui/Icon';

import type { PickedImage } from './api';
import { StoryComposerModal } from './StoryComposerModal';
import { announceStoriesChanged } from './storyEvents';

type Props = {
  visible: boolean;
  onClose: () => void;
};

type Row = { id: 'camera' | 'gallery'; icon: IconName; title: string; hint: string };

/**
 * Hoja de «Crear» (botón central, como el «+» de Instagram o TikTok): sacar una foto o elegirla de la
 * galería para una historia. Usa el mismo editor y el mismo endpoint que la tira de Inicio. Escribir una
 * publicación se hace desde el cuadro de Inicio (la pantalla `/create` sigue existiendo por enlace).
 */
export function CreateSheet({ visible, onClose }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<PickedImage | null>(null);

  const rows: Row[] = [
    { id: 'camera', icon: 'camera', title: t('create.camera'), hint: t('create.camera.hint') },
    { id: 'gallery', icon: 'image', title: t('create.gallery'), hint: t('create.gallery.hint') },
  ];

  function take(result: ImagePicker.ImagePickerResult) {
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setPicked({ uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName });
  }

  async function choose(id: Row['id']) {
    try {
      if (id === 'camera') {
        take(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 }));
        return;
      }
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('strip.permission.title'), t('strip.permission.body'));
        return;
      }
      take(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false }));
    } catch {
      // Sin cámara disponible o sin permiso concedido: se dice y se ofrece la galería, sin romper nada.
      Alert.alert(t('create.error.title'), t('create.error.body'));
    }
  }

  return (
    <>
      <Modal visible={visible && !picked} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + space[4] }]} onPress={() => undefined}>
            <View style={styles.grabber} />
            <Text style={styles.title} accessibilityRole="header">
              {t('create.title')}
            </Text>
            {rows.map((row) => (
              <Pressable
                key={row.id}
                onPress={() => void choose(row.id)}
                style={styles.row}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}. ${row.hint}`}
              >
                <View style={styles.iconBox}>
                  <Icon name={row.icon} size={22} color={colors.brandText} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowHint}>{row.hint}</Text>
                </View>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {picked ? (
        <StoryComposerModal
          image={picked}
          onClose={() => {
            setPicked(null);
            onClose();
          }}
          onPublished={() => {
            announceStoriesChanged();
            router.navigate('/');
          }}
        />
      ) : null}
    </>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.dialog,
    borderTopRightRadius: radius.dialog,
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: space[3],
  },
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 64, paddingVertical: space[2] },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  rowHint: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2 },
}));
