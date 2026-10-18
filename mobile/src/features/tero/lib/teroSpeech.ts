/**
 * La voz de Tero (ADR-045): lógica PURA para que Tero lea sus respuestas en voz alta con la
 * síntesis de voz del teléfono. El texto NO sale del dispositivo: lo sintetiza el propio sistema.
 *
 * Tero es un compañero pequeño, amable y vivaz: una voz cálida en español latinoamericano, algo más
 * aguda que la normal y a un ritmo ligero. No es la voz de ninguna persona.
 */

/**
 * Tono y velocidad de Tero (1 = normal). Casi naturales a propósito: subir mucho el tono es lo que hace
 * sonar robótica a una voz. La calidez la da elegir una buena voz, no deformarla.
 */
export const TERO_PITCH = 1.04;
export const TERO_RATE = 0.97;
/** Idioma por defecto cuando el sistema no ofrece una voz mejor, por idioma de la respuesta. */
export const TERO_SPEECH_LANG = 'es-MX';
export const TERO_SPEECH_LANG_EN = 'en-US';

export type SpeechFamily = 'es' | 'en';

export function speechLangFor(family: SpeechFamily): string {
  return family === 'en' ? TERO_SPEECH_LANG_EN : TERO_SPEECH_LANG;
}

/** Frase de prueba de cada voz (los ajustes la reproducen al elegir una). */
export const VOICE_SAMPLES: Record<SpeechFamily, string> = {
  es: 'Hola, soy Tero. ¿En qué te ayudo hoy?',
  en: "Hi, I'm Tero. How can I help you today?",
};

const EN_WORDS = new Set(
  'the and is are you your what how who can could would should please hello hi thanks thank with for this that have has do does my to of in it not about from help where when why which there here follow profile post posts bio name change improve make want need tell show give find new'.split(' '),
);
const ES_WORDS = new Set(
  'el la los las de que y es en un una por para con no se mi tu te lo qué cómo quién puedo puedes hola gracias favor del al como más pero si sí está están sobre quiero quieres ayuda perfil publicación publicaciones biografía nombre cambiar mejorar hacer dime dame muestra busca nuevo nueva'.split(' '),
);
const ES_MARKS = /[¿¡ñáéíóúü]/giu;

/**
 * Idioma de un texto: `en` si hay más palabras inglesas que españolas; `es` en cualquier otro caso
 * (empate, texto corto sin pistas, mezcla). Heurística simple y local: sirve para elegir la voz con que
 * Tero lee una respuesta, no para traducir nada.
 */
export function detectLanguage(text: string): SpeechFamily {
  if (typeof text !== 'string') return 'es';
  const words = text.toLowerCase().match(/[a-záéíóúüñ]+/g) ?? [];
  let en = 0;
  let es = (text.match(ES_MARKS) ?? []).length;
  for (const word of words) {
    if (EN_WORDS.has(word)) en += 1;
    if (ES_WORDS.has(word)) es += 1;
  }
  return en > es ? 'en' : 'es';
}
/** Tope de lo que se lee de una vez: una respuesta larga no debe hablar medio minuto sin parar. */
export const MAX_SPOKEN_CHARS = 520;

export type SpeechVoice = {
  id: string;
  name: string;
  /** Código de idioma del sistema (`es-MX`, `es_US`, `es-419`...). */
  lang: string;
  /** Voz mejorada, neuronal o de red: suena claramente mejor que la básica. */
  premium: boolean;
};

// Las voces neuronales o de red suenan mucho menos robóticas que las locales básicas. Android las
// nombra `es-us-x-esd-network`; Apple, «Enhanced/Premium»; Windows, «Natural/Online».
const PREMIUM_HINT = /network|neural|wavenet|studio|natural|online|enhanced|premium/i;

/** `true` si la voz es de las de mejor calidad, por lo que dice su calidad, su id o su nombre. */
export function isPremiumVoice(voice: { id: string; name: string; quality?: string }): boolean {
  if (PREMIUM_HINT.test(`${voice.id} ${voice.name}`)) return true;
  // Android marca casi todas como «Enhanced»: solo cuenta si no es una voz local básica ni la genérica del idioma.
  return voice.quality === 'Enhanced' && !/local|language/i.test(voice.id);
}

