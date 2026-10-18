import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@features/auth/context/AuthContext';
import { usePosts } from '@features/posts/PostsContext';
import {
  moodForActionOutcome,
  reactionForActionOutcome,
  SETTLE_AFTER_MS,
  settledMood,
} from '@features/tero/animation/expressions';
import type { ActionOutcome } from '@features/tero/animation/expressions';
import { useTeroMotionAllowed } from '@features/tero/animation/useTeroMotion';
import type { ReactionRequest } from '@features/tero/animation/useTeroMotion';
import { TeroActionCardView } from '@features/tero/components/TeroActionCard';
import { TeroAvatar } from '@features/tero/components/TeroAvatar';
import { TeroDots } from '@features/tero/components/TeroDots';
import { TeroGate } from '@features/tero/components/TeroGate';
import { TeroPreviewNotice } from '@features/tero/components/TeroPreviewNotice';
import { TeroDictationButton } from '@features/tero/components/TeroDictationButton';
import { TERO_LIVE } from '@features/tero/config';
import { useTero } from '@features/tero/context/TeroContext';
import { teroColors } from '@features/tero/design/teroColors';
import {
  cardStateFromError,
  chatErrorMessage,
  confirmedNote,
  historyForRequest,
  initialCardState,
} from '@features/tero/lib/teroCards';
import {
  checkMessage,
  makeMessage,
  MAX_TERO_MESSAGE_LENGTH,
  statusLabel,
  withStatus,
} from '@features/tero/lib/teroChat';
import { teroClient } from '@features/tero/lib/teroClient';
import { useTeroSpeech } from '@features/tero/lib/useTeroSpeech';
import { DICTATION_PRIVACY } from '@features/tero/lib/teroVoice';
import { TERO_VOICE_ENABLED } from '@features/messages/voiceConfig';
import type {
  TeroActionCard,
  TeroCardState,
  TeroContext,
  TeroMessage,
  TeroMood,
} from '@features/tero/types';
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
  const { refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const animate = useTeroMotionAllowed();
  // La voz de Tero (ADR-045): lee sus respuestas si la persona lo tiene encendido.
  const { preferences, update } = useTero();
  const { speaking, speak, stop } = useTeroSpeech({ es: preferences.voiceId, en: preferences.voiceIdEn });
  const speakRepliesRef = useRef(preferences.speakReplies);
  speakRepliesRef.current = preferences.speakReplies;

  const [messages, setMessages] = useState<TeroMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Dictado (ADR-042 §1.2): mensaje propio (escuchando / error) y si está escuchando ahora.
  const [dictationMessage, setDictationMessage] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [replyMood, setReplyMood] = useState<TeroMood>('idle');
  // Reacción breve de Tero al desenlace de una tarjeta (celebrar / encogerse).
  const [reaction, setReaction] = useState<ReactionRequest | null>(null);
  // Estado de cada tarjeta de confirmación, por id de acción. Vive solo mientras la pantalla está
  // abierta, igual que la conversación: lo que cuenta es el estado real en el servidor.
  const [cardStates, setCardStates] = useState<Record<string, TeroCardState>>({});

  // Siempre la lista más reciente, para armar el historial sin depender de un cierre viejo.
  const messagesRef = useRef<TeroMessage[]>([]);
  messagesRef.current = messages;
  // Igual para las tarjetas: el servidor debe saber cómo terminó cada una (confirmada, cancelada...).
  const cardStatesRef = useRef<Record<string, TeroCardState>>({});
  cardStatesRef.current = cardStates;

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

  // Una tarjeta con botones mide más que un mensaje y la lista aún no conoce su altura cuando
  // llega: sin este segundo desplazamiento, Confirmar y Cancelar quedan tapados por el campo de
  // texto. Se repite al cambiar una tarjeta de estado (su texto cambia de alto).
  useEffect(() => {
    if (!messages.length) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: animate }), 150);
    return () => clearTimeout(timer);
  }, [messages.length, cardStates, animate]);

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
        const reply = await teroClient.send(message.text, context, {
          postContent,
          history: historyForRequest(messagesRef.current, message.id, cardStatesRef.current),
          signal: controller.signal,
        });
        const cards = reply.cards ?? [];
        if (cards.length) {
          const now = Date.now();
          setCardStates((current) => {
            const next = { ...current };
            for (const card of cards) next[card.id] = initialCardState(card, now);
            return next;
          });
        }
        setMessages((current) => [
          ...withStatus(current, message.id, 'sent'),
          { ...makeMessage('tero', reply.text, new Date(), reply.isMock), cards },
        ]);
        setReplyMood(reply.mood);
        if (speakRepliesRef.current) void speak(reply.text);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setMessages((current) => withStatus(current, message.id, 'failed'));
        setReplyMood('error');
        setError(chatErrorMessage(caught));
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [posts, speak],
  );

  const send = useCallback(
    (input: string, context: TeroContext) => {
      const check = checkMessage(input);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      stop();
      const message: TeroMessage = { ...makeMessage('user', check.text), status: 'sending' };
      contexts.current.set(message.id, context);
      setMessages((current) => [...current, message]);
      void deliver(message, context);
    },
    [deliver, stop],
  );

  function retry(message: TeroMessage) {
    if (pending) return;
    void deliver(message, contexts.current.get(message.id) ?? { screen: 'tero' });
  }

  function setCard(id: string, state: TeroCardState) {
    setCardStates((current) => ({ ...current, [id]: state }));
  }

  /** Tero reacciona al desenlace: celebra lo que se hizo, se encoge si falló, calla si no. */
  function reactToOutcome(outcome: ActionOutcome) {
    const kind = reactionForActionOutcome(outcome);
    const nextMood = moodForActionOutcome(outcome);
    if (nextMood) setReplyMood(nextMood);
    if (kind) setReaction({ kind, key: Date.now() });
  }

  /** Solo la persona llega aquí, al pulsar «Confirmar»: es lo único que ejecuta la acción. */
  async function confirmCard(card: TeroActionCard) {
    if (cardStates[card.id]?.status !== 'pending') return;
    setCard(card.id, { status: 'confirming' });
    try {
      const result = await teroClient.confirmAction(card.id);
      setCard(card.id, { status: 'confirmed', note: confirmedNote(result) });
      reactToOutcome('confirmed');
      // Lo que cambió ya no coincide con lo que la app tiene en memoria: se vuelve a leer.
      if (card.kind === 'update_profile') void refreshUser();
      else void posts.reload();
    } catch (caught) {
      const next = cardStateFromError(caught);
      setCard(card.id, next);
      // Solo un fallo definitivo cuenta (sin red o límite de intentos deja la tarjeta pendiente).
      if (next.status !== 'pending') reactToOutcome(next.status as ActionOutcome);
    }
  }

  async function cancelCard(card: TeroActionCard) {
    if (cardStates[card.id]?.status !== 'pending') return;
    setCard(card.id, { status: 'cancelling' });
    try {
      await teroClient.cancelAction(card.id);
      setCard(card.id, { status: 'cancelled', note: 'Cancelada. No se hizo ningún cambio.' });
    } catch (caught) {
      setCard(card.id, cardStateFromError(caught));
    }
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
    : (inputFocused && draft.trim()) || dictating
      ? 'listening'
      : speaking
        ? 'speaking'
        : replyMood;

  const heroText = pending
    ? 'Tero está pensando…'
    : mood === 'listening'
      ? 'Te escucho…'
      : mood === 'error'
        ? 'Algo salió mal.'
        : mood === 'speaking'
          ? 'Tero responde…'
          : mood === 'happy'
            ? '¡Listo!'
            : 'Pregúntame sobre THERS.';

  return (
    <Screen title="Preguntar a Tero" back scroll={false} withBottomInset={false}>
      {/* Tero queda fijo arriba mientras la conversación se desplaza: así se le ve pensar, hablar
          y reaccionar aunque la lista sea larga. */}
      <View style={styles.statusBar}>
        <TeroAvatar size={56} mood={mood} reaction={reaction} />
        <Text style={styles.heroText} accessibilityLiveRegion="polite">
          {heroText}
        </Text>
        <Pressable
          onPress={() => {
            stop();
            update({ speakReplies: !preferences.speakReplies });
          }}
          style={[styles.voiceToggle, preferences.speakReplies && styles.voiceToggleOn]}
          accessibilityRole="switch"
          accessibilityState={{ checked: preferences.speakReplies }}
          accessibilityLabel="Tero habla"
          accessibilityHint="Activa o apaga la lectura en voz alta de las respuestas de Tero"
          hitSlop={8}
        >
          <Text style={[styles.voiceToggleText, preferences.speakReplies && styles.voiceToggleTextOn]}>
            {preferences.speakReplies ? 'Voz: sí' : 'Voz: no'}
          </Text>
        </Pressable>
      </View>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: animate })}
        ListHeaderComponent={
          <View>
            {TERO_LIVE ? (
              <Text style={styles.liveHint}>
                Tero puede equivocarse: revisa lo importante. Nada cambia en tu cuenta sin que lo
                confirmes. La conversación no se guarda.
              </Text>
            ) : (
              <TeroPreviewNotice message="Las respuestas son de ejemplo, no de una IA. La conversación no se guarda." />
            )}
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
          <View>
            <MessageBubble message={item} animate={animate} onRetry={() => retry(item)} retryDisabled={pending} />
            {item.cards?.map((card) => (
              <TeroActionCardView
                key={card.id}
                card={card}
                state={cardStates[card.id] ?? initialCardState(card)}
                onConfirm={() => void confirmCard(card)}
                onCancel={() => void cancelCard(card)}
              />
            ))}
          </View>
        )}
      />

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {TERO_VOICE_ENABLED && dictationMessage ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {dictationMessage}
        </Text>
      ) : null}
      {TERO_VOICE_ENABLED && dictating ? (
        <Text style={styles.dictationHint} accessibilityLiveRegion="polite">
          Escuchando… habla ahora
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
        {TERO_VOICE_ENABLED ? (
          <TeroDictationButton
            draft={draft}
            onDraft={setDraft}
            onMessage={setDictationMessage}
            onListening={(listening) => {
              if (listening) stop();
              setDictating(listening);
            }}
            disabled={pending}
          />
        ) : null}
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
      {TERO_VOICE_ENABLED ? (
        <Text style={[styles.dictationHint, { paddingBottom: insets.bottom + space[2] }]}>{DICTATION_PRIVACY}</Text>
      ) : null}
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
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  heroText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.fgSecondary },
  voiceToggle: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  voiceToggleOn: { borderColor: teroColors.blue },
  voiceToggleText: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  voiceToggleTextOn: { color: teroColors.blue },
  liveHint: {
    fontSize: fontSize.bodySm,
    color: colors.fgMuted,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: space[4],
  },
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
  dictationHint: { fontSize: fontSize.labelMd, color: colors.fgMuted, paddingHorizontal: space[4], paddingTop: space[1] },
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
