import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePosts } from '@features/posts/PostsContext';
import { SETTLE_AFTER_MS, settledMood } from '@features/tero/animation/expressions';
import { useTeroMotionAllowed } from '@features/tero/animation/useTeroMotion';
import { TeroAvatar } from '@features/tero/components/TeroAvatar';
import { TeroDots } from '@features/tero/components/TeroDots';
import { TeroGate } from '@features/tero/components/TeroGate';
import { TeroPreviewNotice } from '@features/tero/components/TeroPreviewNotice';
import { teroColors } from '@features/tero/design/teroColors';
import {
  checkMessage,
  makeMessage,
  MAX_TERO_MESSAGE_LENGTH,
  statusLabel,
  withStatus,
} from '@features/tero/lib/teroChat';
import { teroClient } from '@features/tero/lib/teroClient';
import type { TeroContext, TeroMessage, TeroMood } from '@features/tero/types';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Screen } from '@shared/ui/Screen';

const POST_SUMMARY_PROMPT = 'Resume esta publicación';
/** Un mensaje "recién llegado" entra animado; los anteriores, no. */
const FRESH_MS = 1500;

/**
 * Chat con Tero. Parámetros opcionales:
 * - `prompt`: pregunta que se envía al abrir (desde el inicio de Tero);
 * - `postId`: abre el chat pidiendo el resumen de esa publicación (acciones
 *   contextuales del menú «⋯»). El texto se busca en las publicaciones ya
 *   cargadas, no viaja en la URL.
 *
 * Estados visibles: mensaje enviándose, enviado o fallido (con «Reintentar»),
 * Tero escuchando mientras se escribe, pensando (burbuja con puntos) y
 * respondiendo. La conversación vive solo en memoria mientras la pantalla está
 * abierta: no se guarda en el teléfono (ADR-041 decidirá retención e historial).
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
  const posts = usePosts();
  const insets = useSafeAreaInsets();
  const animate = useTeroMotionAllowed();

  const [messages, setMessages] = useState<TeroMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [replyMood, setReplyMood] = useState<TeroMood>('idle');

  const listRef = useRef<FlatList<TeroMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  // Contexto de cada mensaje propio, para reintentarlo igual que la primera vez.
  const contexts = useRef(new Map<string, TeroContext>());

  useEffect(() => () => abortRef.current?.abort(), []);

  // Tras responder, Tero vuelve solo a reposo (no se queda "hablando").
  useEffect(() => {
    const next = settledMood(replyMood);
    if (next === replyMood) return;
    const timer = setTimeout(() => setReplyMood(next), SETTLE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [replyMood]);

  /** Envía `message` (nuevo o reintento) y espera la respuesta. */
  const deliver = useCallback(
    async (message: TeroMessage, context: TeroContext) => {
      setError(null);
      setPending(true);
      setMessages((current) => withStatus(current, message.id, 'sending'));

      const controller = new AbortController();
      abortRef.current = controller;
      const postContent = context.entityId ? (posts.getPost(context.entityId)?.content ?? null) : null;

      try {
        const reply = await teroClient.send(message.text, context, { postContent, signal: controller.signal });
        setMessages((current) => [
          ...withStatus(current, message.id, 'sent'),
          makeMessage('tero', reply.text, new Date(), reply.isMock),
        ]);
        setReplyMood(reply.mood);
      } catch {
        if (controller.signal.aborted) return;
        setMessages((current) => withStatus(current, message.id, 'failed'));
        setReplyMood('error');
        setError('Tero no pudo responder. Puedes reintentar.');
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [posts],
  );

  const send = useCallback(
    (input: string, context: TeroContext) => {
      const check = checkMessage(input);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      const message: TeroMessage = { ...makeMessage('user', check.text), status: 'sending' };
      contexts.current.set(message.id, context);
      setMessages((current) => [...current, message]);
      void deliver(message, context);
    },
    [deliver],
  );

  function retry(message: TeroMessage) {
    if (pending) return;
    void deliver(message, contexts.current.get(message.id) ?? { screen: 'tero' });
  }

  // Pregunta inicial, una sola vez (el doble montaje de desarrollo no la repite).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (params.postId) {
      send(POST_SUMMARY_PROMPT, { screen: 'post', entityType: 'post', entityId: params.postId });
    } else if (params.prompt) {
      send(params.prompt, { screen: 'tero' });
    }
  }, [params.postId, params.prompt, send]);

  function submit() {
    if (pending) return;
    const text = draft;
    setDraft('');
    send(text, { screen: 'tero' });
  }

  // Pensando mientras espera; escuchando solo mientras la persona escribe en
  // este campo (no hay ninguna otra "atención": nada de vigilancia).
  const mood: TeroMood = pending
    ? 'thinking'
    : inputFocused && draft.trim()
      ? 'listening'
      : replyMood;

  const heroText = pending
    ? 'Tero está pensando…'
    : mood === 'listening'
      ? 'Te escucho…'
      : mood === 'error'
        ? 'Algo salió mal.'
        : 'Pregúntame sobre THERS.';

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
              <TeroAvatar size={72} mood={mood} />
              <Text style={styles.heroText} accessibilityLiveRegion="polite">
                {heroText}
              </Text>
            </View>
            <TeroPreviewNotice message="Las respuestas son de ejemplo, no de una IA. La conversación no se guarda." />
          </View>
        }
        ListFooterComponent={
          pending ? (
            <View
              style={[styles.bubble, styles.theirs, styles.typing]}
              accessible
              accessibilityLabel="Tero está escribiendo"
            >
              <TeroDots color={teroColors.blue} animated={animate} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <MessageBubble message={item} animate={animate} onRetry={() => retry(item)} retryDisabled={pending} />
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
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
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

function MessageBubble({
  message,
  animate,
  onRetry,
  retryDisabled,
}: {
  message: TeroMessage;
  animate: boolean;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  const mine = message.role === 'user';
  // Solo entran animados los mensajes recién creados, no los que reaparecen al
  // desplazarse por la lista.
  const fresh = animate && Date.now() - Date.parse(message.createdAt) < FRESH_MS;
  const appear = useRef(new Animated.Value(fresh ? 0 : 1)).current;

  useEffect(() => {
    if (!fresh) return;
    const animation = Animated.timing(appear, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fresh, appear]);

  const label = mine ? statusLabel(message.status) : null;

  return (
    <Animated.View
      style={{
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      <View
        style={[
          styles.bubble,
          mine ? styles.mine : styles.theirs,
          message.status === 'failed' && styles.failed,
        ]}
      >
        <Text style={mine ? styles.mineText : styles.theirsText}>{message.text}</Text>
      </View>
      {label ? (
        <View style={styles.statusRow}>
          <Text style={[styles.status, message.status === 'failed' && styles.statusFailed]}>{label}</Text>
          {message.status === 'failed' ? (
            <Pressable
              onPress={onRetry}
              disabled={retryDisabled}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Reintentar el envío"
            >
              <Text style={styles.retry}>Reintentar</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
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
    marginBottom: space[1],
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: space[2],
  },
  failed: { opacity: 0.7 },
  typing: { paddingVertical: space[3] },
  mineText: { fontSize: fontSize.bodyMd, color: colors.onBrand, lineHeight: 21 },
  theirsText: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 21 },
  statusRow: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    alignItems: 'center',
    gap: space[2],
    marginBottom: space[2],
  },
  status: { fontSize: fontSize.labelSm, color: colors.fgMuted },
  statusFailed: { color: colors.dangerFg },
  retry: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.brandText },
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
