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

// --- Interfaz de pantalla completa (ADR-055) ------------------------------------------------------

/** 1.2K, 3.4M… para los contadores del carril de acciones. */
export function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  const compact = (divisor, suffix) => {
    const scaled = Math.floor((n / divisor) * 10) / 10;
    return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}${suffix}`;
  };
  return n < 1_000_000 ? compact(1000, "K") : compact(1_000_000, "M");
}

/** 0:07, 1:05 — tiempo de la barra de progreso. */
export function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Fracción 0–1 reproducida; 0 si aún no se conoce la duración. */
export function progressFraction(currentTime, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, currentTime / duration));
}

/** Tiempo al que salta un desplazamiento (flechas del teclado), dentro de [0, duración]. */
export function seekTarget(currentTime, delta, duration) {
  const upper = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(upper, Math.max(0, currentTime + delta));
}

/** Resultado optimista de dar o quitar «me gusta»: cambia el estado y el contador una vez. */
export function withLike(video, liked) {
  if (!!video.liked_by_me === liked) return video;
  return { ...video, liked_by_me: liked, likes_count: Math.max(0, (video.likes_count || 0) + (liked ? 1 : -1)) };
}

export function withSaved(video, saved) {
  return { ...video, saved_by_me: saved };
}

/** Índice del Reel que ocupa la pantalla: el más visible, y solo si pasa del umbral. */
export function mostVisibleIndex(entries, threshold = 0.6) {
  let best = -1;
  let bestRatio = 0;
  for (const { index, ratio } of entries) {
    if (ratio >= threshold && ratio > bestRatio) {
      best = index;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Enlace para compartir un Reel. */
export function reelUrl(origin, id) {
  return `${origin}/videos?v=${encodeURIComponent(id)}`;
}

/** Mensaje de error al comentar. */
export function commentErrorMessage(error) {
  const status = error?.response?.status;
  if (status === 429) return "Estás comentando muy rápido. Espera un momento.";
  if (status === 404) return "Este Reel ya no está disponible.";
  if (status === 400 && error?.response?.data?.msg) return error.response.data.msg;
  return "No se pudo publicar el comentario.";
}
