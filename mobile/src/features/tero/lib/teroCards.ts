/**
 * Lógica PURA de la conexión de Tero con el servidor y de las tarjetas de confirmación
 * (ADR-041, fases 4 a 6). Sin React ni red: se prueba con `tests/teroCards.test.mjs`.
 *
 * Reglas que esto hace cumplir en el cliente:
 *  - Tero solo PREPARA acciones. Una tarjeta no es un hecho: hasta que la persona pulsa
 *    «Confirmar» no ha pasado nada, y la pantalla lo dice.
 *  - Lo que se muestra en la tarjeta (`summary`) es lo que el servidor redactó. El cliente no
 *    compone ni reinterpreta el texto de una acción.
 *  - Todo lo que llega del servidor se trata como dato: se valida su forma antes de usarlo.
 */

import type {
  TeroActionCard,
  TeroActionKind,
  TeroCardState,
  TeroContext,
  TeroMessage,
  TeroMood,
  TeroReply,
  TeroReplySource,
} from '../types';

/** Mismos topes que el servidor (`domain/tero/chat.py`): un mensaje fuera de ellos se rechaza. */
export const MAX_HISTORY_TURNS = 10;
const MAX_TURN_LENGTH = 1000;

const ACTION_KINDS: readonly TeroActionKind[] = ['follow_user', 'unfollow_user', 'update_profile'];
const SOURCES: readonly TeroReplySource[] = ['ai', 'disabled', 'budget', 'refused'];

// --- Lo que se envía ------------------------------------------------------

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/**
 * Conversación previa para el servidor, que NO guarda historial (ADR-041 §5.2): lo manda el
 * cliente en cada petición. Solo cuentan los mensajes entregados anteriores a `beforeId`; los de
 * ejemplo, los que fallaron y los que siguen en camino no. Se recorta cada turno al tope del
 * servidor y se descartan los turnos iniciales de Tero, porque la lista debe empezar con la
 * persona.
 */
export function historyForRequest(messages: TeroMessage[], beforeId: string): ChatTurn[] {
  const index = messages.findIndex((message) => message.id === beforeId);
  const earlier = index === -1 ? messages : messages.slice(0, index);

  const turns: ChatTurn[] = [];
  for (const message of earlier) {
    if (message.isMock) continue;
    if (message.role === 'user' && message.status !== 'sent') continue;
    const content = message.text.trim().slice(0, MAX_TURN_LENGTH);
    if (!content) continue;
    turns.push({ role: message.role === 'user' ? 'user' : 'assistant', content });
  }

  const recent = turns.slice(-MAX_HISTORY_TURNS);
  const firstUser = recent.findIndex((turn) => turn.role === 'user');
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

/** Cuerpo de `POST /api/tero/chat`. El contexto va como dato sin verificar. */
export function chatBody(text: string, context: TeroContext, history: ChatTurn[]) {
  const body: {
    message: string;
    history?: ChatTurn[];
    context: { screen: string; entity_type?: string; entity_id?: string };
  } = { message: text, context: { screen: context.screen } };
  if (history.length) body.history = history;
  if (context.entityType && context.entityId) {
    body.context.entity_type = context.entityType;
    body.context.entity_id = context.entityId;
  }
  return body;
}

// --- Lo que se recibe -----------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tarjetas válidas de la respuesta; descarta en silencio las que no tienen la forma esperada. */
export function parseCards(raw: unknown): TeroActionCard[] {
  if (!Array.isArray(raw)) return [];
  const cards: TeroActionCard[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { id, kind, summary, expires_at: expiresAt } = item;
    if (typeof id !== 'string' || !id) continue;
    if (typeof kind !== 'string' || !ACTION_KINDS.includes(kind as TeroActionKind)) continue;
    if (typeof summary !== 'string' || !summary.trim()) continue;
    if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) continue;
    cards.push({ id, kind: kind as TeroActionKind, summary, expiresAt });
  }
  return cards;
}

function moodFor(source: TeroReplySource): TeroMood {
  if (source === 'disabled' || source === 'budget') return 'sleeping';
  return 'speaking';
}

/** Respuesta del servidor -> `TeroReply`. Lanza si no trae un texto, para que cuente como fallo. */
export function parseChatResponse(payload: unknown): TeroReply {
  if (!isRecord(payload) || typeof payload.reply !== 'string' || !payload.reply.trim()) {
    throw new Error('Respuesta de Tero inválida');
  }
  const source: TeroReplySource = SOURCES.includes(payload.source as TeroReplySource)
    ? (payload.source as TeroReplySource)
    : 'ai';
  return {
    text: payload.reply,
    mood: moodFor(source),
    isMock: false,
    source,
    cards: parseCards(payload.confirmation_cards),
  };
}

