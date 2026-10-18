// Lógica PURA de Tero en la web (ADR-041): sin React ni red, para probarla con
// `node --test` (tests/tero.test.mjs). Es el equivalente de
// mobile/src/features/tero/lib/teroCards.ts y conserva SUS reglas:
//
//  · Tero solo PREPARA acciones. Una tarjeta no es un hecho: hasta que la
//    persona pulsa «Confirmar» no ha pasado nada, y la pantalla lo dice.
//  · Lo que se muestra en la tarjeta (`summary`) lo redactó el servidor. El
//    cliente no lo compone ni lo reinterpreta.
//  · Todo lo que llega del servidor se trata como dato: se valida su forma.
//  · Los textos para la persona NO se escriben aquí: esta capa devuelve claves
//    (`kind`, `status`) y la interfaz las traduce con `t()`.

// Mismos topes que el servidor (backend/app/domain/tero/chat.py).
export const MAX_HISTORY_TURNS = 10;
export const MAX_MESSAGE_LENGTH = 1000;
const MAX_NOTE_SUMMARY = 80;

const ACTION_KINDS = ["follow_user", "unfollow_user", "update_profile"];
const SOURCES = ["ai", "disabled", "budget", "refused"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Mensaje de la persona ------------------------------------------------

/** Valida lo que se escribió. `error` es una clave: "empty" o "tooLong". */
export function checkMessage(input) {
  const text = String(input ?? "").trim();
  if (!text) return { ok: false, error: "empty" };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, error: "tooLong" };
  return { ok: true, text };
}

let sequence = 0;

/** Mensaje de la conversación. Los de la persona nacen "sending". */
export function makeMessage(role, text, now = new Date()) {
  sequence += 1;
  const message = { id: `tero-${now.getTime()}-${sequence}`, role, text, createdAt: now.toISOString() };
  if (role === "user") message.status = "sending";
  return message;
}

export function withStatus(messages, id, status) {
  return messages.map((m) => (m.id === id ? { ...m, status } : m));
}

// --- Lo que se envía --------------------------------------------------------

// Qué le pasó a cada tarjeta, dicho para el MODELO (no para la persona): el
// servidor no guarda historial y, sin esto, el modelo vuelve a proponer o
// «corrige» una acción que la persona ya resolvió.
const CARD_OUTCOME = {
  pending: "sigue pendiente: la persona todavía no la confirma",
  confirming: "la persona la está confirmando",
  cancelling: "la persona la está cancelando",
  confirmed: "la persona la confirmó y YA SE HIZO",
  cancelled: "la persona la canceló; no se hizo nada",
  expired: "venció sin confirmarse; no se hizo nada",
  failed: "se intentó pero no se pudo completar",
  unavailable: "ya no estaba disponible; no se hizo nada",
};

export function isCardExpired(card, now = Date.now()) {
  return now >= Date.parse(card.expiresAt);
}

export function cardOutcomeNote(card, state) {
  const status = state?.status ?? (isCardExpired(card) ? "expired" : "pending");
  const summary =
    card.summary.length > MAX_NOTE_SUMMARY ? `${card.summary.slice(0, MAX_NOTE_SUMMARY)}…` : card.summary;
  return `[Tarjeta «${summary}»: ${CARD_OUTCOME[status]}]`;
}

/**
 * Conversación previa para el servidor. Solo cuentan los mensajes entregados
 * anteriores a `beforeId`; los que fallaron o siguen en camino no. Cada turno se
 * recorta al tope del servidor y la lista debe empezar con la persona.
 */
export function historyForRequest(messages, beforeId, cardStates = {}) {
  const index = messages.findIndex((m) => m.id === beforeId);
  const earlier = index === -1 ? messages : messages.slice(0, index);

  const turns = [];
  for (const message of earlier) {
    if (message.role === "user" && message.status !== "sent") continue;

    let content = message.text.trim();
    if (message.role === "tero" && message.cards?.length) {
      const notes = message.cards.map((card) => cardOutcomeNote(card, cardStates[card.id])).join("\n");
      const room = Math.max(0, MAX_MESSAGE_LENGTH - notes.length - 1);
      content = `${content.slice(0, room).trimEnd()}\n${notes}`.trim();
    }
    content = content.slice(0, MAX_MESSAGE_LENGTH);
    if (!content) continue;
    turns.push({ role: message.role === "user" ? "user" : "assistant", content });
  }

  const recent = turns.slice(-MAX_HISTORY_TURNS);
  const firstUser = recent.findIndex((turn) => turn.role === "user");
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

/**
 * Nombre de pantalla para el contexto, a partir de la ruta. El servidor acepta
 * `[a-z0-9_/-]{1,40}` y lo trata como dato sin verificar; aquí solo se usa el primer
 * segmento, nunca ids ni parámetros de la URL.
 */
export function screenFor(pathname) {
  const first = String(pathname ?? "").split("/").filter(Boolean)[0] ?? "";
  const clean = first.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return clean || "home";
}

/** Cuerpo de `POST /api/tero/chat`. El contexto va como dato sin verificar. */
export function chatBody(text, context, history) {
  const body = { message: text, context: { screen: context?.screen ?? "home" } };
  if (history.length) body.history = history;
  if (context?.entityType && context?.entityId) {
    body.context.entity_type = context.entityType;
    body.context.entity_id = context.entityId;
  }
  return body;
}

// --- Lo que se recibe ---------------------------------------------------------

/** Tarjetas válidas de la respuesta; descarta en silencio las que no tienen la forma esperada. */
export function parseCards(raw) {
  if (!Array.isArray(raw)) return [];
  const cards = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { id, kind, summary, expires_at: expiresAt } = item;
    if (typeof id !== "string" || !id) continue;
    if (typeof kind !== "string" || !ACTION_KINDS.includes(kind)) continue;
    if (typeof summary !== "string" || !summary.trim()) continue;
    if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) continue;
    cards.push({ id, kind, summary, expiresAt });
  }
  return cards;
}

