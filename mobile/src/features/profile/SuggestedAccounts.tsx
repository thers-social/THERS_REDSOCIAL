import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { fetchSuggestions, followUser, unfollowUser } from '@features/posts/api';
import type { SuggestedUser } from '@features/posts/api';
import { messageOf } from '@features/posts/PostsContext';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';

/**
 * Cuentas sugeridas (`GET /api/users/suggestions`) en una barra horizontal, como la de Instagram al
 * tocar «descubrir personas» en el perfil. Cada tarjeta lleva al perfil, permite seguir y se puede
 * descartar con la ✕ (solo en esta pantalla; el servidor no guarda descartes).
 */
export function SuggestedAccounts({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [people, setPeople] = useState<SuggestedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, 'accepted' | 'pending'>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetchSuggestions(controller.signal, 15)
      .then(setPeople)
      .catch((e) => {
        if (!controller.signal.aborted) setError(messageOf(e));
      });
    return () => controller.abort();
  }, []);

  async function toggle(person: SuggestedUser) {
    const current = status[person.id];
    try {
      if (current) {
        await unfollowUser(person.id);
        setStatus(({ [person.id]: _removed, ...rest }) => rest);
      } else {
        const result = await followUser(person.id);
        if (result.follow_status) {
          const next = result.follow_status;
          setStatus((state) => ({ ...state, [person.id]: next }));
        }
      }
    } catch (e) {
      Alert.alert('No se pudo actualizar el seguimiento', messageOf(e));
    }
  }

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>Sugerencias para ti</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar sugerencias">
          <Icon name="close" size={18} color={colors.fgMuted} />
        </Pressable>
      </View>

      {people === null && !error ? <ActivityIndicator color={colors.brand} style={styles.loading} /> : null}
      {error ? <Text style={styles.muted}>No pudimos cargar las sugerencias.</Text> : null}
      {people && people.length === 0 ? (
        <Text style={styles.muted}>Por ahora no hay cuentas para sugerirte. Vuelve más tarde.</Text>
      ) : null}

      {people && people.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {people.map((person) => {
            const state = status[person.id];
            return (
              <View key={person.id} style={styles.card}>
                <Pressable
                  onPress={() => setPeople((current) => current?.filter((p) => p.id !== person.id) ?? current)}
                  hitSlop={8}
                  style={styles.dismiss}
                  accessibilityRole="button"
                  accessibilityLabel={`Descartar a ${person.name}`}
                >
                  <Icon name="close" size={14} color={colors.fgMuted} />
                </Pressable>
                <Pressable
                  onPress={() => router.push({ pathname: '/user/[userId]', params: { userId: person.id } })}
                  style={styles.who}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver el perfil de ${person.name}`}
                >
                  <Avatar name={person.name} uri={person.avatar_url} size={64} />
                  <Text style={styles.name} numberOfLines={1}>
                    {person.name}
                  </Text>
                  <Text style={styles.username} numberOfLines={1}>
                    @{person.username}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => toggle(person)}
                  style={[styles.followBtn, state ? styles.followBtnOn : null]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.followText, state ? styles.followTextOn : null]}>
                    {state === 'accepted'
                      ? 'Siguiendo'
                      : state === 'pending'
                        ? 'Solicitado'
                        : person.is_private
                          ? 'Solicitar'
                          : 'Seguir'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { marginBottom: space[4] },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  title: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  muted: { fontSize: fontSize.bodySm, color: colors.fgMuted },
  loading: { padding: space[4] },
  row: { gap: space[2], paddingRight: space[2] },
  card: {
    width: 150,
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: space[3],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  dismiss: { position: 'absolute', top: space[2], right: space[2], zIndex: 1 },
  who: { alignItems: 'center', gap: 2, alignSelf: 'stretch' },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg, marginTop: space[2] },
  username: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  followBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: space[2],
  },
  followBtnOn: { borderColor: colors.borderStrong, backgroundColor: colors.bgSubtle },
  followText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.onBrand },
  followTextOn: { color: colors.fgSecondary },
}));
