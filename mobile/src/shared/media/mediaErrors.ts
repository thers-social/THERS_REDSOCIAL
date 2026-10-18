/**
 * Mensajes de error de las subidas de fotos y videos (ADR-046). El servidor responde con un código
 * propio cuando una función está apagada; el resto de los errores ya trae un texto legible en `msg`.
 */

import { ApiError } from '@shared/lib/api';

/** Texto para los rechazos que tienen su propio mensaje, o `null` para usar el del servidor. */
export function mediaSendErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const code = (error.body as { code?: unknown } | undefined)?.code;
  if (code === 'video_disabled') return 'Los videos no están disponibles ahora.';
  if (error.status === 413) return 'El archivo pesa demasiado: 5 MB para una foto y 25 MB para un video.';
  return null;
}
