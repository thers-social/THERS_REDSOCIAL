import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { User } from '@features/auth/types';
import type { ProfilePatch } from '@features/settings/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { Banner } from './Banner';
import { Button } from './Button';
import { TextField } from './TextField';

type Props = {
  visible: boolean;
  user: User;
  /** Debe lanzar un `Error` legible si falla. */
  onSave: (patch: ProfilePatch) => Promise<void>;
  onClose: () => void;
};

// Mismos límites que `_TEXT_LIMITS` del backend (`user_routes.py`).
const LIMITS = { name: 120, bio: 160, location: 60, website: 100 } as const;

/**
 * Edita nombre, biografía, ubicación y sitio web (`PATCH /api/users/me`). Cambiar
 * el @usuario, el teléfono o la foto todavía no está en la app móvil (el cambio de
 * usuario tiene un plazo de espera de 30 días; la foto necesita acceso a la
 * galería): se hacen desde la web.
 */
export function EditProfileModal({ visible, user, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? '');
  const [location, setLocation] = useState(user.location ?? '');
  const [website, setWebsite] = useState(user.website ?? '');
  const [busy, setBusy] = useState(false);
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

  async function save() {
    if (busy) return;
    if (!name.trim()) {
      setError('El nombre no puede estar vacío.');
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
            Editar perfil
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {error ? <Banner tone="error">{error}</Banner> : null}
            <TextField label="Nombre" value={name} onChangeText={setName} maxLength={LIMITS.name} editable={!busy} />
            <TextField
              label="Biografía"
              value={bio}
              onChangeText={setBio}
              maxLength={LIMITS.bio}
              multiline
              editable={!busy}
            />
            <TextField
              label="Ubicación"
              value={location}
              onChangeText={setLocation}
              maxLength={LIMITS.location}
              editable={!busy}
            />
            <TextField
              label="Sitio web"
              value={website}
              onChangeText={setWebsite}
              maxLength={LIMITS.website}
              autoCapitalize="none"
              keyboardType="url"
              editable={!busy}
            />
          </ScrollView>
          <View style={styles.buttons}>
            <Button label="Cancelar" variant="secondary" onPress={onClose} disabled={busy} style={styles.flex} />
            <Button label="Guardar" onPress={save} loading={busy} style={styles.flex} />
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
  buttons: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  flex: { flex: 1 },
}));
