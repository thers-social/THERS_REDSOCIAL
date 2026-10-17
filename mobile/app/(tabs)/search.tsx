import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { searchPlaces } from '@features/places/api';
import type { PlaceSummary } from '@features/places/types';
import { fetchSuggestions, followUser, unfollowUser } from '@features/posts/api';
import type { SuggestedUser } from '@features/posts/api';
import { PostCard } from '@features/posts/PostCard';
import { messageOf, usePosts } from '@features/posts/PostsContext';
import { searchPosts } from '@features/posts/searchPosts';
import { SEARCH_DATES } from '@features/posts/searchPosts';
import type { SearchDate, SearchSort } from '@features/posts/searchPosts';
import { usePostMenu } from '@features/posts/usePostMenu';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Buscar. IMPORTANTE (igual que en la web): el servidor NO tiene un buscador, así
 * que se filtran las publicaciones que ya están cargadas (las 50 más recientes) y
 * la pantalla lo dice. Las personas sugeridas sí vienen del servidor
 * (`GET /api/users/suggestions`).
 */
export default function Search() {
  const { user } = useAuth();
  const router = useRouter();
  const posts = usePosts();
  const menu = usePostMenu();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SearchSort>('recent');
  const [date, setDate] = useState<SearchDate>('any');

  const results = useMemo(() => searchPosts(posts.posts, query, sort, date), [posts.posts, query, sort, date]);
  const searching = query.trim().length > 0;
  const places = usePlaceMatches(query);

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
                placeholder="Buscar creadores, etiquetas o contenido…"
                placeholderTextColor={colors.fgDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Buscar"
                clearButtonMode="while-editing"
              />
            </View>
            <Text style={styles.scope}>
              Busca entre las {posts.posts.length} publicaciones cargadas. THERS todavía no tiene un
              buscador de servidor.
            </Text>

            {searching ? (
              <View style={styles.sortRow}>
                <SortChip label="Recientes" active={sort === 'recent'} onPress={() => setSort('recent')} />
                <SortChip label="Más me gusta" active={sort === 'likes'} onPress={() => setSort('likes')} />
              </View>
            ) : null}
            {searching && places.length > 0 ? (
              <View style={styles.suggest}>
                <Text style={styles.suggestTitle}>Lugares</Text>
                {places.map((place) => (
                  <Pressable
                    key={place.id}
                    style={styles.person}
                    onPress={() => router.push({ pathname: '/places/[id]', params: { id: place.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Lugar ${place.name}`}
                  >
                    <Icon name="pin" size={22} color={colors.brandText} />
                    <View style={styles.personText}>
                      <Text style={styles.personName} numberOfLines={1}>
                        {place.name}
                      </Text>
                      <Text style={styles.personUser} numberOfLines={1}>
                        {place.category.name}
                        {place.address ? ` · ${place.address}` : ''}
                      </Text>
                    </View>
                    <Icon name="chevron" size={18} color={colors.fgMuted} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {searching ? (
              <View style={styles.sortRow}>
                {SEARCH_DATES.map((range) => (
                  <SortChip
                    key={range.id}
                    label={range.label}
                    active={date === range.id}
                    onPress={() => setDate(range.id)}
                  />
                ))}
              </View>
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
                <View style={styles.discover}>
                  <Icon name="grid" size={22} color={colors.brandText} />
                  <View style={styles.discoverText}>
                    <Text style={styles.discoverTitle}>Explorar contenido</Text>
                    <Text style={styles.discoverHint}>
                      Próximamente: la cuadrícula de fotos, videos y tendencias.
                    </Text>
                  </View>
                </View>
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

/**
 * Lugares cuyo nombre coincide con la consulta (`GET /api/places/search`, ADR-040). Se pide al
 * servidor con 350 ms de retardo y solo desde 2 letras; un error se ignora a propósito: los
 * lugares son un extra y no deben tapar los resultados de publicaciones.
 */
function usePlaceMatches(query: string): PlaceSummary[] {
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const text = query.trim();

  useEffect(() => {
    if (text.length < 2) {
      setPlaces([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces({ q: text, limit: 5 }, controller.signal)
        .then(setPlaces)
        .catch(() => {
          if (!controller.signal.aborted) setPlaces([]);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  return places;
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

/** Personas sugeridas, con seguir/dejar de seguir (`POST`/`DELETE /api/users/<id>/follow`). */
function Suggestions() {
  const [people, setPeople] = useState<SuggestedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `accepted`/`pending` por id; ausente = no sigue.
  const [following, setFollowing] = useState<Record<string, 'accepted' | 'pending'>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetchSuggestions(controller.signal)
      .then(setPeople)
      .catch((e) => {
        if (!controller.signal.aborted) setError(messageOf(e));
      });
    return () => controller.abort();
  }, []);

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

  if (error) return <Text style={styles.suggestError}>No pudimos cargar las sugerencias.</Text>;
  if (people === null) return <StateMessage kind="loading" />;
  if (people.length === 0) return null;

  return (
    <View style={styles.suggest}>
      <Text style={styles.suggestTitle}>Personas que quizá conozcas</Text>
      {people.map((person) => {
        const state = following[person.id];
        return (
          <View key={person.id} style={styles.person}>
            <Avatar name={person.name} size={40} />
            <View style={styles.personText}>
              <Text style={styles.personName} numberOfLines={1}>
                {person.name}
              </Text>
              <Text style={styles.personUser} numberOfLines={1}>
                @{person.username}
              </Text>
            </View>
            <Pressable
              onPress={() => toggle(person)}
              style={[styles.followBtn, state ? styles.followBtnOn : null]}
              accessibilityRole="button"
            >
              <Text style={[styles.followText, state ? styles.followTextOn : null]}>
                {state === 'accepted' ? 'Siguiendo' : state === 'pending' ? 'Solicitado' : person.is_private ? 'Solicitar' : 'Seguir'}
              </Text>
            </Pressable>
          </View>
        );
      })}
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
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
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
