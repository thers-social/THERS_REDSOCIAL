// Lógica PURA del dictado para Tero (ADR-042 §1.2): sin React ni `import.meta`, para probarla con
// `node --test` (tests/teroVoice.test.mjs). Espejo de mobile/src/features/tero/lib/teroVoice.ts.
//
// El dictado convierte lo que la persona dice en TEXTO, en el dispositivo (Web Speech API), y
// ese texto va al campo de Tero para que lo revise y lo envíe ELLA. El audio nunca llega a THERS
// ni a Tero (que solo recibe texto): ver ADR-042 §1.2 y §3.5. Los textos para la persona se
// resuelven con `t("tero.voice.*")` a partir de las claves que devuelve esta capa.

import { MAX_MESSAGE_LENGTH } from "./teroChat.js";

/** Idioma del reconocimiento a partir del de la interfaz. */
export function recognitionLang(language) {
  return language === "en" ? "en-US" : "es-SV";
}

/** El constructor de reconocimiento de voz del navegador, o `null` si no hay. */
export function speechRecognitionCtor(win) {
  if (!win) return null;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

/**
 * ¿Puede este navegador dictar? `null` si sí, o la clave del motivo: `insecure` (solo funciona
 * en https o localhost) o `unsupported` (Firefox, entre otros, no lo implementa).
 */
export function dictationUnavailableReason(win) {
  if (!win) return "unsupported";
  if (win.isSecureContext === false) return "insecure";
  return speechRecognitionCtor(win) ? null : "unsupported";
}

/** Clave del mensaje para un error del reconocimiento; `null` si no hay que mostrar nada. */
export function dictationErrorKind(code) {
  switch (code) {
    case "aborted":
      return null; // la persona lo detuvo: no es un error
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "no-speech":
      return "noSpeech";
    case "audio-capture":
      return "noDevice";
    case "network":
      return "network";
    case "language-not-supported":
      return "language";
    case "busy":
      return "busy";
    default:
      return "generic";
  }
}

/**
 * Texto del campo tras dictar: lo que ya había escrito más lo dictado, separados por un espacio y
 * sin pasar del tope del servidor. Dictar nunca borra lo escrito antes.
 */
export function joinDictation(base, transcript) {
  const before = String(base ?? "").trimEnd();
  const spoken = String(transcript ?? "").trim();
  if (!spoken) return before;
  const joined = before ? `${before} ${spoken}` : spoken;
  return joined.slice(0, MAX_MESSAGE_LENGTH);
}

/** Une los resultados (parciales y finales) de un evento `result` en un solo texto. */
export function transcriptFromResults(results) {
  if (!results || typeof results.length !== "number") return "";
  const parts = [];
  for (let i = 0; i < results.length; i += 1) {
    const alternative = results[i]?.[0];
    if (alternative && typeof alternative.transcript === "string") parts.push(alternative.transcript);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
