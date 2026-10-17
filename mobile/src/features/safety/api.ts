/**
 * Bloqueos y reportes.
 *
 * - Bloqueos: `API_CONTRACT.md` §4.14 (`ADR-029`). Implementado en `develop`.
 * - Reportes: `POST /api/reports` (`ADR-032`, fase 1). **Todavía no está en
 *   `develop`**: vive en la rama `feature/backend-terms-and-reports`, sin
 *   fusionar. Hasta que se fusione, el servidor responde `404` y la interfaz lo
 *   dice con honestidad en vez de fingir que el reporte se envió.
 */

import { ApiError, request } from '@shared/lib/api';

export type BlockedAccount = {
  user: { id: string; name: string; username: string };
  created_at: string;
};

export async function fetchBlocks(signal?: AbortSignal): Promise<BlockedAccount[]> {
  const { blocks } = await request<{ blocks: BlockedAccount[] }>('/users/me/blocks', {
    authenticated: true,
    signal,
  });
  return blocks;
}

export function blockUser(userId: string): Promise<unknown> {
  return request('/users/me/blocks', {
    method: 'POST',
    authenticated: true,
    body: { user_id: userId },
  });
}

export function unblockUser(userId: string): Promise<unknown> {
  return request(`/users/me/blocks/${userId}`, { method: 'DELETE', authenticated: true });
}

// --- Reportes ---------------------------------------------------------------

export type ReportTargetType = 'post' | 'comment' | 'message' | 'user' | 'review';

/** Mismos motivos que `REASONS` del backend (`domain/reports/kinds.py`). */
export const REPORT_REASONS = [
  // Primero y destacado: es la categoría con prioridad máxima (ADR-038). La prioridad la
  // decide el servidor; el cliente solo envía el motivo.
  { id: 'child_safety', label: 'Explotación o abuso de menores' },
  { id: 'spam', label: 'Spam o engaño' },
  { id: 'harassment', label: 'Acoso o amenazas' },
  { id: 'hate', label: 'Discurso de odio' },
  { id: 'sexual', label: 'Contenido sexual' },
  { id: 'violence', label: 'Violencia' },
  { id: 'self_harm', label: 'Autolesión' },
  { id: 'illegal', label: 'Actividad ilegal' },
  { id: 'impersonation', label: 'Suplantación de identidad' },
  { id: 'other', label: 'Otro motivo' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

export const MAX_REPORT_DETAILS = 500;

export type ReportOutcome = 'sent' | 'already_reported' | 'unavailable';

/** Lo que devuelve `sendReport`: el resultado y la prioridad que le asignó el SERVIDOR. */
export type ReportResult = { outcome: ReportOutcome; priority: 'normal' | 'critical' | null };

/**
 * Envía un reporte. Devuelve `unavailable` si el servidor todavía no tiene la
 * ruta (rama de reportes sin fusionar): es un hecho, no un error de la persona.
 */
export async function sendReport(input: {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
}): Promise<ReportResult> {
  try {
    const result = await request<{ report: { already_reported: boolean; priority?: 'normal' | 'critical' } }>('/reports', {
      method: 'POST',
      authenticated: true,
      body: {
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason,
        ...(input.details?.trim() ? { details: input.details.trim() } : {}),
      },
    });
    return {
      outcome: result.report?.already_reported ? 'already_reported' : 'sent',
      priority: result.report?.priority ?? null,
    };
  } catch (e) {
    // La ruta no existe en un servidor sin la fase 1 de ADR-032. Un 404 REAL de
    // "no encontramos lo que quieres reportar" trae su propio texto, así que se
    // distinguen por el mensaje del contrato, no solo por el código.
    if (e instanceof ApiError && e.status === 404 && !/reportar/i.test(e.message)) {
      return { outcome: 'unavailable', priority: null };
    }
    throw e;
  }
}
