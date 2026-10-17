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
import { request } from '@shared/lib/api';

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
  last_message: { content: string; has_place?: boolean; sender_id: string; created_at: string };
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
