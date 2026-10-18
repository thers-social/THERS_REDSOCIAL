// Videos cortos en publicaciones y mensajes (ADR-046), lado navegador.
//
// El servidor vuelve a validar y re-codifica TODO (por contenido, nunca por lo que diga el navegador),
// así que esto no es una barrera de seguridad: es experiencia de uso. Un video de móvil pesa fácilmente
// más de los 25 MB que acepta el servidor; avisar aquí evita subir 100 MB para recibir un error.

// Apagado salvo que valga exactamente "true": una función en evolución no debe aparecer en una build por
// olvidar la variable. Como toda VITE_*, queda en el bundle: es un interruptor, no un secreto. El servidor
// tiene el suyo (VIDEO_UPLOADS_ENABLED); con este encendido y el servidor apagado, enviar muestra «Los
// videos no están disponibles ahora».
export const VIDEO_ENABLED = import.meta.env.VITE_VIDEO_ENABLED === "true";

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;

export class VideoSelectionError extends Error {}

/** `null` si el archivo es admisible; si no, el motivo (texto apto para mostrar). */
export function videoProblem(file, durationSeconds = null) {
  if (!file || !ACCEPTED_VIDEO_TYPES.includes(file.type)) {
    return "Solo se permiten videos MP4, MOV o WebM.";
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return "El video puede pesar como máximo 25 MB.";
  }
  if (durationSeconds !== null && durationSeconds > MAX_VIDEO_SECONDS + 0.5) {
    return `El video puede durar como máximo ${MAX_VIDEO_SECONDS} segundos.`;
  }
  return null;
}

/** Duración (s) leída de los metadatos del video, o `null` si el navegador no puede leerlos. */
export function readVideoDuration(url, { timeoutMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    const finish = (value) => {
      probe.removeAttribute("src");
      probe.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    probe.preload = "metadata";
    probe.muted = true;
    probe.onloadedmetadata = () => {
      clearTimeout(timer);
      finish(Number.isFinite(probe.duration) ? probe.duration : null);
    };
    probe.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    probe.src = url;
  });
}

/** `mm:ss` de una duración en milisegundos. */
export function formatVideoDuration(durationMs) {
  const total = Math.max(0, Math.round((durationMs || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Mensajes del servidor que tienen su propio texto (el resto lo resuelve `getErrorMessage`). */
export function videoSendErrorKind(error) {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  if (code === "video_disabled") return "disabled";
  if (status === 413) return "too_large";
  return null;
}
