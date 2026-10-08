import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { PostCard } from '@features/posts/PostCard';
import { usePosts } from '@features/posts/PostsContext';
import { usePostMenu } from '@features/posts/usePostMenu';
import { patchProfile } from '@features/settings/api';
import { colors, fontSize, fonts, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { messageOf } from '@features/posts/PostsContext';
import { comingSoon } from '@shared/lib/comingSoon';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { EditProfileModal } from '@shared/ui/EditProfileModal';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';

type Tab = 'posts' | 'mentions';

/**
 * Perfil propio: datos reales de `GET /api/users/me` y las publicaciones propias,
 * que salen de la misma lista del feed (el servidor no tiene «publicaciones de un
 * usuario»; igual que en la web se filtra por autor). «Menciones» filtra, de las
 * publicaciones cargadas, las que te mencionan. Ver perfiles AJENOS no existe
 * todavía en el servidor (no hay `GET /api/users/<id>`), así que no se inventa.
 */
export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();
  const posts = usePosts();
  const menu = usePostMenu();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>('posts');

  const mine = useMemo(
    () => posts.posts.filter((post) => post.author.id === user?.id),
    [posts.posts, user?.id],
  );
  const mentioned = useMemo(
    () => posts.posts.filter((post) => post.mentions.some((m) => m.id === user?.id)),
    [posts.posts, user?.id],
  );

  if (!user) return null;

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  const data = tab === 'posts' ? mine : mentioned;

  return (
    <Screen
      title={`@${user.username}`}
      scroll={false}
      withBottomInset={false}
      headerRight={
        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={10}
          style={styles.gear}
          accessibilityRole="button"
          accessibilityLabel="Ajustes"
        >
          <Icon name="settings" size={22} color={colors.fg} />
        </Pressable>
      }
    >
      <FlatList
        data={data}
        keyExtractor={(post) => post.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {user.cover_url ? (
              <Image
                source={{ uri: user.cover_url }}
                style={styles.cover}
                accessibilityIgnoresInvertColors
                accessibilityLabel="Portada de tu perfil"
              />
            ) : null}

            <View style={styles.identity}>
              <Avatar name={user.name} uri={user.avatar_url} size={88} />
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{mine.length}</Text>
                  <Text style={styles.statLabel}>Publicaciones</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{user.followers_count}</Text>
                  <Text style={styles.statLabel}>Seguidores</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{user.following_count}</Text>
                  <Text style={styles.statLabel}>Siguiendo</Text>
                </View>
              </View>
            </View>

            <View style={styles.header}>
              <Text style={styles.name}>{user.name}</Text>
              <Text style={styles.username}>
                @{user.username}
                {user.is_private ? ' · Cuenta privada' : ''}
              </Text>
              {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
              {user.location ? <Text style={styles.meta}>{user.location}</Text> : null}
              {user.website ? (
                <Pressable
                  onPress={() =>
                    Linking.openURL(/^https?:\/\//i.test(user.website!) ? user.website! : `https://${user.website}`).catch(
                      () => Alert.alert('No se pudo abrir el enlace'),
                    )
                  }
                  accessibilityRole="link"
                  style={styles.linkRow}
                >
                  <Icon name="link" size={14} color={colors.brandText} />
                  <Text style={styles.link}>{user.website}</Text>
                </Pressable>
              ) : null}
            </View>

            {!user.profile_completed ? (
              <Banner tone="info">
                Faltan datos de tu perfil (teléfono y fecha de nacimiento). Complétalos desde la web
                de THERS para poder publicar.
              </Banner>
            ) : null}

            <View style={styles.buttons}>
              <Button label="Editar perfil" variant="secondary" onPress={() => setEditing(true)} style={styles.flex} />
              <Button
                label="Compartir"
                variant="secondary"
                onPress={() => comingSoon('Compartir perfil')}
                style={styles.flex}
              />
              <Pressable
                onPress={() => comingSoon('Las sugerencias de amigos')}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Sugerencias de amigos (próximamente)"
              >
                <Icon name="userAdd" size={20} color={colors.fg} />
              </Pressable>
            </View>

            <Pressable
              onPress={() => comingSoon('Las historias destacadas')}
              style={styles.highlights}
              accessibilityRole="button"
              accessibilityLabel="Historias destacadas (próximamente)"
            >
              <View style={styles.highlightNew}>
                <Icon name="plus" size={22} color={colors.fgSecondary} />
              </View>
              <View style={styles.flexText}>
                <Text style={styles.highlightTitle}>Historias destacadas</Text>
                <Text style={styles.highlightHint}>Próximamente</Text>
              </View>
              <Icon name="chevron" size={18} color={colors.fgDisabled} />
            </Pressable>

            <View style={styles.tabs}>
              {(
                [
                  ['posts', 'Posts', 'grid'],
                  ['mentions', 'Menciones', 'at'],
                ] as const
              ).map(([id, label, icon]) => (
                <Pressable
                  key={id}
                  onPress={() => setTab(id)}
                  style={[styles.tab, tab === id && styles.tabOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tab === id }}
                >
                  <Icon name={icon} size={18} color={tab === id ? colors.brandText : colors.fgMuted} />
                  <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {data.length === 0 ? (
              <Text style={styles.empty}>
                {posts.status !== 'ready'
                  ? 'Cargando publicaciones…'
                  : tab === 'posts'
                    ? 'Todavía no has publicado nada reciente.'
                    : 'Ninguna publicación reciente te menciona.'}
              </Text>
            ) : null}
          </View>
        }
        ListFooterComponent={
          <Button label="Cerrar sesión" variant="secondary" onPress={handleLogout} style={styles.logout} />
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
      <EditProfileModal
        visible={editing}
        user={user}
        onClose={() => setEditing(false)}
        onSave={async (patch) => {
          try {
            await patchProfile(patch);
            await refreshUser();
          } catch (e) {
            throw new Error(messageOf(e));
          }
        }}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  list: { padding: space[4], paddingBottom: space[8] },
  gear: { padding: space[1] },
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
  highlights: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[3],
    marginBottom: space[4],
  },
  highlightNew: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexText: { flex: 1 },
  highlightTitle: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  highlightHint: { fontSize: fontSize.labelMd, color: colors.brandText, marginTop: 2 },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    marginBottom: space[3],
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingVertical: space[3],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabOn: { borderBottomColor: colors.brandText },
  tabText: { fontSize: fontSize.bodyMd, fontWeight: '600', color: colors.fgMuted },
  tabTextOn: { color: colors.brandText },
  empty: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginBottom: space[4] },
  logout: { marginTop: space[4] },
}));
