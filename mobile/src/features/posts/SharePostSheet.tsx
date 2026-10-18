import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchConversations, newClientId, sendPostMessage } from '@features/messages/api';
import { fetchGroups } from '@features/messages/groups';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';

import type { Post } from './types';

/** A quién se puede mandar: una persona con la que ya hay conversación o un grupo (`ADR-048`). */
type Target = { kind: 'user' | 'group'; id: string; name: string; avatar_url: string | null };

type Props = {
  post: Post | null;
  onClose: () => void;
  onShared: (name: string) => void;
};

/**
 * Mandar una publicación por chat (`ADR-047`). Se elige entre las personas con las que ya hay una
 * conversación; el servidor vuelve a comprobar bloqueos, privacidad y que quien comparte pueda ver la
 * publicación, así que aquí solo se muestra el resultado.
 */
export function SharePostSheet({ post, onClose, onShared }: Props) {
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<Target[] | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!post) return;
    setPeople(null);
    setError(null);
    setSendingTo(null);
    const controller = new AbortController();
    Promise.all([
      fetchConversations(controller.signal),
      // Los grupos son un añadido: si fallan, se puede seguir compartiendo con personas.
      fetchGroups(controller.signal).catch(() => []),
    ])
      .then(([rows, groups]) =>
        setPeople([
          ...groups.map((g) => ({ kind: 'group' as const, id: g.id, name: g.name, avatar_url: null })),
          ...rows.map((row) => ({ kind: 'user' as const, id: row.user.id, name: row.user.name, avatar_url: row.user.avatar_url })),
        ]),
      )
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof ApiError ? e.message : 'No pudimos cargar tus conversaciones.');
        setPeople([]);
      });
    return () => controller.abort();
  }, [post]);

  async function send(person: Target) {
    if (!post || sendingTo) return;
    setSendingTo(`${person.kind}-${person.id}`);
    setError(null);
    try {
      await sendPostMessage({ kind: person.kind, id: person.id }, post.id, newClientId());
      onShared(person.name);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo enviar. Inténtalo de nuevo.');
      setSendingTo(null);
    }
  }

  return (
    <Modal visible={post !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar">
        <View />
      </Pressable>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space[3] }]}>
        <Text style={styles.title}>Enviar por mensaje</Text>
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {people === null ? (
          <Text style={styles.muted}>Cargando…</Text>
        ) : people.length === 0 && !error ? (
          <Text style={styles.muted}>
            Aún no tienes conversaciones. Escribe a alguien primero y podrás enviarle publicaciones.
          </Text>
        ) : (
          <ScrollView style={styles.list}>
            {people.map((person) => (
              <Pressable
                key={`${person.kind}-${person.id}`}
                onPress={() => send(person)}
                disabled={sendingTo !== null}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed, sendingTo !== null && styles.rowDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`Enviar a ${person.name}`}
              >
                {person.kind === 'group' ? (
                  <View style={styles.groupAvatar}>
                    <Icon name="group" size={22} color={colors.onBrand} />
                  </View>
                ) : (
                  <Avatar name={person.name} uri={person.avatar_url} size={40} />
                )}
                <Text style={styles.name} numberOfLines={1}>
                  {person.name}
                </Text>
                <Text style={styles.send}>{sendingTo === `${person.kind}-${person.id}` ? 'Enviando…' : 'Enviar'}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        <Pressable style={styles.cancel} onPress={onClose} disabled={sendingTo !== null} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancelar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: space[4],
    gap: space[2],
    maxHeight: '70%',
  },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginBottom: space[1] },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], borderRadius: radius.input },
  groupAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  rowPressed: { backgroundColor: colors.bgSubtle },
  rowDisabled: { opacity: 0.5 },
  name: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: '600', color: colors.fg },
  send: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.brandText },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  error: { fontSize: fontSize.bodyMd, color: colors.dangerAccent },
  cancel: { alignItems: 'center', paddingVertical: space[3] },
  cancelText: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
}));
