/**
 * Estado y sincronización de UN chat (`ADR-035-chat-sync.md`).
 *
 * TRANSPORTE: consultas periódicas (polling) al servidor, NO una conexión en
 * tiempo real. Las consultas:
 *  - solo corren mientras la pantalla está activa Y la app está en primer plano;
 *  - se espacian mientras el chat está en silencio y se acortan al llegar algo;
 *  - retroceden de forma exponencial tras un error;
 *  - recuperan lo que llegó mientras no estaba la conexión pidiendo, por
 *    instante, todo lo posterior al último mensaje confirmado.
 *
 * ENVÍO: cada mensaje lleva un `client_id`; reintentar un envío fallido reutiliza
 * el mismo, así que el servidor lo devuelve en vez de duplicarlo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError } from '@shared/lib/api';

import {
  MAX_MESSAGE_LENGTH,
  PAGE_SIZE,
  deleteMessage,
  editMessage,
  fetchThread,
  newClientId,
  sendMessage,
  sendVoiceMessage,
} from './api';
import type { ChatMessage } from './api';
import {
  latestConfirmedAt,
  makePending,
  makePendingVoice,
  mergeMessages,
  nextPollDelayMs,
  oldestConfirmedAt,
  removeLocal,
  setLocalState,
} from './chatState';
import type { LocalMessage } from './chatState';
import { voiceSendErrorMessage } from './voice';
import type { VoiceRecording } from './voice';
import { deleteVoiceFile } from './voiceFiles';

type LoadState = 'loading' | 'ready' | 'error' | 'unavailable';

type Options = {
  myId: string;
  otherUserId: string;
  /** `true` solo mientras la pantalla está enfocada. */
  active: boolean;
};

