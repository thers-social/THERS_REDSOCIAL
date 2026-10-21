import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@shared/lib/api';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';

import { deleteComment, fetchComments, postComment } from './api';
import { commentErrorMessage, formatCount } from './reelsLogic';
import type { ReelComment } from './types';

const MAX_COMMENT = 1000;

type Props = {
  videoId: string;
  count: number;
  onClose: () => void;
  /** Mantiene al día el contador del carril de acciones. */
  onCountChange: (delta: number) => void;
};

/** Hoja inferior de comentarios de un Reel (ADR-055): el Reel sigue detrás, como en Instagram. */
export function ReelComments({ videoId, count, onClose, onCountChange }: Props) {
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<ReelComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      try {
        const data = await fetchComments(videoId, offset);
        setComments((current) => (offset ? [...current, ...data.comments] : data.comments));
        setHasMore(data.has_more);
        setState('ready');
      } catch {
        if (!offset) setState('error');
      }
    },
    [videoId],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  async function submit() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const comment = await postComment(videoId, content);
      setComments((current) => [...current, comment]);
      setText('');
      onCountChange(1);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      Alert.alert('No se pudo comentar', commentErrorMessage(status, error instanceof ApiError ? error.message : undefined));
    } finally {
      setSending(false);
    }
  }

  function confirmDelete(comment: ReelComment) {
    Alert.alert('¿Borrar el comentario?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(videoId, comment.id);
            setComments((current) => current.filter((item) => item.id !== comment.id));
            onCountChange(-1);
          } catch {
            Alert.alert('No se pudo borrar el comentario');
          }
        },
      },
    ]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar comentarios" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.head}>
            <Text style={styles.title}>{formatCount(count)} comentarios</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
              <Icon name="close" size={22} color="#ffffff" />
            </Pressable>
          </View>

          {state === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator color="#ffffff" />
            </View>
          ) : state === 'error' ? (
            <Pressable style={styles.center} onPress={() => void load(0)}>
              <Text style={styles.muted}>No se pudieron cargar los comentarios. Toca para reintentar.</Text>
            </Pressable>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Text style={[styles.muted, styles.empty]}>Todavía no hay comentarios. Sé la primera persona.</Text>}
              onEndReached={() => hasMore && void load(comments.length)}
              onEndReachedThreshold={0.4}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.row}
                  onLongPress={item.can_delete ? () => confirmDelete(item) : undefined}
                  accessibilityHint={item.can_delete ? 'Mantén pulsado para borrar' : undefined}
                >
                  <Avatar name={item.author.name || item.author.username} uri={item.author.avatar_url} size={32} />
                  <View style={styles.body}>
                    <Text style={styles.author}>@{item.author.username}</Text>
                    <Text style={styles.content}>{item.content}</Text>
                  </View>
                  {item.can_delete ? (
                    <Pressable onPress={() => confirmDelete(item)} accessibilityRole="button" accessibilityLabel="Borrar comentario" hitSlop={10}>
                      <Icon name="trash" size={18} color="#9ca3af" />
                    </Pressable>
                  ) : null}
                </Pressable>
              )}
            />
          )}

          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Escribe un comentario…"
              placeholderTextColor="#9ca3af"
              maxLength={MAX_COMMENT}
              multiline
              style={styles.input}
              accessibilityLabel="Escribe un comentario"
            />
            <Pressable
              onPress={() => void submit()}
              disabled={sending || !text.trim()}
              accessibilityRole="button"
              accessibilityLabel="Publicar comentario"
              style={[styles.send, (sending || !text.trim()) && styles.sendOff]}
            >
              {sending ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.sendText}>Publicar</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { height: '68%', backgroundColor: '#18181b', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { paddingHorizontal: 16, paddingVertical: 8, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  body: { flex: 1, gap: 2 },
  author: { color: '#d4d4d8', fontSize: 12, fontWeight: '700' },
  content: { color: '#fff', fontSize: 14, lineHeight: 19 },
  muted: { color: '#9ca3af', fontSize: 14, textAlign: 'center' },
  empty: { paddingVertical: 32 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#3f3f46' },
  input: { flex: 1, maxHeight: 110, color: '#fff', backgroundColor: '#27272a', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14 },
  send: { backgroundColor: '#7c3aed', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, minWidth: 84, alignItems: 'center' },
  sendOff: { opacity: 0.45 },
  sendText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
