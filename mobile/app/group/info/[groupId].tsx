import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { fetchConversations } from '@features/messages/api';
import type { ConversationSummary } from '@features/messages/api';
import {
  MAX_GROUP_NAME,
  addGroupMembers,
  fetchGroup,
  leaveGroup,
  promoteGroupMember,
  removeGroupMember,
  renameGroup,
} from '@features/messages/groups';
import type { GroupDetail } from '@features/messages/groups';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

const messageOf = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Inténtalo de nuevo.');

/**
 * Información y gestión de un chat grupal (`ADR-048`): miembros y roles, y -- para administradores --
 * renombrar, añadir, quitar y nombrar administradores. Cualquier miembro puede salir. El servidor lo vuelve
 * a comprobar todo; aquí solo se ocultan los controles que no corresponden.
 */
export default function GroupInfo() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [people, setPeople] = useState<ConversationSummary['user'][]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await fetchGroup(groupId);
      setGroup(loaded);
      setName(loaded.name);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [groupId]);

  useEffect(() => {
    void load();
    fetchConversations()
      .then((rows) => setPeople(rows.map((row) => row.user)))
      .catch(() => setPeople([]));
  }, [load]);

  async function run(action: () => Promise<GroupDetail>) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await action();
      setGroup(updated);
      setName(updated.name);
      setError(null);
    } catch (e) {
      Alert.alert('No se pudo completar', messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmLeave() {
    Alert.alert(
      '¿Salir de este grupo?',
      'Dejarás de recibir sus mensajes. Para volver, un administrador tendrá que añadirte.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await leaveGroup(groupId);
              router.dismissTo('/(tabs)/messages');
            } catch (e) {
              setBusy(false);
              Alert.alert('No se pudo salir', messageOf(e));
            }
          },
        },
      ],
    );
  }

  if (!user) return null;
  const isAdmin = group?.my_role === 'admin';
  const memberIds = new Set((group?.members ?? []).map((m) => m.id));
  const addable = people.filter((p) => !memberIds.has(p.id));

  return (
    <Screen title="Información del grupo" back>
      {!group ? (
        error ? (
          <StateMessage kind="error" message={error} actionLabel="Reintentar" onAction={load} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : (
        <>
          {error ? <Banner tone="error">{error}</Banner> : null}
          {isAdmin ? (
            <View style={styles.renameRow}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                maxLength={MAX_GROUP_NAME}
                accessibilityLabel="Nombre del grupo"
              />
              <Pressable
                onPress={() => run(() => renameGroup(groupId, name.trim()))}
                disabled={busy || !name.trim() || name.trim() === group.name}
                style={[styles.textButton, (busy || !name.trim() || name.trim() === group.name) && styles.disabled]}
                accessibilityRole="button"
                accessibilityLabel="Guardar nombre"
              >
                <Text style={styles.action}>Guardar</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.title}>{group.name}</Text>
          )}

          <Text style={styles.section}>{group.members.length} personas</Text>
          {group.members.map((member) => (
            <View key={member.id} style={styles.row}>
              <Avatar name={member.name} uri={member.avatar_url} size={40} />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {member.name}
                  {member.id === user.id ? ' (tú)' : ''}
                </Text>
                {member.role === 'admin' ? <Text style={styles.badge}>Administrador</Text> : null}
              </View>
              {isAdmin && member.role !== 'admin' ? (
                <View style={styles.rowActions}>
                  <Pressable
                    disabled={busy}
                    onPress={() => run(() => promoteGroupMember(groupId, member.id))}
                    accessibilityRole="button"
                    accessibilityLabel={`Hacer administrador a ${member.name}`}
                  >
                    <Text style={styles.action}>Hacer admin</Text>
                  </Pressable>
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      Alert.alert(`¿Quitar a ${member.name}?`, 'Dejará de ver los mensajes del grupo.', [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                          text: 'Quitar',
                          style: 'destructive',
                          onPress: () => run(() => removeGroupMember(groupId, member.id)),
                        },
                      ])
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar a ${member.name}`}
                  >
                    <Text style={styles.danger}>Quitar</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}

          {isAdmin ? (
            <>
              <Text style={styles.section}>Añadir personas</Text>
              {addable.length === 0 ? (
                <Text style={styles.muted}>Todas las personas con las que chateas ya están en el grupo.</Text>
              ) : (
                addable.map((person) => (
                  <View key={person.id} style={styles.row}>
                    <Avatar name={person.name} uri={person.avatar_url} size={40} />
                    <Text style={[styles.name, styles.rowText]} numberOfLines={1}>
                      {person.name}
                    </Text>
                    <Pressable
                      disabled={busy}
                      onPress={() => run(() => addGroupMembers(groupId, [person.id]))}
                      accessibilityRole="button"
                      accessibilityLabel={`Añadir a ${person.name}`}
                    >
                      <Text style={styles.action}>Añadir</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </>
          ) : null}

          <Pressable
            onPress={confirmLeave}
            disabled={busy}
            style={styles.leave}
            accessibilityRole="button"
            accessibilityLabel="Salir del grupo"
          >
            <Text style={styles.danger}>Salir del grupo</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, marginBottom: space[2] },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[2] },
  input: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: space[3],
    fontSize: fontSize.bodyLg,
    color: colors.fg,
  },
  textButton: { paddingHorizontal: space[2], minHeight: 44, justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  section: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fgMuted, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  rowText: { flex: 1 },
  rowActions: { flexDirection: 'row', gap: space[3] },
  name: { fontSize: fontSize.bodyMd, fontWeight: '600', color: colors.fg },
  badge: { fontSize: fontSize.labelMd, color: colors.brandText },
  action: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  danger: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.dangerAccent },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  leave: { marginTop: space[6], minHeight: 48, alignItems: 'center', justifyContent: 'center' },
}));
