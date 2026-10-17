/**
 * Lógica PURA del chat de Tero: validar lo que se envía, armar mensajes y la
 * respuesta de ejemplo de la fase 1. Sin React ni red (`tests/teroChat.test.mjs`).
 *
 * Fase 1: NO hay IA. `mockReply` devuelve textos fijos y lo dice; nunca simula
 * saber algo que no sabe. La fase 3 reemplaza el cliente (`teroClient.ts`), no
 * esta validación.
 */

import type { TeroContext, TeroMessage, TeroMessageStatus, TeroReply } from '../types';

/** Mismo límite que tendrá el servidor (a confirmar en ADR-041). */
export const MAX_TERO_MESSAGE_LENGTH = 1000;

export type MessageCheck = { ok: true; text: string } | { ok: false; error: string };

export function checkMessage(input: string): MessageCheck {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Escribe una pregunta para Tero.' };
  if (text.length > MAX_TERO_MESSAGE_LENGTH) {
    return { ok: false, error: `Máximo ${MAX_TERO_MESSAGE_LENGTH} caracteres.` };
  }
  return { ok: true, text };
}

let sequence = 0;

export function makeMessage(
  role: TeroMessage['role'],
  text: string,
  now: Date = new Date(),
  isMock = false,
): TeroMessage {
  sequence += 1;
  return { id: `tero:${now.getTime()}:${sequence}`, role, text, createdAt: now.toISOString(), isMock };
}

/** Cambia el estado de un mensaje de la persona sin tocar los demás. */
export function withStatus(
  messages: TeroMessage[],
  id: string,
  status: TeroMessageStatus,
): TeroMessage[] {
  return messages.map((message) => (message.id === id ? { ...message, status } : message));
}

/** Texto bajo un mensaje propio según su estado. */
export function statusLabel(status: TeroMessageStatus | undefined): string | null {
  if (status === 'sending') return 'Enviando…';
  if (status === 'sent') return 'Enviado';
  if (status === 'failed') return 'No se pudo enviar';
  return null;
}

/** Primeras palabras de un texto, cortadas en un límite de palabra. */
export function excerpt(text: string, maxLength = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const MOCK_NOTICE = 'Todavía no estoy conectado a la IA: esta es una respuesta de ejemplo.';

/**
 * Respuesta de ejemplo. Si la pregunta viene de una publicación y se conoce su
 * texto (ya cargado en el feed), el "resumen" es un extracto literal: no se
 * inventa contenido.
 */
export function mockReply(
  text: string,
  context: TeroContext,
  postContent?: string | null,
): TeroReply {
  if (context.entityType === 'post') {
    if (postContent) {
      return {
        mood: 'speaking',
        isMock: true,
        text: `${MOCK_NOTICE}\n\nDe momento solo puedo mostrarte el inicio de la publicación:\n«${excerpt(postContent)}»`,
      };
    }
    return {
      mood: 'error',
      isMock: true,
      text: `${MOCK_NOTICE}\n\nNo encuentro esa publicación entre las que ya cargó tu inicio.`,
    };
  }

  const lower = text.toLowerCase();
  if (/\b(hola|buenas|hey)\b/.test(lower)) {
    return { mood: 'happy', isMock: true, text: `¡Hola! Soy Tero. ${MOCK_NOTICE}` };
  }
  if (lower.includes('resumen') || lower.includes('resume')) {
    return {
      mood: 'speaking',
      isMock: true,
      text: `${MOCK_NOTICE}\n\nPronto podré resumir tu actividad. Mientras tanto, abre «Resumen» para ver una vista previa.`,
    };
  }
  return {
    mood: 'speaking',
    isMock: true,
    text: `${MOCK_NOTICE}\n\nCuando me conecten podré responder sobre tu perfil, tus avisos y lo que pasa en THERS.`,
  };
}
