/**
 * Lógica PURA del historial de un chat: combinar páginas, ordenar, deduplicar y
 * reconciliar los mensajes que todavía no confirmó el servidor. Sin React ni red,
 * para poder probarla de forma aislada (`chatState.test.ts`).
 *
 * Los cursores de paginación son INSTANTES (`created_at`), no ids, y son
 * inclusivos (ADR-035): el servidor puede devolver otra vez el mensaje del
 * cursor, y aquí se descarta por `id`.
 */

import type { ChatMessage } from './api';
import type { VoiceRecording } from './voice';

import type { PickedMedia } from '@shared/media/mediaRules';

/** Un mensaje del chat: confirmado por el servidor o todavía local. */
export type LocalMessage = ChatMessage & {
  /** `sending`: en vuelo. `failed`: no se pudo enviar (se puede reintentar). */
  local?: 'sending' | 'failed';
  /** Solo en un mensaje local de voz: la grabación, para poder reintentar el envío (ADR-042). */
  localAudio?: VoiceRecording;
  /** Solo en un mensaje local con foto o video: el archivo elegido, para poder reintentar el envío. */
  localMedia?: PickedMedia;
};

export function isPending(message: LocalMessage): boolean {
  return message.local !== undefined;
}

/** Id provisional de un mensaje aún sin confirmar. */
export function localId(clientId: string): string {
  return `local:${clientId}`;
}

function byTime(a: LocalMessage, b: LocalMessage): number {
  const delta = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (delta !== 0) return delta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Une `incoming` con `current`: sin duplicados por `id`, y un mensaje confirmado
 * reemplaza al local que tenía su mismo `client_id` (así el mensaje que acabamos
 * de enviar no aparece dos veces cuando el servidor lo devuelve en una consulta
 * antes de que termine la respuesta del envío).
 */
export function mergeMessages(
  current: LocalMessage[],
  incoming: ChatMessage[],
): LocalMessage[] {
  const confirmedClientIds = new Set(
    incoming.map((m) => m.client_id).filter((id): id is string => id !== null),
  );

  // Se descartan los locales que el servidor ya confirmó.
  const kept = current.filter(
    (m) => !(m.local && m.client_id !== null && confirmedClientIds.has(m.client_id)),
  );

  const byId = new Map<string, LocalMessage>();
  for (const message of kept) byId.set(message.id, message);
  // Lo que viene del servidor manda sobre la copia local con el mismo id
  // (por ejemplo, el estado de lectura o una edición).
  for (const message of incoming) byId.set(message.id, message);

  return [...byId.values()].sort(byTime);
}

/** Instante del mensaje confirmado más reciente, o `undefined` si no hay ninguno. */
export function latestConfirmedAt(messages: LocalMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (!isPending(messages[index])) return messages[index].created_at;
  }
  return undefined;
}

/** Instante del mensaje confirmado más antiguo, o `undefined` si no hay ninguno. */
export function oldestConfirmedAt(messages: LocalMessage[]): string | undefined {
  const first = messages.find((m) => !isPending(m));
  return first?.created_at;
}

/** Mensaje local para mostrar al instante mientras viaja al servidor. */
export function makePending(
  clientId: string,
  senderId: string,
  recipientId: string | null,
  content: string,
  now: Date = new Date(),
): LocalMessage {
  return {
    id: localId(clientId),
    sender_id: senderId,
    recipient_id: recipientId,
    content,
    read: false,
    created_at: now.toISOString(),
    edited: false,
    client_id: clientId,
    local: 'sending',
  };
}

/**
 * Mensaje local de una nota de voz (ADR-042). Mientras no hay URL del servidor, la nota se
 * reproduce desde el archivo local; `localAudio` conserva la grabación para el reintento.
 */
export function makePendingVoice(
  clientId: string,
  senderId: string,
  recipientId: string | null,
  recording: VoiceRecording,
  content: string,
  now: Date = new Date(),
): LocalMessage {
  return {
    ...makePending(clientId, senderId, recipientId, content, now),
    audio: { url: recording.uri, duration_ms: recording.durationMs },
    localAudio: recording,
  };
}

/**
 * Mensaje local con una foto o un video (ADR-046). La foto se muestra ya desde el archivo del teléfono;
 * el video, como un recuadro «Enviando» (no hay miniatura hasta que el servidor lo procese).
 */
export function makePendingMedia(
  clientId: string,
  senderId: string,
  recipientId: string | null,
  media: PickedMedia,
  content: string,
  now: Date = new Date(),
): LocalMessage {
  const base = makePending(clientId, senderId, recipientId, content, now);
  return media.kind === 'image'
    ? { ...base, images: [{ url: media.uri, width: media.width, height: media.height }], localMedia: media }
    : { ...base, localMedia: media };
}

/** Marca un mensaje local como fallido (o de nuevo en vuelo). */
export function setLocalState(
  messages: LocalMessage[],
  clientId: string,
  state: 'sending' | 'failed',
): LocalMessage[] {
  return messages.map((m) => (m.local && m.client_id === clientId ? { ...m, local: state } : m));
}

export function removeLocal(messages: LocalMessage[], clientId: string): LocalMessage[] {
  return messages.filter((m) => !(m.local && m.client_id === clientId));
}

/**
 * Intervalo hasta la próxima consulta. Arranca corto y se alarga mientras el chat
 * está en silencio; vuelve a empezar al llegar algo. Tras errores se alarga más
 * (retroceso exponencial) para no martillar a un servidor o una red caídos.
 */
export function nextPollDelayMs(idlePolls: number, failures: number): number {
  const BASE = 3000;
  const IDLE_MAX = 12000;
  const FAILURE_MAX = 30000;

  if (failures > 0) return Math.min(BASE * 2 ** failures, FAILURE_MAX);
  return Math.min(BASE + idlePolls * 1500, IDLE_MAX);
}
