import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { fetchSuggestions, followUser, searchUsers, unfollowUser } from '@features/posts/api';
import type { SuggestedUser } from '@features/posts/api';
import { PostCard } from '@features/posts/PostCard';
import { messageOf, usePosts } from '@features/posts/PostsContext';
import { searchPosts } from '@features/posts/searchPosts';
import type { SearchSort } from '@features/posts/searchPosts';
import { usePostMenu } from '@features/posts/usePostMenu';
import { useOpenProfile } from '@features/profile/useOpenProfile';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Buscar. Las PERSONAS se buscan en el servidor por nombre o usuario, hayan publicado o no
 * (`GET /api/users/search`). Las PUBLICACIONES siguen sin buscador de servidor (igual que en la
 * web): se filtran las ya cargadas (las 50 más recientes) y la pantalla lo dice. Las personas
 * sugeridas vienen de `GET /api/users/suggestions`.
 */
export default function Search() {
  const { user } = useAuth();
  const router = useRouter();
  const posts = usePosts();
  const menu = usePostMenu();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SearchSort>('recent');

  const results = useMemo(() => searchPosts(posts.posts, query, sort), [posts.posts, query, sort]);
  const searching = query.trim().length > 0;

  if (!user) return null;

  return (
    <Screen title="Explorar" back scroll={false} withBottomInset={false}>
      <FlatList
        data={searching ? results : []}
        keyExtractor={(post) => post.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={styles.inputBox}>
              <Icon name="search" size={18} color={colors.fgMuted} />
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar personas, etiquetas o contenido…"
                placeholderTextColor={colors.fgDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Buscar"
                clearButtonMode="while-editing"
              />
            </View>
            <Text style={styles.scope}>
              Las personas se buscan por nombre o usuario. Las publicaciones, entre las{' '}
              {posts.posts.length} cargadas.
            </Text>

            {searching ? (
              <>
                <PeopleResults query={query} />
                <View style={styles.sortRow}>
                  <SortChip label="Recientes" active={sort === 'recent'} onPress={() => setSort('recent')} />
                  <SortChip label="Más me gusta" active={sort === 'likes'} onPress={() => setSort('likes')} />
                </View>
              </>
            ) : (
              <>
                <Pressable
                  style={styles.discover}
                  onPress={() => router.push('/places')}
                  accessibilityRole="button"
                  accessibilityLabel="Lugares cerca de ti"
                >
                  <Icon name="pin" size={22} color={colors.brandText} />
                  <View style={styles.discoverText}>
                    <Text style={styles.discoverTitle}>Lugares cerca de ti</Text>
                    <Text style={styles.discoverHint}>
                      Descubrí cafés, farmacias y más en el mapa. Guardá tus favoritos.
                    </Text>
                  </View>
                  <Icon name="chevron" size={18} color={colors.fgMuted} />
                </Pressable>
                <Pressable
                  style={styles.discover}
                  onPress={() => router.push('/explore')}
                  accessibilityRole="button"
                  accessibilityLabel="Explorar contenido"
                >
                  <Icon name="grid" size={22} color={colors.brandText} />
                  <View style={styles.discoverText}>
                    <Text style={styles.discoverTitle}>Explorar contenido</Text>
                    <Text style={styles.discoverHint}>
                      Fotos y videos populares de personas que aún no sigues.
                    </Text>
                  </View>
                  <Icon name="chevron" size={18} color={colors.fgMuted} />
                </Pressable>
                <Suggestions />
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          !searching ? null : posts.status !== 'ready' ? (
            <StateMessage kind="loading" message="Cargando publicaciones…" />
          ) : (
            <StateMessage
              kind="empty"
              title="Sin resultados"
              message={`No hay publicaciones cargadas que coincidan con «${query.trim()}».`}
            />
          )
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            myId={user.id}
            onLike={menu.like}
            onMenu={menu.openMenu}
            onFollow={menu.follow}
          />
        )}
      />
      {menu.element}
    </Screen>
  );
}

function SortChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

type FollowState = Record<string, 'accepted' | 'pending'>;

/** Estado de seguir/dejar de seguir por persona (`POST`/`DELETE /api/users/<id>/follow`). */
function useFollowToggle() {
  // `accepted`/`pending` por id; ausente = no sigue (la lista no trae la relación).
  const [following, setFollowing] = useState<FollowState>({});

  async function toggle(person: SuggestedUser) {
    const current = following[person.id];
    try {
      if (current) {
        await unfollowUser(person.id);
        setFollowing(({ [person.id]: _removed, ...rest }) => rest);
      } else {
        const result = await followUser(person.id);
        if (result.follow_status) {
          const status = result.follow_status;
          setFollowing((state) => ({ ...state, [person.id]: status }));
        }
      }
    } catch (e) {
      Alert.alert('No se pudo actualizar el seguimiento', messageOf(e));
    }
  }

  return { following, toggle };
}

/** Una persona: foto y nombre llevan al perfil; «Seguir» es su propio botón. */
function PersonRow({
  person,
  state,
  onToggle,
}: {
  person: SuggestedUser;
  state: FollowState[string] | undefined;
  onToggle: (person: SuggestedUser) => void;
}) {
  const openProfile = useOpenProfile();
  return (
    <View style={styles.person}>
      <Pressable
        onPress={() => openProfile(person.id)}
        style={styles.personTap}
        accessibilityRole="button"
        accessibilityLabel={`Ver el perfil de ${person.name}`}
      >
        <Avatar name={person.name} uri={person.avatar_url} size={40} />
        <View style={styles.personText}>
          <Text style={styles.personName} numberOfLines={1}>
            {person.name}
          </Text>
          <Text style={styles.personUser} numberOfLines={1}>
            @{person.username}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => onToggle(person)}
        style={[styles.followBtn, state ? styles.followBtnOn : null]}
        accessibilityRole="button"
      >
        <Text style={[styles.followText, state ? styles.followTextOn : null]}>
          {state === 'accepted' ? 'Siguiendo' : state === 'pending' ? 'Solicitado' : person.is_private ? 'Solicitar' : 'Seguir'}
        </Text>
      </Pressable>
    </View>
  );
}

/** Personas sugeridas, con seguir/dejar de seguir. */
function Suggestions() {
  const [people, setPeople] = useState<SuggestedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { following, toggle } = useFollowToggle();

  useEffect(() => {
    const controller = new AbortController();
    fetchSuggestions(controller.signal)
      .then(setPeople)
      .catch((e) => {
        if (!controller.signal.aborted) setError(messageOf(e));
      });
    return () => controller.abort();
  }, []);

  if (error) return <Text style={styles.suggestError}>No pudimos cargar las sugerencias.</Text>;
  if (people === null) return <StateMessage kind="loading" />;
  if (people.length === 0) return null;

  return (
    <View style={styles.suggest}>
      <Text style={styles.suggestTitle}>Personas que quizá conozcas</Text>
      {people.map((person) => (
        <PersonRow key={person.id} person={person} state={following[person.id]} onToggle={toggle} />
      ))}
    </View>
  );
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Personas que coinciden con lo escrito, por nombre o @usuario, hayan publicado o no. Pide al
 * servidor con una pequeña espera y descarta la respuesta de una consulta ya superada.
 */
function PeopleResults({ query }: { query: string }) {
  const needle = query.trim();
  const [people, setPeople] = useState<SuggestedUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { following, toggle } = useFollowToggle();

  useEffect(() => {
    if (!needle) return undefined;
    const controller = new AbortController();
    setPeople(null);
    setFailed(false);
    const timer = setTimeout(() => {
      searchUsers(needle, controller.signal)
        .then(setPeople)
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle]);

  if (failed) return <Text style={styles.suggestError}>No pudimos buscar personas ahora.</Text>;
  if (people === null) return <StateMessage kind="loading" message="Buscando personas…" />;
  if (people.length === 0) return <Text style={styles.suggestError}>No hay personas con «{needle}».</Text>;

  return (
    <View style={styles.suggest}>
      <Text style={styles.suggestTitle}>Personas</Text>
      {people.map((person) => (
        <PersonRow key={person.id} person={person} state={following[person.id]} onToggle={toggle} />
      ))}
    </View>
  );
}

const styles = themedStyles(() => ({
  list: { padding: space[4], paddingBottom: space[8] },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
  },
  input: { flex: 1, minHeight: 48, fontSize: fontSize.bodyMd, color: colors.fg, padding: 0 },
  discover: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[4],
    marginBottom: space[4],
  },
  discoverText: { flex: 1 },
  discoverTitle: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  discoverHint: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2 },
  scope: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: space[2], marginBottom: space[3] },
  sortRow: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: fontSize.labelLg, color: colors.fgSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.onBrand },
  suggest: { marginTop: space[2] },
  suggestTitle: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginBottom: space[3] },
  suggestError: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: space[3] },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[3],
    marginBottom: space[2],
  },
  personTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  personText: { flex: 1, marginHorizontal: space[3] },
  personName: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  personUser: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  followBtn: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  followBtnOn: { borderColor: colors.borderStrong, backgroundColor: colors.bgSubtle },
  followText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  followTextOn: { color: colors.fgSecondary },
}));
