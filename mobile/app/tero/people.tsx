import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { fetchSuggestions, followUser, unfollowUser } from '@features/posts/api';
import type { SuggestedUser } from '@features/posts/api';
import { messageOf } from '@features/posts/PostsContext';
import { TeroAvatar } from '@features/tero/components/TeroAvatar';
import { TeroGate } from '@features/tero/components/TeroGate';
import { useTero } from '@features/tero/context/TeroContext';
import { useReducedMotion } from '@features/tero/lib/useReducedMotion';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * «Personas» de Tero: a quién seguir. Las cuentas salen de `GET /api/users/suggestions` (sin bloqueadas,
 * sin las que ya sigues ni a las que pediste seguir): es el mismo criterio que la barra del perfil, dicho
 * con la voz de Tero. Seguir es un toque tuyo; Tero no sigue a nadie por su cuenta.
 */
export default function TeroPeople() {
  return (
    <TeroGate>
      <TeroPeopleContent />
    </TeroGate>
  );
}

function TeroPeopleContent() {
  const router = useRouter();
  const { preferences } = useTero();
  const reducedMotion = useReducedMotion();
  const [people, setPeople] = useState<SuggestedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, 'accepted' | 'pending'>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetchSuggestions(controller.signal, 10)
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
    <Screen title="Personas" back>
      <View style={styles.hero}>
        <TeroAvatar size={72} mood="happy" animated={preferences.animations && !reducedMotion} />
        <Text style={styles.intro}>Mira a quién podrías seguir. Tú decides: yo no sigo a nadie por ti.</Text>
      </View>

      {people === null && !error ? <StateMessage kind="loading" /> : null}
      {error ? <StateMessage kind="error" message={error} /> : null}
      {people && people.length === 0 ? (
        <StateMessage
          kind="empty"
          title="Por ahora no tengo sugerencias"
          message="Ya sigues a casi todas las cuentas que conozco. Vuelve más tarde."
        />
      ) : null}

      {people?.map((person) => {
        const state = status[person.id];
        return (
          <View key={person.id} style={styles.row}>
            <Pressable
              onPress={() => router.push({ pathname: '/user/[userId]', params: { userId: person.id } })}
              style={styles.who}
              accessibilityRole="button"
              accessibilityLabel={`Ver el perfil de ${person.name}`}
            >
              <Avatar name={person.name} uri={person.avatar_url} size={48} />
              <View style={styles.text}>
                <Text style={styles.name} numberOfLines={1}>
                  {person.name}
                </Text>
                <Text style={styles.username} numberOfLines={1}>
                  @{person.username}
                  {person.is_private ? ' · Privada' : ''}
                </Text>
              </View>
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

      <Button
        label="Pregúntale a Tero"
        variant="secondary"
        onPress={() =>
          router.push({ pathname: '/tero/chat', params: { prompt: '¿A quién me recomiendas seguir?' } })
        }
        style={styles.ask}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  hero: { alignItems: 'center', paddingVertical: space[4], gap: space[2] },
  intro: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.card,
    padding: space[3],
    marginBottom: space[2],
  },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, marginHorizontal: space[3] },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  username: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  followBtn: {
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  followBtnOn: { borderColor: colors.borderStrong, backgroundColor: colors.bgSubtle },
  followText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.onBrand },
  followTextOn: { color: colors.fgSecondary },
  ask: { marginTop: space[4] },
}));
