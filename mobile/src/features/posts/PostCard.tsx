import { useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { SharedPlaceCard } from '@features/places/SharedPlaceCard';
import { useOpenProfile } from '@features/profile/useOpenProfile';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { formatRelativeTime } from '@shared/lib/time';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import { ImageGridView } from '@shared/media/ImageGridView';
import { VideoPlayerView } from '@shared/media/VideoPlayerView';
import { MentionText } from '@shared/ui/MentionText';

import { messageOf, usePosts } from './PostsContext';
import { SharePostSheet } from './SharePostSheet';
import type { Post } from './types';

type Props = {
  post: Post;
  /** Id de la persona con sesión, para saber si la publicación es suya. */
  myId: string;
  onLike: (post: Post) => void;
  onMenu: (post: Post) => void;
  onFollow: (post: Post) => void;
  /** En el detalle no se vuelve a abrir el detalle al tocar el texto. */
  detail?: boolean;
};

/**
 * Tarjeta de una publicación (texto, fotos o video corto). Las publicaciones marcadas como
 * sensibles por su autor se muestran ocultas a las demás personas hasta que
 * toquen «Mostrar» (ADR-030).
 */
function PostCardBase({ post, myId, onLike, onMenu, onFollow, detail = false }: Props) {
  const router = useRouter();
  const openProfile = useOpenProfile();
  const { t } = useLanguage();
  const [revealed, setRevealed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const { toggleSave } = usePosts();
  const isMine = post.author.id === myId;
  const hidden = post.is_sensitive && !isMine && !revealed;
  // Todas las publicaciones comparten el formato de Instagram: encabezado, contenido, acciones debajo y
  // pie con «Me gusta», comentarios y hora. Con foto o video, el texto va como pie de foto con el nombre
  // al lado; sin ellos, el texto va justo bajo el encabezado.
  const hasMedia = ((post.images?.length ?? 0) > 0 || Boolean(post.video)) && !hidden;

  const followLabel =
    post.author.follow_status === 'accepted'
      ? t('follow.following')
      : post.author.follow_status === 'pending'
        ? t('follow.requested')
        : post.author.is_private
          ? t('follow.request')
          : t('follow.follow');

  function openDetail() {
    if (!detail) router.push({ pathname: '/post/[id]', params: { id: post.id } });
  }

  function openAuthor() {
    if (isMine) router.push('/profile');
    else router.push({ pathname: '/user/[userId]', params: { userId: post.author.id } });
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {/* Foto y nombre llevan al perfil de su autor (ADR-049); el propio, a la pestaña Perfil. */}
        <Pressable
          onPress={openAuthor}
          style={styles.author}
          accessibilityRole="button"
          accessibilityLabel={t('profile.viewOf', { name: post.author.name })}
        >
          <Avatar name={post.author.name} uri={post.author.avatar_url} size={36} />
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={1}>
              {post.author.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              @{post.author.username}
              {post.edited ? ` · ${t('post.edited')}` : ''}
              {post.audience === 'close_friends' ? (
                <Text style={{ color: colors.brandText, fontWeight: '700' }}>{` · ★ ${t('story.audience.closeFriends')}`}</Text>
              ) : null}
            </Text>
          </View>
        </Pressable>
        {!isMine ? (
          <Pressable
            onPress={() => onFollow(post)}
            style={[styles.follow, post.author.follow_status ? styles.followOn : null]}
            accessibilityRole="button"
            accessibilityLabel={`${followLabel}: ${post.author.name}`}
          >
            <Text
              style={[styles.followText, post.author.follow_status ? styles.followTextOn : null]}
            >
              {followLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onMenu(post)}
          hitSlop={10}
          style={styles.menu}
          accessibilityRole="button"
          accessibilityLabel={t('post.moreOptions')}
        >
          <Icon name="more" size={20} color={colors.fgMuted} />
        </Pressable>
      </View>

      {hidden ? (
        <View style={styles.sensitive}>
          <Text style={styles.sensitiveText}>{t('post.sensitive.byAuthorLong')}</Text>
          <Pressable onPress={() => setRevealed(true)} accessibilityRole="button">
            <Text style={styles.sensitiveAction}>{t('post.sensitive.show')}</Text>
          </Pressable>
        </View>
      ) : hasMedia ? null : (
        <Pressable onPress={openDetail} disabled={detail} accessibilityRole={detail ? 'text' : 'button'}>
          <MentionText
            text={post.content}
            usernames={post.mentions.map((m) => m.username)}
            onMentionPress={(username) => {
              const mentioned = post.mentions.find((m) => m.username.toLowerCase() === username.toLowerCase());
              if (mentioned) openProfile(mentioned.id);
            }}
            style={styles.content}
          />
        </Pressable>
      )}
      {/* Fotos y video corto (ADR-039, ADR-046). Ocultos igual que el texto si es contenido sensible. */}
      {!hidden ? (
        <>
          <ImageGridView images={post.images} label={t('post.imageOf', { name: post.author.name })} bleed />
          {post.video ? (
            <VideoPlayerView video={post.video} bleed accessibilityLabel={t('post.videoOf', { name: post.author.name })} />
          ) : null}
        </>
      ) : null}
      {/* Lugar asociado (ADR-040 fase 4d). */}
      {post.place && !hidden ? (
        <SharedPlaceCard place={post.place} mine={false} />
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => onLike(post)}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={post.liked_by_me ? t('post.unlike') : t('post.like')}
          accessibilityState={{ selected: post.liked_by_me }}
        >
          <Icon
            name="heart"
            size={26}
            filled={post.liked_by_me}
            color={post.liked_by_me ? colors.brandText : colors.fgSecondary}
          />
        </Pressable>
        <Pressable
          onPress={openDetail}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={t('post.comments', { count: post.comments_count })}
        >
          <Icon name="comment" size={26} color={colors.fgSecondary} />
        </Pressable>
        <Pressable
          onPress={() => setSharing(true)}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={t('post.share')}
        >
          <Icon name="share" size={26} color={colors.fgSecondary} />
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          onPress={() => toggleSave(post.id).catch((e) => Alert.alert(t('post.error.save'), messageOf(e)))}
          style={styles.action}
          accessibilityRole="button"
          accessibilityState={{ selected: Boolean(post.saved_by_me) }}
          accessibilityLabel={post.saved_by_me ? t('saved.remove') : t('post.save')}
        >
          <Icon
            name="bookmark"
            size={26}
            filled={Boolean(post.saved_by_me)}
            color={post.saved_by_me ? colors.brandText : colors.fgSecondary}
          />
        </Pressable>
      </View>
      <View style={styles.footer}>
        {post.likes_count > 0 ? (
          <Text style={styles.likes}>{t('post.likesCount', { count: post.likes_count })}</Text>
        ) : null}
        {hasMedia && post.content ? (
          <Pressable onPress={openDetail} disabled={detail} accessibilityRole={detail ? 'text' : 'button'}>
            <Text style={styles.caption}>
              <Text style={styles.captionName}>{post.author.name} </Text>
              <MentionText
                text={post.content}
                usernames={post.mentions.map((m) => m.username)}
                onMentionPress={(username) => {
                  const mentioned = post.mentions.find((m) => m.username.toLowerCase() === username.toLowerCase());
                  if (mentioned) openProfile(mentioned.id);
                }}
                style={styles.captionText}
              />
            </Text>
          </Pressable>
        ) : null}
        {post.comments_count > 0 && !detail ? (
          <Pressable onPress={openDetail} accessibilityRole="button">
            <Text style={styles.viewComments}>{t('post.viewComments', { count: post.comments_count })}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.time}>
          {formatRelativeTime(post.created_at)}
          {post.audience === 'close_friends' ? ` · ★ ${t('story.audience.closeFriends')}` : ''}
        </Text>
      </View>
      <SharePostSheet
        post={sharing ? post : null}
        onClose={() => setSharing(false)}
        onShared={(name) => {
          setSharing(false);
          Alert.alert(t('post.sent.title'), t('post.sent.body', { name }));
        }}
      />
    </View>
  );
}

export const PostCard = memo(PostCardBase);

const styles = themedStyles(() => ({
  // Formato Instagram dentro del mismo margen lateral (16 px) que tiene el cuadro de publicar.
  card: {
    backgroundColor: colors.bg,
    marginBottom: space[4],
    paddingBottom: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space[2] },
  footer: { gap: 4 },
  likes: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  caption: { lineHeight: 20 },
  captionName: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  captionText: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 20 },
  viewComments: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  time: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: 2 },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerText: { flex: 1, marginHorizontal: space[3] },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  meta: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: 2 },
  follow: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1] + 2,
    marginRight: space[1],
  },
  followOn: { borderColor: colors.borderStrong, backgroundColor: colors.bgSubtle },
  followText: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.brandText },
  followTextOn: { color: colors.fgSecondary },
  menu: { paddingHorizontal: space[2] },
  menuText: { fontSize: 22, color: colors.fgMuted, lineHeight: 24 },
  content: { fontSize: fontSize.bodyLg, color: colors.fg, lineHeight: 24 },
  sensitive: {
    backgroundColor: colors.bgSubtle,
    borderRadius: radius.sm,
    padding: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  sensitiveText: { flex: 1, fontSize: fontSize.bodySm, color: colors.fgSecondary },
  sensitiveAction: { color: colors.brandText, fontWeight: '700', fontSize: fontSize.bodySm },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: space[2], marginBottom: space[1], gap: space[3] },
  action: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  spacer: { flex: 1 },
  actionText: { fontSize: fontSize.bodyMd, color: colors.fgSecondary },
  liked: { color: colors.brandText, fontWeight: '700' },
}));
