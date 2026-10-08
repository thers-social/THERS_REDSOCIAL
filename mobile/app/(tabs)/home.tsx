import { Link } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { Composer } from '@features/posts/Composer';
import { PostCard } from '@features/posts/PostCard';
import { messageOf, usePosts } from '@features/posts/PostsContext';
import { usePostMenu } from '@features/posts/usePostMenu';
import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { comingSoon } from '@shared/lib/comingSoon';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Inicio: el feed global (`GET /api/posts`: las 50 publicaciones más recientes,
 * sin paginación todavía en el servidor, `API_CONTRACT.md` §4.3) y la caja para
 * publicar. Todo es real: nada se inventa para llenar la pantalla.
 */
export default function Home() {
  const { user } = useAuth();
  const posts = usePosts();
  const menu = usePostMenu();

  if (!user) return null;

  return (
    <Screen
      title="Inicio"
      scroll={false}
      withBottomInset={false}
      headerRight={
        <View style={styles.headerLinks}>
          <Link href="/search" accessibilityRole="link" accessibilityLabel="Buscar" style={styles.headerLink}>
            <Icon name="search" color={colors.fg} />
          </Link>
          <Link
            href="/notifications"
            accessibilityRole="link"
            accessibilityLabel="Avisos"
            style={styles.headerLink}
          >
            <Icon name="bell" color={colors.fg} />
          </Link>
        </View>
      }
    >
      <FlatList
        data={posts.status === 'ready' ? posts.posts : []}
        keyExtractor={(post) => post.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={posts.refreshing}
            onRefresh={() => posts.reload({ pullToRefresh: true })}
            tintColor={colors.brand}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.stories}>
              <Pressable
                onPress={() => comingSoon('Las historias')}
                style={styles.story}
                accessibilityRole="button"
                accessibilityLabel="Tu historia (próximamente)"
              >
                <View>
                  <Avatar name={user.name} uri={user.avatar_url} size={56} />
                  <View style={styles.storyPlus}>
                    <Icon name="plus" size={12} color={colors.onBrand} />
                  </View>
                </View>
                <Text style={styles.storyLabel}>Tu historia</Text>
              </Pressable>
            </View>
            {user.profile_completed ? (
              <Composer
                onPublish={async (content, sensitive) => {
                  try {
                    await posts.create(content, sensitive);
                  } catch (e) {
                    throw new Error(messageOf(e));
                  }
                }}
              />
            ) : (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Completa tu perfil, incluida tu fecha de nacimiento, para publicar. Puedes hacerlo
                  desde la web de THERS.
                </Text>
              </View>
            )}
            {posts.status === 'ready' && posts.error ? (
              <Text style={styles.stale}>No pudimos actualizar. Mostrando lo último que cargó.</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          posts.status === 'loading' || posts.status === 'idle' ? (
            <StateMessage kind="loading" message="Cargando publicaciones…" />
          ) : posts.status === 'error' ? (
            <StateMessage
              kind="error"
              title="No pudimos cargar el inicio"
              message={posts.error ?? undefined}
              actionLabel="Reintentar"
              onAction={() => posts.reload()}
            />
          ) : (
            <StateMessage
              kind="empty"
              title="Todavía no hay publicaciones"
              message="Sé la primera persona en compartir algo."
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

const styles = themedStyles(() => ({
  headerLinks: { flexDirection: 'row', gap: space[4] },
  headerLink: { padding: space[2] },
  list: { padding: space[4], paddingBottom: space[8] },
  stories: { flexDirection: 'row', marginBottom: space[4] },
  story: { alignItems: 'center', width: 72 },
  storyPlus: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyLabel: { fontSize: fontSize.labelSm, color: colors.fgMuted, marginTop: space[1] },
  notice: {
    backgroundColor: colors.brandSoft,
    borderRadius: 12,
    padding: space[3],
    marginBottom: space[4],
  },
  noticeText: { fontSize: fontSize.bodySm, color: colors.fgSecondary, lineHeight: 18 },
  stale: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginBottom: space[3] },
}));
