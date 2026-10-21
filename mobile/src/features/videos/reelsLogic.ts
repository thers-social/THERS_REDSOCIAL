/**
 * Lógica pura de Reels en la app (`API_CONTRACT.md` §4.40, ADR-043-A). Sin React ni red.
 *
 * Todo lo que se valida aquí es COMODIDAD: el servidor vuelve a comprobarlo siempre (formato,
 * tamaño, 60 s, lista de cuentas de prueba D3, moderación).
 */

import type { ReelStatus, ReelVideo } from './types';

export const MAX_DURATION_SECONDS = 60;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_CAPTION = 200;
export const POLL_INTERVAL_MS = 5000;

const STATUS_TEXT: Record<ReelStatus, string> = {
  pending: 'Preparando la subida…',
  uploading: 'Subiendo…',
  processing: 'Procesando el video…',
  ready: 'Listo',
  failed: 'No se pudo procesar',
  blocked: 'No se puede publicar',
};

const FAILURE_TEXT: Record<string, string> = {
  duration_exceeded: 'El video dura más de 60 segundos.',
  no_signed_playback: 'No se pudo preparar la reproducción.',
  asset_errored: 'El video no se pudo procesar. Prueba con otro archivo.',
  upload_failed: 'La subida falló. Inténtalo de nuevo.',
  provider_unavailable: 'El servicio de video no está disponible ahora.',
};

/** Texto del estado de un video PROPIO (la API solo entrega `status` a su dueño). */
export function statusText(video: Pick<ReelVideo, 'status' | 'moderation_status' | 'failure_reason'> | null | undefined): string {
  if (!video || !video.status) return '';
  if (video.status === 'ready') {
    if (video.moderation_status === 'approved') return 'Publicado';
    if (video.moderation_status === 'rejected') return 'No se aprobó';
    return 'En revisión: se publicará cuando se apruebe';
  }
  const base = STATUS_TEXT[video.status] ?? video.status;
  const reason = video.failure_reason ? FAILURE_TEXT[video.failure_reason] : undefined;
  return reason ? `${base}. ${reason}` : base;
}

export function isInProgress(video: Pick<ReelVideo, 'status'> | null | undefined): boolean {
  return video?.status === 'pending' || video?.status === 'uploading' || video?.status === 'processing';
}

/** ¿Se puede reproducir? Solo con la reproducción firmada que entrega el servidor. */
export function canPlay(video: Pick<ReelVideo, 'playback'> | null | undefined): boolean {
  return !!video?.playback?.hls_url;
}

/** Valida el archivo elegido. Devuelve un mensaje o `null` si está bien. */
export function validatePicked(file: { size?: number | null; mimeType?: string | null; duration?: number | null } | null | undefined): string | null {
  if (!file) return 'Elige un video.';
  if (file.mimeType && !/^video\//.test(file.mimeType)) return 'El archivo debe ser un video.';
  if (typeof file.size === 'number') {
    if (file.size === 0) return 'El archivo está vacío.';
    if (file.size > MAX_FILE_BYTES) return 'El video puede pesar como máximo 100 MB.';
  }
  // `duration` (ms) la entrega el selector; si no la da, el servidor la comprueba igual.
  if (typeof file.duration === 'number' && file.duration / 1000 > MAX_DURATION_SECONDS) {
    return 'El video puede durar como máximo 60 segundos.';
  }
  return null;
}

export function validateCaption(value: string): string | null {
  return value.trim().length > MAX_CAPTION ? `El texto puede tener como máximo ${MAX_CAPTION} caracteres.` : null;
}

/** Clave que hace idempotente la reserva: reintentar no abre otra subida en Mux. */
export function makeIdempotencyKey(random: () => number = Math.random, now: () => number = Date.now): string {
  const part = () => Math.floor(random() * 0xffffffff).toString(36);
  return `app-${now().toString(36)}-${part()}${part()}`.slice(0, 80);
}

/** Mensaje para un error de la API de videos (sin detalles internos). */
export function uploadErrorMessage(status: number | undefined, serverMessage?: string): string {
  if (status === 404) return 'Subir videos no está disponible para tu cuenta todavía.';
  if (status === 429) return 'Llegaste al límite de subidas de hoy. Prueba mañana.';
  if (status === 503) return 'El servicio de video no está disponible ahora. Inténtalo más tarde.';
  if (status === 400 && serverMessage) return serverMessage;
  return 'No se pudo subir el video. Inténtalo de nuevo.';
}

export function mergeVideos(current: ReelVideo[], incoming: ReelVideo[]): ReelVideo[] {
  const seen = new Set(current.map((v) => v.id));
  return [...current, ...incoming.filter((v) => !seen.has(v.id))];
}

// --- Pantalla completa (ADR-055) -----------------------------------------------------------------

/** 1.2K, 3.4M… para los contadores del carril de acciones. */
export function formatCount(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  const compact = (divisor: number, suffix: string) => {
    const scaled = Math.floor((n / divisor) * 10) / 10;
    return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}${suffix}`;
  };
  return n < 1_000_000 ? compact(1000, 'K') : compact(1_000_000, 'M');
}

/** Resultado optimista de dar o quitar «me gusta»: cambia el estado y el contador una sola vez. */
export function withLike(video: ReelVideo, liked: boolean): ReelVideo {
  if (!!video.liked_by_me === liked) return video;
  return { ...video, liked_by_me: liked, likes_count: Math.max(0, (video.likes_count ?? 0) + (liked ? 1 : -1)) };
}

export function withSaved(video: ReelVideo, saved: boolean): ReelVideo {
  return { ...video, saved_by_me: saved };
}

/** Enlace para compartir un Reel: el mismo que la web, que abre ese Reel primero. */
export function reelUrl(origin: string, id: string): string {
  return `${origin}/videos?v=${encodeURIComponent(id)}`;
}

export function commentErrorMessage(status: number | undefined, serverMessage?: string): string {
  if (status === 429) return 'Estás comentando muy rápido. Espera un momento.';
  if (status === 404) return 'Este Reel ya no está disponible.';
  if (status === 400 && serverMessage) return serverMessage;
  return 'No se pudo publicar el comentario.';
}
