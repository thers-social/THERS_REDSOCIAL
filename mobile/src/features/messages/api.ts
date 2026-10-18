/**
 * Mensajes directos entre dos personas (`API_CONTRACT.md` §4.10, `ADR-013`/`ADR-014`
 * y `ADR-035-chat-sync.md` para la paginación y la idempotencia).
 *
 * Es chat privado de texto. Hoy se sincroniza **por consultas periódicas**
 * (polling) mientras la pantalla está activa, no por una conexión en tiempo
 * real: ver `ADR-035` para la evaluación del transporte. Los mensajes no están
 * cifrados de extremo a extremo.
 */

import type { SharedPlace } from '@features/places/types';
import { File } from 'expo-file-system';

import { request } from '@shared/lib/api';

import type { VoiceRecording } from './voice';

export type ChatMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  read: boolean;
  created_at: string;
  edited: boolean;
  /**
   * Identificador que eligió quien envió, para que reintentar un envío que
   * falló a medias no cree el mensaje dos veces. `null` en mensajes enviados
   * por clientes que no lo mandan (la web actual).
   */
  client_id: string | null;
  /** Lugar compartido (ADR-040 fase 4c); `null` o ausente en un mensaje normal. */
  place?: SharedPlace | null;
  /**
   * Nota de voz (ADR-042); `null` o ausente en un mensaje normal. `duration_ms` la calcula el
   * servidor. En un mensaje local aún sin confirmar, `url` es el archivo del teléfono.
   */
  audio?: { url: string; duration_ms: number } | null;
};

export type ThreadPage = {
  messages: ChatMessage[];
  /** Hay mensajes más antiguos que los devueltos. Solo viene en la carga inicial y con `before`. */
  has_more?: boolean;
};

export type ConversationSummary = {
  user: {
    id: string;
    username: string;
    name: string;
    avatar_url: string | null;
    last_seen_at: string | null;
  };
  last_message: {
    content: string;
    has_place?: boolean;
    /** Nota de voz (ADR-042): un mensaje solo de audio trae `content: ""`. */
    has_audio?: boolean;
    sender_id: string;
    created_at: string;
  };
  unread_count: number;
};

export const PAGE_SIZE = 30;
export const MAX_MESSAGE_LENGTH = 2000;

export async function fetchConversations(signal?: AbortSignal): Promise<ConversationSummary[]> {
  const { conversations } = await request<{ conversations: ConversationSummary[] }>(
    '/conversations',
    { authenticated: true, signal },
  );
  return conversations;
}

type ThreadQuery = {
  /** Mensajes anteriores a este id (historial hacia atrás). */
  before?: string;
  /** Mensajes posteriores a este id (recuperación tras perder conexión). */
  after?: string;
  limit?: number;
};

export function fetchThread(
  otherUserId: string,
  query: ThreadQuery = {},
  signal?: AbortSignal,
): Promise<ThreadPage> {
  const params: string[] = [];
  if (query.before) params.push(`before=${encodeURIComponent(query.before)}`);
  if (query.after) params.push(`after=${encodeURIComponent(query.after)}`);
  params.push(`limit=${query.limit ?? PAGE_SIZE}`);

  return request<ThreadPage>(`/users/${otherUserId}/messages?${params.join('&')}`, {
    authenticated: true,
    signal,
  });
}

/**
 * Envía un mensaje. `clientId` hace el envío idempotente: repetir la petición con
 * el mismo `clientId` devuelve el mensaje ya creado (200) en vez de duplicarlo.
 */
export async function sendMessage(
  otherUserId: string,
  content: string,
  clientId: string,
): Promise<ChatMessage> {
  const { message } = await request<{ message: ChatMessage }>(`/users/${otherUserId}/messages`, {
    method: 'POST',
    authenticated: true,
    body: { content, client_id: clientId },
  });
  return message;
}

/** Subir 1 MiB por datos móviles puede tardar: más que el tiempo por defecto de `request()`. */
const VOICE_UPLOAD_TIMEOUT_MS = 60000;

/**
 * Envía una nota de voz (`ADR-042`): multipart con el campo `audio`. El servidor decodifica, normaliza
 * y calcula la duración; aquí no se manda ninguna. `clientId` hace el envío idempotente igual que en
 * un mensaje de texto: reintentar con el mismo devuelve el mensaje ya creado.
 */
export async function sendVoiceMessage(
  otherUserId: string,
  recording: VoiceRecording,
  clientId: string,
  content = '',
): Promise<ChatMessage> {
  const form = new FormData();
  form.append('content', content);
  form.append('client_id', clientId);
  // OJO: el `fetch` de Expo SDK 57 NO acepta el formato clásico de React Native `{uri, name, type}`
  // (falla con «Unsupported FormDataPart implementation» y la app lo ve como falta de red). El
  // archivo se sube como un `File` de expo-file-system, que es un Blob de verdad.
  form.append('audio', new File(recording.uri) as unknown as Blob, recording.name);

  const { message } = await request<{ message: ChatMessage }>(`/users/${otherUserId}/messages`, {
    method: 'POST',
    authenticated: true,
    body: form,
    timeoutMs: VOICE_UPLOAD_TIMEOUT_MS,
  });
  return message;
}

export async function editMessage(messageId: string, content: string): Promise<ChatMessage> {
  const { message } = await request<{ message: ChatMessage }>(`/messages/${messageId}`, {
    method: 'PATCH',
    authenticated: true,
    body: { content },
  });
  return message;
}

export function deleteMessage(messageId: string): Promise<unknown> {
  return request(`/messages/${messageId}`, { method: 'DELETE', authenticated: true });
}

/** Id de cliente para un envío. Único por remitente, que es como lo comprueba el servidor. */
export function newClientId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
