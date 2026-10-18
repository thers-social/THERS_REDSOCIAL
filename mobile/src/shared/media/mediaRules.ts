/**
 * Reglas de las fotos y los videos que se adjuntan (ADR-046), PURAS: sin React ni módulos nativos,
 * para poder probarlas aisladas (`tests/media.test.mjs`).
 *
 * El servidor vuelve a validar todo por el contenido real del archivo (nunca por lo que diga la
 * app), así que esto no es una barrera de seguridad: es experiencia de uso. Avisa antes de subir 80 MB
 * para recibir un error.
 */

/** Mismos límites que el servidor (`domain/media/video.py`, `infrastructure/media/image_processor.py`). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_POST_IMAGES = 4;
export const MAX_MESSAGE_IMAGES = 1;
/** Tope de lo que se manda a Tero (la imagen viaja en base64 dentro del JSON). */
export const MAX_TERO_IMAGE_BYTES = 3 * 1024 * 1024;

export type MediaKind = 'image' | 'video';

/** Lo que devuelve el selector, ya normalizado. */
export type PickedMedia = {
  uri: string;
  kind: MediaKind;
  /** Nombre con extensión coherente con el tipo (el servidor no se fía de él, pero se ve en los registros). */
  name: string;
  mimeType: string;
  width: number;
  height: number;
  /** Bytes, si el sistema los informa. */
  size: number | null;
  /** Solo videos, en milisegundos, si el sistema lo informa. */
  durationMs: number | null;
};

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const VIDEO_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/** Tipo MIME admitido, o `null`. Acepta el que informe el sistema y, si falta, lo deduce de la extensión. */
export function resolveMimeType(kind: MediaKind, mimeType?: string | null, uri?: string | null): string | null {
  const known = kind === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  const declared = (mimeType ?? '').toLowerCase();
  if (declared in known) return declared;
  const extension = (uri ?? '').split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  for (const [type, ext] of Object.entries(known)) {
    if (ext === extension || (ext === 'jpg' && extension === 'jpeg')) return type;
  }
  // Android a veces entrega `image/*` o nada y una ruta sin extensión: JPEG es lo habitual en fotos
  // y MP4 en videos; el servidor decide por el contenido.
  return kind === 'image' ? 'image/jpeg' : 'video/mp4';
}

export function fileNameFor(kind: MediaKind, mimeType: string): string {
  const table = kind === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  return `${kind === 'image' ? 'foto' : 'video'}.${table[mimeType] ?? (kind === 'image' ? 'jpg' : 'mp4')}`;
}

/** `null` si el archivo es admisible; si no, el motivo (texto apto para mostrar). */
export function mediaProblem(media: Pick<PickedMedia, 'kind' | 'size' | 'durationMs'>): string | null {
  if (media.kind === 'image') {
    if (media.size !== null && media.size > MAX_IMAGE_BYTES) return 'La foto puede pesar como máximo 5 MB.';
    return null;
  }
  if (media.size !== null && media.size > MAX_VIDEO_BYTES) return 'El video puede pesar como máximo 25 MB.';
  if (media.durationMs !== null && media.durationMs > (MAX_VIDEO_SECONDS + 0.5) * 1000) {
    return `El video puede durar como máximo ${MAX_VIDEO_SECONDS} segundos.`;
  }
  return null;
}

/** Cuántas fotos se pueden añadir a las que ya hay, o `0` si hay un video (son excluyentes). */
export function imageRoom(max: number, current: PickedMedia[]): number {
  if (current.some((item) => item.kind === 'video')) return 0;
  return Math.max(0, max - current.length);
}

/** Un video solo se puede añadir si no hay nada más adjunto. */
export function canAddVideo(current: PickedMedia[]): boolean {
  return current.length === 0;
}

/** `mm:ss` de una duración en milisegundos. */
export function formatDuration(durationMs: number | null | undefined): string {
  const total = Math.max(0, Math.round((durationMs ?? 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Cuerpo del campo `image` de `POST /api/tero/chat` (ADR-046). */
export function teroImagePayload(base64: string, mimeType: string): { media_type: string; data: string } {
  return { media_type: mimeType, data: base64 };
}

/** `true` si la imagen cabe en lo que se manda a Tero (el base64 pesa 4/3 del binario). */
export function fitsTero(base64: string): boolean {
  return Math.floor((base64.length * 3) / 4) <= MAX_TERO_IMAGE_BYTES;
}
