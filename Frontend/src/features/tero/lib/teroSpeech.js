// La voz de Tero en la web (ADR-045): lógica PURA para que Tero lea sus respuestas en voz alta con la
// síntesis de voz del navegador (`speechSynthesis`). El texto no sale del dispositivo: lo sintetiza el
// propio sistema. Espejo de mobile/src/features/tero/lib/teroSpeech.ts.
//
// Tero es un compañero pequeño, amable y vivaz: una voz cálida en español latinoamericano, algo más
// aguda que la normal y a un ritmo ligero. No es la voz de ninguna persona.

// Casi naturales a propósito: subir mucho el tono es lo que hace sonar robótica a una voz. La calidez la
// da elegir una buena voz, no deformarla.
export const TERO_PITCH = 1.04;
export const TERO_RATE = 0.97;
export const MAX_SPOKEN_CHARS = 520;
export const SPEAK_STORAGE_KEY = "thers.tero.speak";
export const VOICE_STORAGE_KEY = "thers.tero.voice";
export const VOICE_STORAGE_KEY_EN = "thers.tero.voice.en";

/** Frase de prueba de cada voz (el selector la reproduce al elegir una). */
export const VOICE_SAMPLES = {
  es: "Hola, soy Tero. ¿En qué te ayudo hoy?",
  en: "Hi, I'm Tero. How can I help you today?",
};

const EN_WORDS = new Set(
  "the and is are you your what how who can could would should please hello hi thanks thank with for this that have has do does my to of in it not about from help where when why which there here follow profile post posts bio name change improve make want need tell show give find new".split(" ")
);
const ES_WORDS = new Set(
  "el la los las de que y es en un una por para con no se mi tu te lo qué cómo quién puedo puedes hola gracias favor del al como más pero si sí está están sobre quiero quieres ayuda perfil publicación publicaciones biografía nombre cambiar mejorar hacer dime dame muestra busca nuevo nueva".split(" ")
);
const ES_MARKS = /[¿¡ñáéíóúü]/giu;

/**
 * Idioma de un texto: `en` si hay más palabras inglesas que españolas; `es` en cualquier otro caso
 * (empate, texto corto sin pistas, mezcla). Heurística simple y local: sirve para elegir la voz con que
 * Tero lee una respuesta, no para traducir nada. Espejo de la versión de la app móvil.
 */
export function detectLanguage(text) {
  if (typeof text !== "string") return "es";
  const words = text.toLowerCase().match(/[a-záéíóúüñ]+/g) ?? [];
  let en = 0;
  let es = (text.match(ES_MARKS) ?? []).length;
  for (const word of words) {
    if (EN_WORDS.has(word)) en += 1;
    if (ES_WORDS.has(word)) es += 1;
  }
  return en > es ? "en" : "es";
}

const REGION_SCORE = {
  sv: 50, "419": 48, mx: 46, us: 44, gt: 42, hn: 42, ni: 42, cr: 42, pa: 42, co: 40, ve: 38,
  pe: 38, ar: 36, cl: 36, ec: 36, uy: 36, bo: 36, py: 36, do: 36, cu: 36, pr: 36, es: 10,
};

// Voces del sistema que suenan cálidas y claras (Windows, Apple, Chrome/Google).
const WARM_NAMES = /dalia|sabina|paulina|monica|mónica|google espa|female|femenin|elvira|helena/i;
// Las voces de red/neuronales suenan claramente mejor que las básicas.
const PREMIUM_NAMES = /natural|neural|online|enhanced|premium|google/i;

function normalizeLang(lang) {
  return String(lang || "").trim().replace(/_/g, "-").toLowerCase();
}

/** `family` es `"es"` o `"en"` (el idioma de la interfaz). `null` si la voz no lo habla. */
export function voiceScore(voice, family = "es") {
  const lang = normalizeLang(voice.lang);
  if (lang !== family && !lang.startsWith(`${family}-`)) return null;
  let score = 5;
  if (family === "es") {
    const region = lang.split("-")[1] ?? "";
    score += REGION_SCORE[region] ?? 20;
  } else {
    score += lang === "en-us" ? 40 : 20;
  }
  if (PREMIUM_NAMES.test(voice.name || "") || voice.localService === false) score += 25;
  if (WARM_NAMES.test(voice.name || "")) score += 10;
  return score;
}

/** Las voces del idioma, de la mejor a la peor para Tero. */
export function rankedVoices(voices, family = "es") {
  return (voices || [])
    .map((voice) => ({ voice, score: voiceScore(voice, family) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.voice);
}

/** La voz elegida por la persona si sigue disponible (por nombre); si no, la mejor automática. */
export function resolveVoice(voices, preferredName, family = "es") {
  const chosen = preferredName ? (voices || []).find((voice) => voice.name === preferredName) : undefined;
  return chosen ?? pickVoice(voices, family);
}

/** La mejor voz del navegador para Tero, o `undefined` (entonces solo se fija el idioma). */
export function pickVoice(voices, family = "es") {
  let best;
  let bestScore = -1;
  for (const voice of voices || []) {
    const score = voiceScore(voice, family);
    if (score !== null && score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const PICTOGRAPHS = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}|\u{200D}/gu;

/** Texto listo para leer: sin Markdown, enlaces ni emoji, y acotado a `MAX_SPOKEN_CHARS`. */
export function speechText(raw, max = MAX_SPOKEN_CHARS, linkWord = "un enlace") {
  if (typeof raw !== "string") return "";
  let text = raw
    .replace(MARKDOWN_LINK, "$1")
    .replace(URL_RE, linkWord)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_~#>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(PICTOGRAPHS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  text = end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max)}…`;
  return text.trim();
}

/** Código de idioma para sintetizar según el de la interfaz. */
export function speechLang(language) {
  return language === "en" ? "en-US" : "es-MX";
}

/** La síntesis está disponible solo en un navegador que la trae. */
export function speechSupported(win) {
  return Boolean(win && win.speechSynthesis && typeof win.SpeechSynthesisUtterance === "function");
}

/** Lee la preferencia guardada: encendida salvo que valga exactamente "off". */
export function readSpeakPreference(storage) {
  try {
    return storage?.getItem(SPEAK_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

const voiceKey = (family) => (family === "en" ? VOICE_STORAGE_KEY_EN : VOICE_STORAGE_KEY);

/** Nombre de la voz elegida para un idioma (`es` o `en`), o `null` (automática). */
export function readVoicePreference(storage, family = "es") {
  try {
    const value = storage?.getItem(voiceKey(family));
    return value && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

export function writeVoicePreference(storage, name, family = "es") {
  try {
    if (name) storage?.setItem(voiceKey(family), name);
    else storage?.removeItem(voiceKey(family));
  } catch {
    // sin almacenamiento: la elección dura solo la sesión
  }
}

export function writeSpeakPreference(storage, on) {
  try {
    storage?.setItem(SPEAK_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // sin almacenamiento: la preferencia dura solo la sesión
  }
}
