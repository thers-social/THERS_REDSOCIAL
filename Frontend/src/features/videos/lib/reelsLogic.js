// Lógica pura de Reels (ADR-043, ADR-043-A). Sin React ni red: se prueba con `node --test`.
// Todo lo que aquí se valida en el cliente es COMODIDAD: el servidor vuelve a comprobarlo siempre
// (formato, tamaño, 60 s, lista de cuentas de prueba D3, moderación).

export const MAX_DURATION_SECONDS = 60;
// Mux recodifica, así que se admite más que la v1 propia (ADR-043-A D2).
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_CAPTION = 200;
export const POLL_INTERVAL_MS = 5000;

const STATUS_TEXT = {
  pending: "Preparando la subida…",
  uploading: "Subiendo…",
  processing: "Procesando el video…",
  ready: "Listo",
  failed: "No se pudo procesar",
  blocked: "No se puede publicar",
};

const FAILURE_TEXT = {
  duration_exceeded: "El video dura más de 60 segundos.",
  no_signed_playback: "No se pudo preparar la reproducción.",
  asset_errored: "El video no se pudo procesar. Prueba con otro archivo.",
  upload_failed: "La subida falló. Inténtalo de nuevo.",
  provider_unavailable: "El servicio de video no está disponible ahora.",
};

/** Texto del estado de un video PROPIO (la API solo entrega `status` a su dueño). */
export function statusText(video) {
  if (!video) return "";
  if (video.status === "ready") {
    if (video.moderation_status === "approved") return "Publicado";
    if (video.moderation_status === "rejected") return "No se aprobó";
    return "En revisión: se publicará cuando se apruebe";
  }
  const base = STATUS_TEXT[video.status] || video.status;
  return video.failure_reason && FAILURE_TEXT[video.failure_reason]
    ? `${base}. ${FAILURE_TEXT[video.failure_reason]}`
    : base;
}

/** ¿Hay algo que seguir consultando? Mientras no sea un estado final. */
export function isInProgress(video) {
  return ["pending", "uploading", "processing"].includes(video?.status);
}

/** ¿Se puede reproducir? Solo con una reproducción firmada entregada por el servidor. */
export function canPlay(video) {
  return !!video?.playback?.hls_url;
}

/** Valida el archivo elegido antes de subirlo. Devuelve un mensaje o `null` si está bien. */
export function validateFile(file) {
  if (!file) return "Elige un video.";
  if (!/^video\//.test(file.type || "")) return "El archivo debe ser un video.";
  if (file.size > MAX_FILE_BYTES) return "El video puede pesar como máximo 100 MB.";
  if (file.size === 0) return "El archivo está vacío.";
  return null;
}

export function validateDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "No se pudo leer la duración del video.";
  if (seconds > MAX_DURATION_SECONDS) return "El video puede durar como máximo 60 segundos.";
  return null;
}

export function validateCaption(value) {
  if (typeof value === "string" && value.trim().length > MAX_CAPTION) {
    return `El texto puede tener como máximo ${MAX_CAPTION} caracteres.`;
  }
  return null;
}

/** Clave que hace idempotente la reserva: reintentar no abre otra subida en Mux. */
export function makeIdempotencyKey(random = Math.random, now = Date.now) {
  const part = () => Math.floor(random() * 0xffffffff).toString(36);
  return `web-${now().toString(36)}-${part()}${part()}`.slice(0, 80);
}

/** Mensaje para un error de la API de videos. */
export function uploadErrorMessage(error) {
  const status = error?.response?.status;
  if (status === 404) return "Subir videos no está disponible para tu cuenta todavía.";
  if (status === 429) return "Llegaste al límite de subidas de hoy. Prueba mañana.";
  if (status === 503) return "El servicio de video no está disponible ahora. Inténtalo más tarde.";
  if (status === 400 && error?.response?.data?.msg) return error.response.data.msg;
  return "No se pudo subir el video. Inténtalo de nuevo.";
}

/** `true` si la API responde que el módulo no existe (apagado): se muestra «Próximamente». */
export function isModuleOff(error) {
  return error?.response?.status === 404;
}

/** Une la lista nueva con la anterior sin duplicar ids (paginación). */
export function mergeVideos(current, incoming) {
  const seen = new Set(current.map((v) => v.id));
  return [...current, ...incoming.filter((v) => !seen.has(v.id))];
}