// --- Estado de una tarjeta ------------------------------------------------

export function isCardExpired(card: TeroActionCard, now: number = Date.now()): boolean {
  return now >= Date.parse(card.expiresAt);
}

export const EXPIRED_NOTE = 'Venció. Pídele a Tero que la prepare de nuevo.';

export function initialCardState(card: TeroActionCard, now: number = Date.now()): TeroCardState {
  return isCardExpired(card, now) ? { status: 'expired', note: EXPIRED_NOTE } : { status: 'pending' };
}

/** `true` solo si los botones deben estar activos. */
export function canAct(state: TeroCardState, card: TeroActionCard, now: number = Date.now()): boolean {
  return state.status === 'pending' && !isCardExpired(card, now);
}

type ErrorLike = { status?: unknown; isNetworkError?: unknown; body?: unknown };

function errorCode(error: ErrorLike): string | null {
  const body = error.body;
  return isRecord(body) && typeof body.code === 'string' ? body.code : null;
}

/**
 * Cómo queda la tarjeta tras un error de `confirm`/`cancel`. Los errores que se pueden reintentar
 * (sin red, límite de intentos) la dejan en `pending`; los demás son definitivos.
 */
export function cardStateFromError(error: unknown): TeroCardState {
  const e: ErrorLike = isRecord(error) ? error : {};
  const status = typeof e.status === 'number' ? e.status : 0;
  const code = errorCode(e);

  if (e.isNetworkError === true || status === 0) {
    return { status: 'pending', note: 'Sin conexión. Inténtalo de nuevo.' };
  }
  if (status === 429) return { status: 'pending', note: 'Demasiados intentos. Espera un momento.' };
  if (status === 404) return { status: 'unavailable', note: 'Esta acción ya no existe.' };
  if (status === 409) {
    if (code === 'action_expired') return { status: 'expired', note: EXPIRED_NOTE };
    if (code === 'action_cancelled') return { status: 'cancelled', note: 'Ya estaba cancelada.' };
    if (code === 'action_confirmed') return { status: 'confirmed', note: 'Ya estaba confirmada.' };
    return { status: 'failed', note: 'No se pudo completar la acción.' };
  }
  if (status === 503) {
    return { status: 'unavailable', note: 'Las acciones de Tero no están disponibles ahora.' };
  }
  return { status: 'pending', note: 'No se pudo completar. Inténtalo de nuevo.' };
}

/** Texto de éxito tras confirmar, según lo que devolvió el servidor. */
export function confirmedNote(payload: unknown): string {
  if (!isRecord(payload)) return 'Listo.';
  if (payload.already_confirmed === true) return 'Ya estaba confirmada.';
  const result = isRecord(payload.result) ? payload.result : {};
  if (Array.isArray(result.updated)) return 'Listo, tu perfil se actualizó.';
  if ('follow_status' in result) {
    if (result.follow_status === 'pending') return 'Listo, enviaste la solicitud.';
    if (result.follow_status === 'accepted') return 'Listo, ahora lo sigues.';
    return 'Listo, ya no lo sigues.';
  }
  return 'Listo.';
}

// --- Errores del chat -----------------------------------------------------

/** Mensaje para la persona cuando el chat falla. Nunca el texto técnico del servidor. */
export function chatErrorMessage(error: unknown): string {
  const e: ErrorLike = isRecord(error) ? error : {};
  const status = typeof e.status === 'number' ? e.status : 0;
  const code = errorCode(e);

  if (e.isNetworkError === true) return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
  if (status === 429) return 'Estás enviando muchos mensajes. Espera un momento.';
  if (status === 503 && code === 'tero_disabled') return 'Tero no está disponible en este momento.';
  if (status === 503) return 'Tero no está disponible ahora. Inténtalo más tarde.';
  if (status === 400) return 'Tero no pudo entender el mensaje. Prueba con otro texto.';
  return 'Tero no pudo responder. Puedes reintentar.';
}

/** `true` si reintentar el mismo mensaje tiene sentido (falló la red o el servidor, no el texto). */
export function isRetryable(error: unknown): boolean {
  const e: ErrorLike = isRecord(error) ? error : {};
  const status = typeof e.status === 'number' ? e.status : 0;
  return e.isNetworkError === true || status === 0 || status === 429 || status >= 500;
}
