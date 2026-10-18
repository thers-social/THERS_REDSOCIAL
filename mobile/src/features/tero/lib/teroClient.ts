/**
 * Cliente de Tero. Hay dos implementaciones con la misma interfaz, para que las pantallas no
 * cambien:
 *  - `mockTeroClient`: respuestas de ejemplo de la fase 1, sin red ni IA.
 *  - `liveTeroClient`: llama al servidor (`POST /api/tero/chat` y las acciones de `ADR-041`) con
 *    `request()` de `@shared/lib/api`: mismo renovado de sesión y errores `{"msg"}`.
 *
 * La elige `EXPO_PUBLIC_TERO_LIVE` (apagada por defecto).
 */

import { request } from '@shared/lib/api';

import { TERO_LIVE } from '../config';
import { mockSummary } from './mocks';
import { chatBody, parseChatResponse, type ChatTurn } from './teroCards';
import { mockReply } from './teroChat';
import type { TeroContext, TeroReply, TeroSummary } from '../types';

export type SendOptions = {
  postContent?: string | null;
  /** Conversación previa; el servidor no guarda historial. */
  history?: ChatTurn[];
  /** Imagen adjunta (ADR-046), ya reducida y en base64. Solo la usa el cliente real. */
  image?: { media_type: string; data: string } | null;
  signal?: AbortSignal;
};

export interface TeroClient {
  send(text: string, context: TeroContext, options?: SendOptions): Promise<TeroReply>;
  /** Ejecuta una acción que Tero preparó. Solo la llama la persona, al pulsar «Confirmar». */
  confirmAction(actionId: string, signal?: AbortSignal): Promise<unknown>;
  cancelAction(actionId: string, signal?: AbortSignal): Promise<unknown>;
  summary(signal?: AbortSignal): Promise<TeroSummary>;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new Error('aborted'));
    });
  });
}

/** Simula la latencia de una red real para poder ver el estado «pensando». */
export const mockTeroClient: TeroClient = {
  async send(text, context, options) {
    await wait(700, options?.signal);
    return mockReply(text, context, options?.postContent);
  },
  // Las respuestas de ejemplo nunca traen tarjetas: no hay nada que confirmar ni cancelar.
  async confirmAction() {
    throw new Error('Sin acciones en la vista previa');
  },
  async cancelAction() {
    throw new Error('Sin acciones en la vista previa');
  },
  async summary(signal) {
    await wait(400, signal);
    return mockSummary;
  },
};

/**
 * Una respuesta con herramientas puede encadenar hasta 3 vueltas al modelo (unos 5 a 15 s). El
 * tiempo por defecto de `request()` (15 s) se queda corto; el servidor ya limita cada vuelta.
 */
const CHAT_TIMEOUT_MS = 60000;

export const liveTeroClient: TeroClient = {
  async send(text, context, options) {
    const payload = await request<unknown>('/tero/chat', {
      method: 'POST',
      authenticated: true,
      body: chatBody(text, context, options?.history ?? [], options?.image ?? null),
      timeoutMs: CHAT_TIMEOUT_MS,
      signal: options?.signal,
    });
    return parseChatResponse(payload);
  },
  confirmAction(actionId, signal) {
    // El cuerpo va vacío a propósito: el servidor identifica a la persona por la sesión.
    return request<unknown>(`/tero/actions/${encodeURIComponent(actionId)}/confirm`, {
      method: 'POST',
      authenticated: true,
      signal,
    });
  },
  cancelAction(actionId, signal) {
    return request<unknown>(`/tero/actions/${encodeURIComponent(actionId)}/cancel`, {
      method: 'POST',
      authenticated: true,
      signal,
    });
  },
  // El resumen de actividad sigue siendo de ejemplo: no hay endpoint todavía.
  summary: mockTeroClient.summary,
};

export const teroClient: TeroClient = TERO_LIVE ? liveTeroClient : mockTeroClient;
