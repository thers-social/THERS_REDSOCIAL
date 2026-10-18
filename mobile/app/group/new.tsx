import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { fetchConversations } from '@features/messages/api';
import type { ConversationSummary } from '@features/messages/api';
import { MAX_GROUP_MEMBERS, MAX_GROUP_NAME, createGroup } from '@features/messages/groups';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

type Person = ConversationSummary['user'];

/**
 * Crear un chat grupal (`ADR-048`). Se elige entre las personas con las que ya hay una conversación; el
 * servidor vuelve a comprobar bloqueos y quién acepta mensajes de quién. Quien lo crea es administrador.
 */
export default function NewGroup() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchConversations(controller.signal)
      .then((rows) => setPeople(rows.map((row) => row.user)))
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof ApiError ? e.message : 'No pudimos cargar tus conversaciones.');
        setPeople([]);
      });
    return () => controller.abort();
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_GROUP_MEMBERS - 1) next.add(id);
      return next;
    });
  }

  const canCreate = name.trim().length > 0 && selected.size > 0 && !saving;

  async function submit() {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const group = await createGroup(name.trim(), [...selected]);
      router.replace({ pathname: '/group/[groupId]', params: { groupId: group.id, name: group.name } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear el grupo. Inténtalo de nuevo.');
      setSaving(false);
    }
  }

  return (
    <Screen title="Nuevo grupo" back>
      <Text style={styles.label}>Nombre del grupo</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        maxLength={MAX_GROUP_NAME}
        placeholder="Por ejemplo, Amigos del barrio"
        placeholderTextColor={colors.fgDisabled}
        accessibilityLabel="Nombre del grupo"
      />

      <Text style={styles.label}>Personas ({selected.size} elegidas)</Text>
      {people === null ? (
        <StateMessage kind="loading" />
      ) : people.length === 0 ? (
        <Text style={styles.muted}>
          Aún no tienes conversaciones. Escribe a alguien primero y podrás añadirle a un grupo.
        </Text>
      ) : (
        people.map((person) => {
          const on = selected.has(person.id);
          return (
            <Pressable
              key={person.id}
              onPress={() => toggle(person.id)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={person.name}
            >
              <Avatar name={person.name} uri={person.avatar_url} size={40} />
              <Text style={styles.name} numberOfLines={1}>
                {person.name}
              </Text>
              <View style={[styles.check, on && styles.checkOn]}>
                {on ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
            </Pressable>
          );
        })
      )}

      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button label="Crear grupo" onPress={submit} loading={saving} disabled={!canCreate} />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  label: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg, marginTop: space[3], marginBottom: space[2] },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: space[3],
    fontSize: fontSize.bodyLg,
    color: colors.fg,
  },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted, marginBottom: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], borderRadius: radius.input },
  rowPressed: { backgroundColor: colors.surface },
  name: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: '600', color: colors.fg },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkMark: { color: colors.onBrand, fontWeight: '700', fontSize: fontSize.labelLg },
}));
