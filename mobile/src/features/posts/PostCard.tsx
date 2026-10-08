import { useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { comingSoon } from '@shared/lib/comingSoon';
import { formatRelativeTime } from '@shared/lib/time';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import { MentionText } from '@shared/ui/MentionText';

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
 * Tarjeta de una publicación (solo texto). Las publicaciones marcadas como
 * sensibles por su autor se muestran ocultas a las demás personas hasta que
 * toquen «Mostrar» (ADR-030).
 */
function PostCardBase({ post, myId, onLike, onMenu, onFollow, detail = false }: Props) {
  const router = useRouter();
  const [revealed, setRevealed] = useState(false);
  const isMine = post.author.id === myId;
  const hidden = post.is_sensitive && !isMine && !revealed;

  const followLabel =
    post.author.follow_status === 'accepted'
      ? 'Siguiendo'
      : post.author.follow_status === 'pending'
        ? 'Solicitado'
        : post.author.is_private
          ? 'Solicitar'
          : 'Seguir';

  function openDetail() {
    if (!detail) router.push({ pathname: '/post/[id]', params: { id: post.id } });
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar name={post.author.name} uri={post.author.avatar_url} size={44} />
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>
            {post.author.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            @{post.author.username} · {formatRelativeTime(post.created_at)}
            {post.edited ? ' · editado' : ''}
          </Text>
        </View>
        {!isMine ? (
          <Pressable
            onPress={() => onFollow(post)}
            style={[styles.follow, post.author.follow_status ? styles.followOn : null]}
            accessibilityRole="button"
            accessibilityLabel={`${followLabel} a ${post.author.name}`}
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
          accessibilityLabel="Más opciones"
        >
          <Icon name="more" size={20} color={colors.fgMuted} />
        </Pressable>
      </View>

      {hidden ? (
        <View style={styles.sensitive}>
          <Text style={styles.sensitiveText}>
            Su autor marcó esta publicación como contenido sensible.
          </Text>
          <Pressable onPress={() => setRevealed(true)} accessibilityRole="button">
            <Text style={styles.sensitiveAction}>Mostrar</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={openDetail} disabled={detail} accessibilityRole={detail ? 'text' : 'button'}>
          <MentionText
            text={post.content}
            usernames={post.mentions.map((m) => m.username)}
            style={styles.content}
          />
        </Pressable>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={() => onLike(post)}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={post.liked_by_me ? 'Quitar me gusta' : 'Me gusta'}
          accessibilityState={{ selected: post.liked_by_me }}
        >
          <Icon
            name="heart"
            size={22}
            filled={post.liked_by_me}
            color={post.liked_by_me ? colors.brandText : colors.fgSecondary}
          />
          <Text style={[styles.actionText, post.liked_by_me && styles.liked]}>{post.likes_count}</Text>
        </Pressable>
        <Pressable
          onPress={openDetail}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={`Comentarios: ${post.comments_count}`}
        >
          <Icon name="comment" size={22} color={colors.fgSecondary} />
          <Text style={styles.actionText}>{post.comments_count}</Text>
        </Pressable>
        <Pressable
          onPress={() => comingSoon('Compartir')}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Compartir (próximamente)"
        >
          <Icon name="share" size={22} color={colors.fgSecondary} />
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          onPress={() => comingSoon('Guardar publicaciones')}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Guardar (próximamente)"
        >
          <Icon name="bookmark" size={22} color={colors.fgSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export const PostCard = memo(PostCardBase);

const styles = themedStyles(() => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: space[4],
    marginBottom: space[3],
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space[3] },
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
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: space[3], gap: space[4] },
  action: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  spacer: { flex: 1 },
  actionText: { fontSize: fontSize.bodyMd, color: colors.fgSecondary },
  liked: { color: colors.brandText, fontWeight: '700' },
}));
