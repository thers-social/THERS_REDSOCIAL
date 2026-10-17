/**
 * Cliente de Tero. La fase 1 solo tiene la implementación de ejemplo; la fase 3
 * agrega otra que llama a `POST /api/tero/chat` con `request()` de
 * `@shared/lib/api` (mismo timeout, renovación de sesión y errores `{"msg"}`),
 * sin que las pantallas cambien.
 */

import { mockReply } from './teroChat';
import { mockSummary } from './mocks';
import type { TeroContext, TeroReply, TeroSummary } from '../types';

export interface TeroClient {
  send(
    text: string,
    context: TeroContext,
    options?: { postContent?: string | null; signal?: AbortSignal },
  ): Promise<TeroReply>;
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
  async summary(signal) {
    await wait(400, signal);
    return mockSummary;
  },
};

export const teroClient: TeroClient = mockTeroClient;
