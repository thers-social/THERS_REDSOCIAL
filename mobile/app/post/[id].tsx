import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@features/auth/context/AuthContext';
import { createComment, deleteComment, fetchComments, updateComment } from '@features/posts/api';
import { PostCard } from '@features/posts/PostCard';
import { messageOf, usePosts } from '@features/posts/PostsContext';
import { MAX_POST_LENGTH } from '@features/posts/types';
import type { PostComment } from '@features/posts/types';
import { usePostMenu } from '@features/posts/usePostMenu';
import { ReportModal } from '@features/safety/ReportModal';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { formatRelativeTime } from '@shared/lib/time';
import { ActionSheet } from '@shared/ui/ActionSheet';
import type { SheetAction } from '@shared/ui/ActionSheet';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { EditTextModal } from '@shared/ui/EditTextModal';
import { MentionText } from '@shared/ui/MentionText';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Detalle de una publicación con sus comentarios. El servidor no tiene un endpoint
 * «una publicación por id»: se toma de la lista ya cargada (o se vuelve a pedir
 * una vez). Si no aparece, es porque ya no existe o quedó fuera de las 50 más
 * recientes.
 */
export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const posts = usePosts();
  const menu = usePostMenu();
  const insets = useSafeAreaInsets();

  const post = posts.getPost(id);

  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<PostComment | null>(null);
  const [editing, setEditing] = useState<PostComment | null>(null);
  const [reporting, setReporting] = useState<PostComment | null>(null);
  const [reloaded, setReloaded] = useState(false);

  // Si la publicación no está en la lista (se llegó desde un aviso), se pide una vez.
  useEffect(() => {
    if (!post && posts.status === 'ready' && !reloaded) {
      setReloaded(true);
      void posts.reload();
    }
  }, [post, posts, reloaded]);

  const loadComments = useCallback(async () => {
    try {
      setComments(await fetchComments(id));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [id]);

  useEffect(() => {
    if (post) void loadComments();
    // Solo al abrir esta publicación; los cambios posteriores los maneja la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, post?.id]);

  if (!user) return null;

  async function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await createComment(id, text);
      setComments((current) => [...(current ?? []), created]);
      posts.bumpCommentCount(id, 1);
      setDraft('');
    } catch (e) {
      setSendError(messageOf(e));
    } finally {
      setSending(false);
    }
  }

  const commentActions: SheetAction[] = !menuFor
    ? []
    : menuFor.author.id === user.id
      ? [
          { label: 'Editar comentario', onPress: () => setEditing(menuFor) },
          {
            label: 'Eliminar comentario',
            destructive: true,
            onPress: () =>
              Alert.alert('Eliminar comentario', 'No se puede deshacer.', [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Eliminar',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteComment(menuFor.id);
                      setComments((current) => current?.filter((c) => c.id !== menuFor.id) ?? current);
                      posts.bumpCommentCount(id, -1);
                    } catch (e) {
                      Alert.alert('No se pudo eliminar', messageOf(e));
                    }
                  },
                },
              ]),
          },
        ]
      : [{ label: 'Reportar comentario', onPress: () => setReporting(menuFor) }];

  return (
    <Screen title="Publicación" back scroll={false}>
      {!post ? (
        posts.status === 'loading' || posts.status === 'idle' || !reloaded ? (
          <StateMessage kind="loading" />
        ) : (
          <StateMessage
            kind="empty"
            title="No encontramos esta publicación"
            message="Puede que se haya eliminado o que ya no esté entre las más recientes."
          />
        )
      ) : (
        <>
          <FlatList
            data={comments ?? []}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View>
                <PostCard
                  post={post}
                  myId={user.id}
                  onLike={menu.like}
                  onMenu={menu.openMenu}
                  onFollow={menu.follow}
                  detail
                />
                <Text style={styles.commentsTitle}>Comentarios ({post.comments_count})</Text>
              </View>
            }
            ListEmptyComponent={
              comments === null && !error ? (
                <StateMessage kind="loading" />
              ) : error && comments === null ? (
                <StateMessage
                  kind="error"
                  title="No pudimos cargar los comentarios"
                  message={error}
                  actionLabel="Reintentar"
                  onAction={loadComments}
                />
              ) : (
                <StateMessage kind="empty" message="Todavía no hay comentarios." />
              )
            }
            renderItem={({ item }) => (
              <View style={styles.comment}>
                <Avatar name={item.author.name} uri={item.author.avatar_url} size={34} />
                <View style={styles.commentBody}>
                  <Text style={styles.commentHead}>
                    <Text style={styles.commentName}>{item.author.name}</Text>
                    {'  '}
                    <Text style={styles.commentMeta}>
                      {formatRelativeTime(item.created_at)}
                      {item.edited ? ' · editado' : ''}
                    </Text>
                  </Text>
                  <MentionText
                    text={item.content}
                    usernames={item.mentions.map((m) => m.username)}
                    style={styles.commentText}
                  />
                </View>
                <Pressable
                  onPress={() => setMenuFor(item)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Opciones del comentario"
                >
                  <Text style={styles.more}>⋯</Text>
                </Pressable>
              </View>
            )}
          />

          {sendError ? (
            <View style={styles.sendError}>
              <Banner tone="error">{sendError}</Banner>
            </View>
          ) : null}
          <View style={[styles.composer, { paddingBottom: insets.bottom + space[2] }]}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Escribe un comentario"
              placeholderTextColor={colors.fgDisabled}
              multiline
              maxLength={MAX_POST_LENGTH}
              accessibilityLabel="Comentario"
              editable={!sending}
            />
            <Pressable
              onPress={submit}
              disabled={!draft.trim() || sending}
              style={[styles.send, (!draft.trim() || sending) && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Publicar comentario"
            >
              <Text style={styles.sendText}>{sending ? '…' : 'Enviar'}</Text>
            </Pressable>
          </View>
        </>
      )}

      {menu.element}
      <ActionSheet visible={menuFor !== null} actions={commentActions} onClose={() => setMenuFor(null)} />
      <EditTextModal
        visible={editing !== null}
        title="Editar comentario"
        initialValue={editing?.content ?? ''}
        maxLength={MAX_POST_LENGTH}
        onSubmit={async (text) => {
          if (!editing) return;
          try {
            const updated = await updateComment(editing.id, text);
            setComments((current) => current?.map((c) => (c.id === updated.id ? updated : c)) ?? current);
          } catch (e) {
            throw new Error(messageOf(e));
          }
        }}
        onClose={() => setEditing(null)}
      />
      <ReportModal
        visible={reporting !== null}
        targetType="comment"
        targetId={reporting?.id ?? ''}
        targetLabel="este comentario"
        onClose={() => setReporting(null)}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  list: { padding: space[4], paddingBottom: space[6] },
  commentsTitle: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginBottom: space[3] },
  comment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: space[2],
    gap: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  commentBody: { flex: 1 },
  commentHead: { fontSize: fontSize.bodySm },
  commentName: { fontWeight: '700', color: colors.fg },
  commentMeta: { color: colors.fgMuted, fontSize: fontSize.labelMd },
  commentText: { fontSize: fontSize.bodyMd, color: colors.fg, marginTop: 2, lineHeight: 20 },
  more: { fontSize: 22, color: colors.fgMuted, lineHeight: 24 },
  sendError: { paddingHorizontal: space[3] },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingTop: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  send: {
    minHeight: 44,
    minWidth: 72,
    borderRadius: radius.input,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.onBrand, fontWeight: '700' },
}));
