/**
 * Lógica PURA del dictado para Tero en la app (`ADR-042` §1.2): sin React ni módulos nativos, para
 * probarla aislada (`tests/teroVoice.test.mjs`). Espejo de `Frontend/src/features/tero/lib/teroVoice.js`.
 *
 * El dictado convierte lo que la persona dice en TEXTO, en el teléfono, y ese texto va al campo de
 * Tero para que lo revise y lo envíe ELLA. El audio nunca llega a THERS ni a Tero (que solo recibe
 * texto). Los textos están en español: la app móvil no tiene i18n todavía.
 */

/** Mismo tope que el servidor y que `MAX_TERO_MESSAGE_LENGTH` (lo comprueba una prueba). No se importa de `teroChat` para que este archivo se pueda probar aislado. */
export const MAX_DICTATED_LENGTH = 1000;

/** Idioma del reconocimiento (la app móvil es solo en español por ahora). */
export const RECOGNITION_LANG = 'es-SV';

export type DictationErrorKind =
  | 'denied'
  | 'blocked'
  | 'noSpeech'
  | 'noDevice'
  | 'network'
  | 'language'
  | 'busy'
  | 'unavailable'
  | 'generic';

export const DICTATION_MESSAGES: Record<DictationErrorKind, string> = {
  denied: 'No tenemos permiso para usar el micrófono. Actívalo en los ajustes del teléfono.',
  blocked: 'El permiso del micrófono está bloqueado. Actívalo en Ajustes > Aplicaciones > THERS > Permisos.',
  noSpeech: 'No te escuché. Pulsa el micrófono y habla de nuevo.',
  noDevice: 'No encontramos un micrófono disponible.',
  network: 'El dictado necesita conexión. Revisa tu internet e inténtalo de nuevo.',
  language: 'Tu teléfono no reconoce este idioma para dictar.',
  busy: 'El micrófono está ocupado por otra aplicación.',
  unavailable: 'Este teléfono no tiene un servicio de reconocimiento de voz disponible.',
  generic: 'No se pudo dictar. Inténtalo de nuevo.',
};

/** Aviso de privacidad que se muestra junto al micrófono. */
export const DICTATION_PRIVACY =
  'El dictado lo procesa el reconocimiento de voz de tu teléfono (en Android, Google). THERS no recibe el audio: solo el texto que tú envíes.';

/** Clave del problema para un código de error del reconocimiento; `null` si no hay que mostrar nada. */
export function dictationErrorKind(code: string | null | undefined): DictationErrorKind | null {
  switch (code) {
    case 'aborted':
      return null; // la persona lo detuvo: no es un error
    case 'not-allowed':
      return 'denied';
    case 'service-not-allowed':
      return 'unavailable';
    case 'no-speech':
      return 'noSpeech';
    case 'audio-capture':
      return 'noDevice';
    case 'network':
      return 'network';
    case 'language-not-supported':
      return 'language';
    case 'busy':
      return 'busy';
    default:
      return 'generic';
  }
}

/** Clave del problema según la respuesta del sistema al pedir el permiso. */
export function dictationPermissionProblem(
  result: { granted: boolean; canAskAgain?: boolean } | null | undefined,
): DictationErrorKind | null {
  if (result?.granted) return null;
  return result && result.canAskAgain === false ? 'blocked' : 'denied';
}

/**
 * Texto del campo tras dictar: lo que ya había escrito más lo dictado, separados por un espacio y
 * sin pasar del tope del servidor. Dictar nunca borra lo escrito antes.
 */
export function joinDictation(base: string | null | undefined, transcript: string | null | undefined): string {
  const before = String(base ?? '').trimEnd();
  const spoken = String(transcript ?? '').trim();
  if (!spoken) return before;
  const joined = before ? `${before} ${spoken}` : spoken;
  return joined.slice(0, MAX_DICTATED_LENGTH);
}
