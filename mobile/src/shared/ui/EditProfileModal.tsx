import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { User } from '@features/auth/types';
import type { ProfilePatch } from '@features/settings/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { MediaSelectionError, pickImages } from '@shared/media/pickMedia';
import type { PickedMedia } from '@shared/media/mediaRules';

import { Avatar } from './Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { TextField } from './TextField';

type Props = {
  visible: boolean;
  user: User;
  /** Debe lanzar un `Error` legible si falla. */
  onSave: (patch: ProfilePatch) => Promise<void>;
  /**
   * Cambia (`media`) o quita (`null`) la foto de perfil (`ADR-015`). Se aplica al momento, sin esperar a
   * «Guardar», igual que en la web. Debe lanzar un `Error` legible si falla.
   */
  onAvatar: (media: PickedMedia | null) => Promise<void>;
  onClose: () => void;
};

// Mismos límites que `_TEXT_LIMITS` del backend (`user_routes.py`).
const LIMITS = { name: 120, bio: 160, location: 60, website: 100 } as const;

/**
 * Edita nombre, biografía, ubicación y sitio web (`PATCH /api/users/me`). Cambiar
 * el @usuario o el teléfono todavía no está en la app móvil (el cambio de usuario tiene un plazo de
 * espera de 30 días): se hace desde la web. La foto de perfil sí se cambia aquí (`ADR-046`).
 */
export function EditProfileModal({ visible, user, onSave, onAvatar, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? '');
  const [location, setLocation] = useState(user.location ?? '');
  const [website, setWebsite] = useState(user.website ?? '');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(user.name);
      setBio(user.bio ?? '');
      setLocation(user.location ?? '');
      setWebsite(user.website ?? '');
      setError(null);
      setBusy(false);
    }
  }, [visible, user]);

  async function changePhoto(remove: boolean) {
    if (photoBusy || busy) return;
    setError(null);
    setPhotoBusy(true);
    try {
      if (remove) {
        await onAvatar(null);
      } else {
        const [picked] = await pickImages(1);
        if (picked) await onAvatar(picked);
      }
    } catch (e) {
      setError(
        e instanceof MediaSelectionError || e instanceof Error ? e.message : t('editProfile.error.photo'),
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    if (!name.trim()) {
      setError(t('editProfile.error.nameEmpty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Solo se envía lo que cambió; un campo vacío se manda como `null` para borrarlo.
      const patch: ProfilePatch = {};
      if (name.trim() !== user.name) patch.name = name.trim();
      if (bio.trim() !== (user.bio ?? '')) patch.bio = bio.trim() || null;
      if (location.trim() !== (user.location ?? '')) patch.location = location.trim() || null;
      if (website.trim() !== (user.website ?? '')) patch.website = website.trim() || null;
      if (Object.keys(patch).length > 0) await onSave(patch);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('editProfile.error.save'));
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
            {t('profile.edit')}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {error ? <Banner tone="error">{error}</Banner> : null}
            <View style={styles.photoRow}>
              <Avatar name={user.name} uri={user.avatar_url} size={72} />
              <View style={styles.photoActions}>
                <Button
                  label={user.avatar_url ? t('editProfile.photo.change') : t('editProfile.photo.upload')}
                  variant="secondary"
                  onPress={() => void changePhoto(false)}
                  loading={photoBusy}
                  disabled={busy}
                />
                {user.avatar_url ? (
                  <Button
                    label={t('editProfile.photo.remove')}
                    variant="ghost"
                    onPress={() => void changePhoto(true)}
                    disabled={photoBusy || busy}
                  />
                ) : null}
              </View>
            </View>
            <TextField label={t('form.name')} value={name} onChangeText={setName} maxLength={LIMITS.name} editable={!busy} />
            <TextField
              label={t('editProfile.bio')}
              value={bio}
              onChangeText={setBio}
              maxLength={LIMITS.bio}
              multiline
              editable={!busy}
            />
            <TextField
              label={t('editProfile.location')}
              value={location}
              onChangeText={setLocation}
              maxLength={LIMITS.location}
              editable={!busy}
            />
            <TextField
              label={t('editProfile.website')}
              value={website}
              onChangeText={setWebsite}
              maxLength={LIMITS.website}
              autoCapitalize="none"
              keyboardType="url"
              editable={!busy}
            />
          </ScrollView>
          <View style={styles.buttons}>
            <Button label={t('common.cancel')} variant="secondary" onPress={onClose} disabled={busy} style={styles.flex} />
            <Button label={t('common.save')} onPress={save} loading={busy} style={styles.flex} />
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
    maxHeight: '90%',
  },
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, marginBottom: space[3] },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[3] },
  photoActions: { flex: 1, gap: space[1] },
  buttons: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  flex: { flex: 1 },
}));
