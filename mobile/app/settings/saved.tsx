import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { fetchSavedPosts, setPostSaved } from '@features/posts/api';
import { messageOf } from '@features/posts/PostsContext';
import type { Post } from '@features/posts/types';
import { ProfileLink } from '@features/profile/ProfileLink';
import { useLanguage } from '@shared/i18n';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { formatRelativeTime } from '@shared/lib/time';
import { ImageGridView } from '@shared/media/ImageGridView';
import { VideoPlayerView } from '@shared/media/VideoPlayerView';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Publicaciones guardadas (`ADR-047`). Lista privada: la última guardada primero. Solo aparecen las que
 * sigues pudiendo ver (el servidor aplica las mismas reglas que el feed); una que deja de ser visible
 * desaparece sin borrarse.
 */
export default function Saved() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPosts(await fetchSavedPosts());
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(post: Post) {
    const previous = posts;
    setPosts((current) => current?.filter((p) => p.id !== post.id) ?? current);
    try {
      await setPostSaved(post.id, false);
    } catch (e) {
      setPosts(previous);
      Alert.alert(t('saved.error.remove'), messageOf(e));
    }
  }

  return (
    <Screen title={t('saved.title')} back>
      <Text style={styles.hint}>{t('saved.hint')}</Text>
      {posts === null ? (
        error ? (
          <StateMessage kind="error" message={error} actionLabel={t('common.retry')} onAction={load} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : posts.length === 0 ? (
        <StateMessage kind="empty" message={t('saved.empty')} />
      ) : (
        posts.map((post) => (
          <View key={post.id} style={styles.card}>
            <View style={styles.header}>
              <ProfileLink userId={post.author.id} name={post.author.name}>
                <Avatar name={post.author.name} uri={post.author.avatar_url} size={40} />
                <View style={styles.headerText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {post.author.name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    @{post.author.username} · {formatRelativeTime(post.created_at)}
                  </Text>
                </View>
              </ProfileLink>
              <Pressable
                onPress={() => remove(post)}
                style={styles.remove}
                accessibilityRole="button"
                accessibilityLabel={t('saved.remove')}
              >
                <Icon name="bookmark" size={22} filled color={colors.brandText} />
              </Pressable>
            </View>
            {post.is_sensitive && post.author.id !== user?.id ? (
              <Text style={styles.meta}>{t('post.sensitive.byAuthor')}</Text>
            ) : (
              <>
                {post.content ? <Text style={styles.content}>{post.content}</Text> : null}
                <ImageGridView images={post.images} label={t('post.imageOf', { name: post.author.name })} />
                {post.video ? <VideoPlayerView video={post.video} accessibilityLabel={t('post.videoOf', { name: post.author.name })} /> : null}
              </>
            )}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  hint: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginBottom: space[3] },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[3],
    marginBottom: space[3],
    gap: space[2],
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  headerText: { flex: 1 },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  meta: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  content: { fontSize: fontSize.bodyMd, color: colors.fg },
  remove: { padding: space[2] },
}));