export type ChatApi = {
  messages: LocalMessage[];
  state: LoadState;
  /** Mensaje de error de la carga inicial, o por qué no se puede abrir el chat. */
  error: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  /** `true` cuando la última consulta periódica falló (probablemente sin conexión). */
  offline: boolean;
  reload: () => Promise<void>;
  loadOlder: () => Promise<void>;
  send: (text: string) => void;
  /** Envía una nota de voz grabada (ADR-042). */
  sendVoice: (recording: VoiceRecording) => void;
  retry: (clientId: string) => void;
  discard: (clientId: string) => void;
  edit: (messageId: string, text: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
};

export function useChat({ myId, otherUserId, active }: Options): ChatApi {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [offline, setOffline] = useState(false);

  // Refs: el ciclo de consulta vive fuera del render y no debe quedarse con estado viejo.
  const messagesRef = useRef<LocalMessage[]>([]);
  messagesRef.current = messages;
  const idlePolls = useRef(0);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polling = useRef(false);
  const mounted = useRef(true);
  const appActive = useRef(AppState.currentState === 'active');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback((next: LocalMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // --- carga inicial ---------------------------------------------------------
  const reload = useCallback(async () => {
    setState((current) => (current === 'ready' ? current : 'loading'));
    try {
      const page = await fetchThread(otherUserId, { limit: PAGE_SIZE });
      if (!mounted.current) return;
      apply(mergeMessages(messagesRef.current.filter((m) => m.local), page.messages));
      setHasOlder(page.has_more === true);
      setError(null);
      setState('ready');
      failures.current = 0;
      setOffline(false);
    } catch (e) {
      if (!mounted.current) return;
      // 404: la otra cuenta ya no existe o hay un bloqueo (ADR-029/ADR-031): el
      // servidor responde igual en ambos casos y la pantalla no distingue.
      if (e instanceof ApiError && e.status === 404) {
        setState('unavailable');
        setError('Usuario no encontrado');
        return;
      }
      setError(e instanceof ApiError ? e.message : 'No pudimos cargar la conversación.');
      setState((current) => (current === 'ready' ? current : 'error'));
    }
  }, [otherUserId, apply]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // --- historial hacia atrás ---------------------------------------------------
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder) return;
    const cursor = oldestConfirmedAt(messagesRef.current);
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const page = await fetchThread(otherUserId, { before: cursor, limit: PAGE_SIZE });
      if (!mounted.current) return;
      apply(mergeMessages(messagesRef.current, page.messages));
      setHasOlder(page.has_more === true);
    } catch {
      // Se puede volver a intentar al subir otra vez: no se bloquea la pantalla.
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }, [otherUserId, hasOlder, loadingOlder, apply]);

  // --- consulta periódica / recuperación ------------------------------------------
  const pollOnce = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      let cursor = latestConfirmedAt(messagesRef.current);
      let received = 0;
      // Si llegaron muchos mensajes mientras no había conexión, se piden por páginas.
      for (let page = 0; page < 5; page++) {
        const result = await fetchThread(otherUserId, { after: cursor, limit: 100 });
        if (!mounted.current) return;
        const before = messagesRef.current.length;
        apply(mergeMessages(messagesRef.current, result.messages));
        received += Math.max(0, messagesRef.current.length - before);
        if (!result.has_more || result.messages.length === 0) break;
        cursor = result.messages[result.messages.length - 1].created_at;
      }
      failures.current = 0;
      setOffline(false);
      idlePolls.current = received > 0 ? 0 : idlePolls.current + 1;
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 404) {
        setState('unavailable');
        setError('Usuario no encontrado');
        return;
      }
      failures.current += 1;
      setOffline(true);
    } finally {
      polling.current = false;
    }
  }, [otherUserId, apply]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      if (!mounted.current) return;
      await pollOnce();
      if (mounted.current && stateRef.current === 'ready') schedule();
    }, nextPollDelayMs(idlePolls.current, failures.current));
  }, [pollOnce]);

  const stateRef = useRef<LoadState>('loading');
  stateRef.current = state;

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Solo se consulta con la pantalla activa y la app en primer plano.
  useEffect(() => {
    if (!active || state !== 'ready') {
      stop();
      return undefined;
    }

    const subscription = AppState.addEventListener('change', (next) => {
      appActive.current = next === 'active';
      if (next === 'active') {
        // Al volver a primer plano se recupera ya, sin esperar al temporizador.
        stop();
        idlePolls.current = 0;
        void pollOnce().then(() => {
          if (mounted.current) schedule();
        });
      } else {
        stop();
      }
    });

    if (appActive.current) {
      // Al volver a enfocar la pantalla también se recupera lo que llegó.
      idlePolls.current = 0;
      void pollOnce().then(() => {
        if (mounted.current) schedule();
      });
    }

    return () => {
      subscription.remove();
      stop();
    };
  }, [active, state, pollOnce, schedule, stop]);

  // --- envío ----------------------------------------------------------------------
  const transmit = useCallback(
    async (clientId: string, content: string, recording?: VoiceRecording) => {
      try {
        const sent = recording
          ? await sendVoiceMessage(otherUserId, recording, clientId, content)
          : await sendMessage(otherUserId, content, clientId);
        if (!mounted.current) return;
        apply(mergeMessages(messagesRef.current, [sent]));
        idlePolls.current = 0;
        // Ya está en el servidor: la copia local de la voz deja de hacer falta.
        if (recording) deleteVoiceFile(recording.uri);
      } catch (e) {
        if (!mounted.current) return;
        if (e instanceof ApiError && !e.isNetworkError && e.status >= 400 && e.status < 500) {
          // Rechazado por una regla (bloqueo, "no acepta mensajes", cuenta que ya no
          // existe): reintentar no lo arregla, así que se quita y se explica.
          apply(removeLocal(messagesRef.current, clientId));
          if (recording) deleteVoiceFile(recording.uri);
          // Una nota de voz tiene sus propios rechazos (apagada, demasiado grande): se explican.
          setError((recording && voiceSendErrorMessage(e)) || e.message);
          if (e.status === 404) setState('unavailable');
          return;
        }
        // Sin red o error del servidor: se conserva, marcado, para reintentar.
        apply(setLocalState(messagesRef.current, clientId, 'failed'));
      }
    },
    [otherUserId, apply],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || content.length > MAX_MESSAGE_LENGTH) return;
      const clientId = newClientId();
      apply(mergeMessages(messagesRef.current, [])); // normaliza antes de añadir
      apply([...messagesRef.current, makePending(clientId, myId, otherUserId, content)]);
      setError(null);
      void transmit(clientId, content);
    },
    [myId, otherUserId, apply, transmit],
  );

  const sendVoice = useCallback(
    (recording: VoiceRecording) => {
      const clientId = newClientId();
      apply(mergeMessages(messagesRef.current, [])); // normaliza antes de añadir
      apply([...messagesRef.current, makePendingVoice(clientId, myId, otherUserId, recording, '')]);
      setError(null);
      void transmit(clientId, '', recording);
    },
    [myId, otherUserId, apply, transmit],
  );

  const retry = useCallback(
    (clientId: string) => {
      const target = messagesRef.current.find((m) => m.local && m.client_id === clientId);
      if (!target) return;
      apply(setLocalState(messagesRef.current, clientId, 'sending'));
      // Mismo `client_id`: si el envío anterior sí llegó, el servidor lo devuelve. Una nota de voz
      // se reenvía con la grabación que se conservó.
      void transmit(clientId, target.content, target.localAudio);
    },
    [apply, transmit],
  );

  const discard = useCallback(
    (clientId: string) => {
      const target = messagesRef.current.find((m) => m.local && m.client_id === clientId);
      if (target?.localAudio) deleteVoiceFile(target.localAudio.uri);
      apply(removeLocal(messagesRef.current, clientId));
    },
    [apply],
  );

  const edit = useCallback(
    async (messageId: string, text: string) => {
      const updated: ChatMessage = await editMessage(messageId, text.trim());
      apply(mergeMessages(messagesRef.current, [updated]));
    },
    [apply],
  );

  const remove = useCallback(
    async (messageId: string) => {
      await deleteMessage(messageId);
      apply(messagesRef.current.filter((m) => m.id !== messageId));
    },
    [apply],
  );

  return {
    messages,
    state,
    error,
    hasOlder,
    loadingOlder,
    offline,
    reload,
    loadOlder,
    send,
    sendVoice,
    retry,
    discard,
    edit,
    remove,
  };
}
