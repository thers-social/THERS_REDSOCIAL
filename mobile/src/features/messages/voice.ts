/**
 * Lógica PURA de las notas de voz en la app (`ADR-042`). Sin React, sin red y sin módulos nativos,
 * para probarla aislada (`tests/voice.test.mjs`). Es el espejo de `Frontend/src/shared/lib/voice.js`.
 *
 * Los textos están en español: la app móvil no tiene i18n todavía (`TeroPreferences.language`).
 */

/** Mismos topes que el servidor (`backend/app/domain/media/audio.py`). */
export const MAX_VOICE_SECONDS = 120;
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;
/** Una grabación más corta se descarta: casi siempre es un toque accidental. */
export const MIN_VOICE_MS = 600;

/** Una grabación lista para enviar (o ya enviándose). */
export type VoiceRecording = {
  /** Archivo local (`file://…`). */
  uri: string;
  durationMs: number;
  mime: string;
  name: string;
};

/** `mm:ss` a partir de milisegundos. Nunca negativo ni NaN. */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Tipo MIME según la extensión del archivo que grabó el sistema (el servidor mira la cabecera). */
export function voiceMimeFor(uri: string): string {
  const extension = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'webm':
      return 'audio/webm';
    case '3gp':
    case '3gpp':
      return 'audio/3gpp';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    default:
      return 'audio/mp4'; // .m4a / .mp4 / .aac: el formato que graba la app
  }
}

/** Nombre del archivo a subir (el servidor no se fía de él). */
export function voiceFileName(uri: string): string {
  const extension = uri.split('?')[0].split('.').pop()?.toLowerCase();
  return `nota.${extension && /^[a-z0-9]{2,4}$/.test(extension) ? extension : 'm4a'}`;
}

export type RecordingProblem = 'tooShort' | 'tooBig';

/** ¿Vale la pena enviar esta grabación? `null` si sí. */
export function recordingProblem(input: { durationMs: number; size?: number | null }): RecordingProblem | null {
  if (!Number.isFinite(input.durationMs) || input.durationMs < MIN_VOICE_MS) return 'tooShort';
  if (typeof input.size === 'number' && input.size > MAX_VOICE_BYTES) return 'tooBig';
  return null;
}

export type VoiceErrorKind =
  | 'denied'
  | 'blocked'
  | 'busy'
  | 'tooShort'
  | 'tooBig'
  | 'disabled'
  | 'generic';

export const VOICE_MESSAGES: Record<VoiceErrorKind, string> = {
  denied: 'No tenemos permiso para usar el micrófono. Actívalo en los ajustes del teléfono.',
  blocked:
    'El permiso del micrófono está bloqueado. Actívalo en Ajustes > Aplicaciones > THERS > Permisos.',
  busy: 'El micrófono está ocupado por otra aplicación. Ciérrala e inténtalo de nuevo.',
  tooShort: 'La nota de voz es demasiado corta. Mantén la grabación un poco más.',
  tooBig: 'La nota de voz pesa demasiado. Graba una más corta.',
  disabled: 'Las notas de voz no están disponibles ahora.',
  generic: 'No se pudo grabar el audio. Inténtalo de nuevo.',
};

/** Clave del problema según la respuesta del sistema al pedir el permiso del micrófono. */
export function permissionProblem(result: { granted: boolean; canAskAgain?: boolean } | null | undefined): VoiceErrorKind | null {
  if (result?.granted) return null;
  return result && result.canAskAgain === false ? 'blocked' : 'denied';
}

type ErrorLike = { status?: unknown; isNetworkError?: unknown; body?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Texto para la persona cuando el servidor rechaza una nota de voz, o `null` si no es un caso propio
 * de las notas de voz (entonces se usa el mensaje que ya trae el servidor, redactado para ella).
 */
export function voiceSendErrorMessage(error: unknown): string | null {
  const e: ErrorLike = isRecord(error) ? error : {};
  const status = typeof e.status === 'number' ? e.status : 0;
  const code = isRecord(e.body) && typeof e.body.code === 'string' ? e.body.code : null;
  if (status === 503 && code === 'voice_disabled') return VOICE_MESSAGES.disabled;
  if (status === 413) return VOICE_MESSAGES.tooBig;
  return null;
}

/** Texto de la vista previa en la lista de conversaciones. */
export const VOICE_PREVIEW = '🎤 Nota de voz';

/** `true` si el último mensaje de la conversación es solo una nota de voz. */
export function isVoiceOnlyPreview(lastMessage: { has_audio?: boolean; content?: string } | null | undefined): boolean {
  return Boolean(lastMessage?.has_audio) && !lastMessage?.content;
}

/** Etiqueta accesible de una burbuja de nota de voz. */
export function voiceAccessibilityLabel(options: { mine: boolean; name: string; durationMs: number }): string {
  return `Nota de voz de ${options.mine ? 'ti' : options.name}, ${formatDuration(options.durationMs)}`;
}