/**
 * Quita el formato Markdown que el modelo a veces escribe aunque se le pida
 * texto plano: la interfaz muestra el texto tal cual y se verían los asteriscos.
 */
export function plainText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^(\s*)\*\s+/gm, "$1- ");
}

/** Respuesta del servidor -> respuesta de Tero. Lanza si no trae texto, para que cuente como fallo. */
export function parseChatResponse(payload) {
  if (!isRecord(payload) || typeof payload.reply !== "string" || !payload.reply.trim()) {
    throw new Error("Respuesta de Tero inválida");
  }
  const source = SOURCES.includes(payload.source) ? payload.source : "ai";
  return {
    text: plainText(payload.reply),
    mood: source === "disabled" || source === "budget" ? "sleeping" : "speaking",
    source,
    cards: parseCards(payload.confirmation_cards),
  };
}

// --- Estado de una tarjeta ---------------------------------------------------------

export function initialCardState(card, now = Date.now()) {
  return isCardExpired(card, now) ? { status: "expired", note: "expired" } : { status: "pending" };
}

/** `true` solo si los botones deben estar activos. */
export function canAct(state, card, now = Date.now()) {
  return state.status === "pending" && !isCardExpired(card, now);
}

/** Normaliza un error de axios a la forma que usa esta capa. */
export function normalizeError(error) {
  const status = error?.response?.status;
  return {
    status: typeof status === "number" ? status : 0,
    isNetworkError: !error?.response,
    body: error?.response?.data,
  };
}

function errorCode(error) {
  return isRecord(error?.body) && typeof error.body.code === "string" ? error.body.code : null;
}

/**
 * Cómo queda la tarjeta tras un error de confirm/cancel. `note` es una clave de
 * traducción (`tero.card.notes.*`). Los errores que se pueden reintentar (sin
 * red, límite de intentos) la dejan en `pending`; los demás son definitivos.
 */
export function cardStateFromError(error) {
  const status = typeof error?.status === "number" ? error.status : 0;
  const code = errorCode(error);

  if (error?.isNetworkError === true || status === 0) return { status: "pending", note: "offline" };
  if (status === 429) return { status: "pending", note: "rateLimited" };
  if (status === 404) return { status: "unavailable", note: "gone" };
  if (status === 409) {
    if (code === "action_expired") return { status: "expired", note: "expired" };
    if (code === "action_cancelled") return { status: "cancelled", note: "alreadyCancelled" };
    if (code === "action_confirmed") return { status: "confirmed", note: "alreadyConfirmed" };
    return { status: "failed", note: "failed" };
  }
  if (status === 503) return { status: "unavailable", note: "unavailable" };
  return { status: "pending", note: "retry" };
}

/** Clave del texto de éxito tras confirmar, según lo que devolvió el servidor. */
export function confirmedNoteKey(payload) {
  if (!isRecord(payload)) return "done";
  if (payload.already_confirmed === true) return "alreadyConfirmed";
  const result = isRecord(payload.result) ? payload.result : {};
  if (Array.isArray(result.updated)) return "profileUpdated";
  if ("follow_status" in result) {
    if (result.follow_status === "pending") return "requestSent";
    if (result.follow_status === "accepted") return "nowFollowing";
    return "unfollowed";
  }
  return "done";
}

/** Cómo reacciona el avatar al desenlace de una tarjeta. */
export function moodForOutcome(status) {
  if (status === "confirmed") return "happy";
  if (status === "failed") return "error";
  return null;
}

// --- Errores del chat ----------------------------------------------------------------

/** Clave del mensaje para la persona cuando el chat falla. Nunca el texto técnico del servidor. */
export function chatErrorKind(error) {
  const status = typeof error?.status === "number" ? error.status : 0;
  const code = errorCode(error);

  if (error?.isNetworkError === true) return "offline";
  if (status === 429) return "rateLimited";
  if (status === 503 && code === "tero_disabled") return "disabled";
  if (status === 503) return "unavailable";
  if (status === 400) return "badRequest";
  return "generic";
}

/** `true` si reintentar el mismo mensaje tiene sentido (falló la red o el servidor, no el texto). */
export function isRetryable(error) {
  const status = typeof error?.status === "number" ? error.status : 0;
  return error?.isNetworkError === true || status === 0 || status === 429 || status >= 500;
}

/** Cuánto esperar antes de volver a dormir el avatar tras hablar. */
export const SETTLE_AFTER_MS = 2600;
