// Lógica PURA de las notas de voz en la web (ADR-042): sin React, sin red y sin
// `import.meta`, para probarla con `node --test` (tests/voice.test.mjs).
//
// Los textos para la persona NO se escriben aquí: esta capa devuelve claves
// (`denied`, `noDevice`…) y la interfaz las traduce con `t("voice.errors.<clave>")`.

/** Mismos topes que el servidor (backend/app/domain/media/audio.py). */
export const MAX_VOICE_SECONDS = 120;
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;
/** Una grabación más corta se descarta: casi siempre es un toque accidental. */
export const MIN_VOICE_MS = 600;

/**
 * Formatos que puede grabar `MediaRecorder`, de más a menos preferido. Chrome/Edge/Firefox
 * graban WebM/Opus y Safari MP4/AAC; el servidor acepta cualquiera de ellos y lo normaliza.
 */
export const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/** El primer formato soportado, o `""` para dejar que el navegador elija el suyo. */
export function pickRecordingMime(isTypeSupported) {
  if (typeof isTypeSupported !== "function") return "";
  return RECORDING_MIME_CANDIDATES.find((mime) => isTypeSupported(mime)) ?? "";
}

/** Extensión del archivo a subir (el servidor no se fía de ella: mira la cabecera). */
export function extensionFor(mime) {
  const type = String(mime ?? "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  return "webm";
}

/** `mm:ss` a partir de milisegundos. Nunca negativo ni NaN. */
export function formatDuration(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * ¿Puede este navegador grabar? `env` se inyecta para poder probarlo. Devuelve `null` si sí, o
 * la clave del motivo: `insecure` (el micrófono solo funciona en https o localhost) o
 * `unsupported` (sin `MediaRecorder` o sin `getUserMedia`).
 */
export function recordingUnavailableReason(env) {
  if (!env) return "unsupported";
  if (env.isSecureContext === false) return "insecure";
  if (!env.hasMediaRecorder || !env.hasGetUserMedia) return "unsupported";
  return null;
}

/** Clave del mensaje para un error de `getUserMedia`/`MediaRecorder`. Nunca el texto técnico. */
export function recordingErrorKind(error) {
  const name = error?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "noDevice";
  }
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "generic";
}

/** ¿Vale la pena enviar esta grabación? Devuelve `null` si sí, o la clave del motivo. */
export function recordingProblem({ durationMs, size }) {
  if (!Number.isFinite(durationMs) || durationMs < MIN_VOICE_MS || !size) return "tooShort";
  if (size > MAX_VOICE_BYTES) return "tooBig";
  return null;
}

/**
 * Clave del mensaje cuando el servidor rechaza el envío. El texto técnico del servidor no se
 * enseña salvo en los casos que ya vienen redactados para la persona (400).
 */
export function sendErrorKind(error) {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  if (status === 503 && code === "voice_disabled") return "disabled";
  if (status === 413) return "tooBig";
  return null; // el resto lo resuelve `getErrorMessage` (400 trae un texto claro del servidor)
}

/** `true` si el mensaje de la lista de conversaciones es solo una nota de voz. */
export function isVoiceOnlyPreview(lastMessage) {
  return Boolean(lastMessage?.has_audio) && !lastMessage?.content;
}
