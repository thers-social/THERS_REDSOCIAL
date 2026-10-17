import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePosts } from '@features/posts/PostsContext';
import { TeroAvatar } from '@features/tero/components/TeroAvatar';
import { TeroGate } from '@features/tero/components/TeroGate';
import { TeroPreviewNotice } from '@features/tero/components/TeroPreviewNotice';
import { useTero } from '@features/tero/context/TeroContext';
import { checkMessage, makeMessage, MAX_TERO_MESSAGE_LENGTH } from '@features/tero/lib/teroChat';
import { teroClient } from '@features/tero/lib/teroClient';
import { useReducedMotion } from '@features/tero/lib/useReducedMotion';
import type { TeroContext, TeroMessage, TeroMood } from '@features/tero/types';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Screen } from '@shared/ui/Screen';

const POST_SUMMARY_PROMPT = 'Resume esta publicación';

/**
 * Chat con Tero. Parámetros opcionales:
 * - `prompt`: pregunta que se envía al abrir (desde el inicio de Tero);
 * - `postId`: abre el chat pidiendo el resumen de esa publicación (acciones
 *   contextuales del menú «⋯»). El texto se busca en las publicaciones ya
 *   cargadas, no viaja en la URL.
 *
 * La conversación vive solo en memoria mientras la pantalla está abierta: no se
 * guarda en el teléfono (ADR-041 decidirá retención e historial).
 */
export default function TeroChat() {
  return (
    <TeroGate>
      <TeroChatContent />
    </TeroGate>
  );
}

function TeroChatContent() {
  const params = useLocalSearchParams<{ prompt?: string; postId?: string }>();
  const { preferences } = useTero();
  const posts = usePosts();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const animate = preferences.animations && !reducedMotion;

  const [messages, setMessages] = useState<TeroMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mood, setMood] = useState<TeroMood>('idle');

  const listRef = useRef<FlatList<TeroMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (input: string, context: TeroContext) => {
      const check = checkMessage(input);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      setError(null);
      setMessages((current) => [...current, makeMessage('user', check.text)]);
      setPending(true);
      setMood('thinking');

      const controller = new AbortController();
      abortRef.current = controller;
      const postContent = context.entityId ? (posts.getPost(context.entityId)?.content ?? null) : null;

      try {
        const reply = await teroClient.send(check.text, context, { postContent, signal: controller.signal });
        setMessages((current) => [...current, makeMessage('tero', reply.text, new Date(), reply.isMock)]);
        setMood(reply.mood);
      } catch {
        if (controller.signal.aborted) return;
        setMood('error');
        setError('Tero no pudo responder. Intenta de nuevo.');
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [posts],
  );

  // Pregunta inicial, una sola vez (el doble montaje de desarrollo no la repite).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (params.postId) {
      void send(POST_SUMMARY_PROMPT, { screen: 'post', entityType: 'post', entityId: params.postId });
    } else if (params.prompt) {
      void send(params.prompt, { screen: 'tero' });
    }
  }, [params.postId, params.prompt, send]);

  function submit() {
    if (pending) return;
    const text = draft;
    setDraft('');
    void send(text, { screen: 'tero' });
  }

  return (
    <Screen title="Preguntar a Tero" back scroll={false} withBottomInset={false}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: animate })}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <TeroAvatar size={72} mood={mood} animated={animate} />
              <Text style={styles.heroText}>
                {pending ? 'Tero está pensando…' : 'Pregúntame sobre THERS.'}
              </Text>
            </View>
            <TeroPreviewNotice message="Las respuestas son de ejemplo. La conversación no se guarda." />
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.mine : styles.theirs]}>
            <Text style={item.role === 'user' ? styles.mineText : styles.theirsText}>{item.text}</Text>
          </View>
        )}
      />

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={[styles.composer, { paddingBottom: insets.bottom + space[2] }]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Escribe tu pregunta"
          placeholderTextColor={colors.fgDisabled}
          multiline
          maxLength={MAX_TERO_MESSAGE_LENGTH}
          accessibilityLabel="Pregunta para Tero"
        />
        <Pressable
          onPress={submit}
          disabled={!draft.trim() || pending}
          style={[styles.send, (!draft.trim() || pending) && styles.sendDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Enviar pregunta"
          accessibilityState={{ disabled: !draft.trim() || pending, busy: pending }}
        >
          <Text style={styles.sendText}>Enviar</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  list: { padding: space[4], paddingBottom: space[6] },
  hero: { alignItems: 'center', marginBottom: space[4] },
  heroText: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginTop: space[2] },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.card,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    marginBottom: space[2],
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  mineText: { fontSize: fontSize.bodyMd, color: colors.onBrand, lineHeight: 21 },
  theirsText: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 21 },
  error: { fontSize: fontSize.bodySm, color: colors.dangerFg, paddingHorizontal: space[4], paddingBottom: space[2] },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingTop: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  send: {
    minHeight: 44,
    paddingHorizontal: space[4],
    borderRadius: radius.input,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.onBrand },
}));
