import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { PostCard } from '@features/posts/PostCard';
import { followUser, likePost, unfollowUser, unlikePost } from '@features/posts/api';
import { messageOf } from '@features/posts/PostsContext';
import type { Post } from '@features/posts/types';
import { fetchPostsByAuthor, fetchPublicProfile } from '@features/profile/api';
import type { PublicProfile } from '@features/profile/api';
import { shareProfile } from '@features/profile/shareProfile';
import { ApiError } from '@shared/lib/api';
import { colors, fontSize, fonts, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Button } from '@shared/ui/Button';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Perfil de otra persona (`ADR-049`): se llega tocando su foto en una publicación. Seguir, enviar
 * mensaje y compartir el perfil, como en Instagram. En una cuenta privada que no sigues se ve el
 * perfil pero no sus publicaciones (las reglas las aplica el servidor).
 */
export default function UserProfile() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user: me } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await fetchPublicProfile(userId);
      setProfile(loaded);
      setError(null);
      setPosts(loaded.can_view_posts ? await fetchPostsByAuthor(userId) : []);
    } catch (e) {
      setError({ message: messageOf(e), notFound: e instanceof ApiError && e.status === 404 });
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (me && userId === me.id) return <Redirect href="/profile" />;

  async function toggleFollow() {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const result =
        profile.follow_status === null ? await followUser(profile.id) : await unfollowUser(profile.id);
      // Recarga todo: seguir una cuenta privada solo la solicita, y una pública deja ver más.
      setProfile({ ...profile, follow_status: result.follow_status });
      await load();
    } catch (e) {
      Alert.alert('No se pudo actualizar el seguimiento', messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(post: Post) {
    const apply = (liked: boolean, count: number) =>
      setPosts((current) =>
        current?.map((p) => (p.id === post.id ? { ...p, liked_by_me: liked, likes_count: count } : p)) ?? current,
      );
    apply(!post.liked_by_me, post.likes_count + (post.liked_by_me ? -1 : 1));
    try {
      const result = post.liked_by_me ? await unlikePost(post.id) : await likePost(post.id);
      apply(result.liked_by_me, result.likes_count);
    } catch (e) {
      apply(post.liked_by_me, post.likes_count);
      Alert.alert('No se pudo actualizar el me gusta', messageOf(e));
    }
  }

  function openConnections(kind: 'followers' | 'following') {
    if (!profile) return;
    router.push({
      pathname: '/connections/[userId]',
      params: { userId: profile.id, tab: kind, username: profile.username },
    });
  }

  function openMessage() {
    if (!profile) return;
    router.push({
      pathname: '/chat/[userId]',
      params: {
        userId: profile.id,
        name: profile.name,
        username: profile.username,
        avatar: profile.avatar_url ?? '',
      },
    });
  }

  const followLabel =
    profile?.follow_status === 'accepted'
      ? 'Siguiendo'
      : profile?.follow_status === 'pending'
        ? 'Solicitado'
        : profile?.is_private
          ? 'Solicitar'
          : 'Seguir';

  if (!profile) {
    return (
      <Screen title="Perfil" back>
        {error ? (
          <StateMessage
            kind="error"
            message={error.notFound ? 'Este perfil no está disponible.' : error.message}
            actionLabel={error.notFound ? undefined : 'Reintentar'}
            onAction={error.notFound ? undefined : load}
          />
        ) : (
          <StateMessage kind="loading" />
        )}
      </Screen>
    );
  }

  return (
    <Screen
      title={`@${profile.username}`}
      back
      scroll={false}
      headerRight={
        <Pressable
          onPress={() => shareProfile(profile).catch(() => {})}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Compartir perfil"
        >
          <Icon name="share" size={20} color={colors.fg} />
        </Pressable>
      }
    >
      <FlatList
        data={posts ?? []}
        keyExtractor={(post) => post.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {profile.cover_url ? (
              <Image
                source={{ uri: profile.cover_url }}
                style={styles.cover}
                accessibilityIgnoresInvertColors
                accessibilityLabel={`Portada de ${profile.name}`}
              />
            ) : null}

            <View style={styles.identity}>
              <Avatar name={profile.name} uri={profile.avatar_url} size={88} />
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{profile.can_view_posts ? (posts?.length ?? 0) : '–'}</Text>
                  <Text style={styles.statLabel}>Publicaciones</Text>
                </View>
                <Pressable
                  style={styles.stat}
                  onPress={() => openConnections('followers')}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver los seguidores de ${profile.name}, ${profile.followers_count}`}
                >
                  <Text style={styles.statValue}>{profile.followers_count}</Text>
                  <Text style={styles.statLabel}>Seguidores</Text>
                </Pressable>
                <Pressable
                  style={styles.stat}
                  onPress={() => openConnections('following')}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver a quién sigue ${profile.name}, ${profile.following_count}`}
                >
                  <Text style={styles.statValue}>{profile.following_count}</Text>
                  <Text style={styles.statLabel}>Siguiendo</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.header}>
              <Text style={styles.name}>{profile.name}</Text>
              <Text style={styles.username}>
                @{profile.username}
                {profile.is_private ? ' · Cuenta privada' : ''}
              </Text>
              {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
              {profile.location ? <Text style={styles.meta}>{profile.location}</Text> : null}
              {profile.website ? (
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      /^https?:\/\//i.test(profile.website!) ? profile.website! : `https://${profile.website}`,
                    ).catch(() => Alert.alert('No se pudo abrir el enlace'))
                  }
                  accessibilityRole="link"
                  style={styles.linkRow}
                >
                  <Icon name="link" size={14} color={colors.brandText} />
                  <Text style={styles.link}>{profile.website}</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.buttons}>
              <Button
                label={followLabel}
                variant={profile.follow_status === null ? 'primary' : 'secondary'}
                onPress={toggleFollow}
                loading={busy}
                style={styles.flex}
              />
              <Button label="Mensaje" variant="secondary" onPress={openMessage} style={styles.flex} />
              <Pressable
                onPress={() => shareProfile(profile).catch(() => {})}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Compartir perfil"
              >
                <Icon name="share" size={20} color={colors.fg} />
              </Pressable>
            </View>

            {!profile.can_view_posts ? (
              <View style={styles.locked}>
                <Icon name="lock" size={22} color={colors.fgMuted} />
                <Text style={styles.lockedTitle}>Esta cuenta es privada</Text>
                <Text style={styles.lockedHint}>Sigue a esta cuenta para ver sus publicaciones.</Text>
              </View>
            ) : posts === null ? (
              <Text style={styles.empty}>Cargando publicaciones…</Text>
            ) : posts.length === 0 ? (
              <Text style={styles.empty}>Todavía no ha publicado nada reciente.</Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            myId={me?.id ?? ''}
            onLike={toggleLike}
            onMenu={(post) => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
            onFollow={() => void toggleFollow()}
          />
        )}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  list: { padding: space[4], paddingBottom: space[8] },
  headerBtn: { padding: space[1] },
  cover: { width: '100%', height: 140, borderRadius: radius.card, marginBottom: space[4], backgroundColor: colors.surface },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space[4], marginBottom: space[3] },
  header: { marginBottom: space[4] },
  name: { fontSize: fontSize.headlineSm, fontFamily: fonts.display, color: colors.fg },
  username: { fontSize: fontSize.bodyMd, color: colors.fgMuted, marginTop: space[1] },
  bio: { fontSize: fontSize.bodyMd, color: colors.fg, marginTop: space[3], lineHeight: 21 },
  meta: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: space[2] },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginTop: space[2] },
  link: { fontSize: fontSize.bodySm, color: colors.brandText, fontWeight: '600' },
  statsRow: { flex: 1, flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSize.headlineSm, fontFamily: fonts.display, color: colors.fg },
  statLabel: { fontSize: fontSize.labelSm, color: colors.fgMuted, marginTop: space[1] },
  buttons: { flexDirection: 'row', gap: space[2], marginBottom: space[4], alignItems: 'center' },
  flex: { flex: 1, paddingHorizontal: space[2] },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: { alignItems: 'center', gap: space[2], paddingVertical: space[8] },
  lockedTitle: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  lockedHint: { fontSize: fontSize.bodySm, color: colors.fgMuted, textAlign: 'center' },
  empty: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginBottom: space[4] },
}));