// La voz genérica del idioma (`es-US-language`) es el relleno del sistema: la última opción.
const GENERIC_VOICE = /-language$/i;
// Las de red (`...-network`) son neuronales: las mejores de Google.
const NETWORK_VOICE = /network|neural|wavenet|natural|online/i;

// Orden de preferencia por región: la de El Salvador y el español latinoamericano antes que el de España.
const REGION_SCORE: Record<string, number> = {
  sv: 50, '419': 48, mx: 46, us: 44, gt: 42, hn: 42, ni: 42, cr: 42, pa: 42, co: 40, ve: 38,
  pe: 38, ar: 36, cl: 36, ec: 36, uy: 36, bo: 36, py: 36, do: 36, cu: 36, pr: 36, es: 10,
};

// Voces del sistema que suenan cálidas y claras (Windows, Apple, Chrome/Google, Android).
const WARM_NAMES = /dalia|sabina|paulina|monica|mónica|google espa|female|femenin|elvira|helena/i;

function normalizeLang(lang: string): string {
  return String(lang || '').trim().replace(/_/g, '-').toLowerCase();
}

/** Puntuación de una voz para Tero; `null` si no habla el idioma pedido (`es` o `en`). */
export function voiceScore(voice: SpeechVoice, family: 'es' | 'en' = 'es'): number | null {
  const lang = normalizeLang(voice.lang);
  if (lang !== family && !lang.startsWith(`${family}-`)) return null;
  let score = 5;
  if (family === 'es') {
    const region = lang.split('-')[1] ?? '';
    score += REGION_SCORE[region] ?? 20;
  } else {
    score += lang === 'en-us' ? 40 : 20;
  }
  if (voice.premium) score += 25;
  if (NETWORK_VOICE.test(`${voice.id} ${voice.name}`)) score += 10;
  if (GENERIC_VOICE.test(voice.id)) score -= 20;
  if (WARM_NAMES.test(voice.name)) score += 10;
  return score;
}

/** Las voces del idioma, de la mejor a la peor para Tero. */
export function rankedVoices(voices: SpeechVoice[], family: 'es' | 'en' = 'es'): SpeechVoice[] {
  return voices
    .map((voice) => ({ voice, score: voiceScore(voice, family) }))
    .filter((entry): entry is { voice: SpeechVoice; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.voice);
}

/** La voz elegida por la persona si sigue instalada; si no, la mejor automática. */
export function resolveVoice(
  voices: SpeechVoice[],
  preferredId: string | null | undefined,
  family: 'es' | 'en' = 'es',
): SpeechVoice | undefined {
  const chosen = preferredId ? voices.find((voice) => voice.id === preferredId) : undefined;
  return chosen ?? pickVoice(voices, family);
}

/** La mejor voz disponible para Tero, o `undefined` (entonces se usa solo el idioma). */
export function pickVoice(voices: SpeechVoice[], family: 'es' | 'en' = 'es'): SpeechVoice | undefined {
  let best: SpeechVoice | undefined;
  let bestScore = -1;
  for (const voice of voices) {
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
// Emoji y símbolos pictográficos: el sintetizador los lee en voz alta («cara sonriente»).
const PICTOGRAPHS = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}|\u{200D}/gu;

/**
 * Texto listo para leer: sin Markdown, sin enlaces ni emoji, sin saltos, y acotado a
 * `MAX_SPOKEN_CHARS` cortando en un final de frase si es posible. Vacío si no queda nada que leer.
 */
export function speechText(raw: string, max: number = MAX_SPOKEN_CHARS): string {
  if (typeof raw !== 'string') return '';
  let text = raw
    .replace(MARKDOWN_LINK, '$1')
    .replace(URL_RE, 'un enlace')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_~#>|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(PICTOGRAPHS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  text = end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max)}…`;
  return text.trim();
}
