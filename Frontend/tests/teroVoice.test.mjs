// Dictado para Tero en la web (ADR-042 §1.2): lógica pura, claves de traducción e invariantes de
// privacidad (nada se envía solo, el audio no llega a THERS). `node --test`, sin dependencias.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  dictationErrorKind,
  dictationUnavailableReason,
  joinDictation,
  recognitionLang,
  speechRecognitionCtor,
  transcriptFromResults,
} from '../src/features/tero/lib/teroVoice.js';
import { MAX_MESSAGE_LENGTH } from '../src/features/tero/lib/teroChat.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const locales = {
  es: JSON.parse(read('src/shared/i18n/locales/es.json')).tero.voice,
  en: JSON.parse(read('src/shared/i18n/locales/en.json')).tero.voice,
};

describe('idioma', () => {
  it('usa el de la interfaz', () => {
    assert.equal(recognitionLang('es'), 'es-SV');
    assert.equal(recognitionLang('en'), 'en-US');
    assert.equal(recognitionLang(undefined), 'es-SV');
  });
});

describe('disponibilidad', () => {
  class Fake {}

  it('hay dictado con SpeechRecognition o con el prefijo de WebKit', () => {
    assert.equal(speechRecognitionCtor({ SpeechRecognition: Fake }), Fake);
    assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: Fake }), Fake);
    assert.equal(speechRecognitionCtor({}), null);
    assert.equal(speechRecognitionCtor(null), null);
  });

  it('sin soporte o sin https lo dice con una clave', () => {
    assert.equal(dictationUnavailableReason({ SpeechRecognition: Fake, isSecureContext: true }), null);
    assert.equal(dictationUnavailableReason({ SpeechRecognition: Fake, isSecureContext: false }), 'insecure');
    assert.equal(dictationUnavailableReason({ isSecureContext: true }), 'unsupported');
    assert.equal(dictationUnavailableReason(null), 'unsupported');
  });
});

describe('errores', () => {
  it('traduce los códigos del navegador; detener a mano no es un error', () => {
    assert.equal(dictationErrorKind('aborted'), null);
    assert.equal(dictationErrorKind('not-allowed'), 'denied');
    assert.equal(dictationErrorKind('service-not-allowed'), 'denied');
    assert.equal(dictationErrorKind('no-speech'), 'noSpeech');
    assert.equal(dictationErrorKind('audio-capture'), 'noDevice');
    assert.equal(dictationErrorKind('network'), 'network');
    assert.equal(dictationErrorKind('language-not-supported'), 'language');
    assert.equal(dictationErrorKind('busy'), 'busy');
    assert.equal(dictationErrorKind('algo-raro'), 'generic');
    assert.equal(dictationErrorKind(undefined), 'generic');
  });
});

describe('texto dictado', () => {
  it('se añade a lo ya escrito sin borrarlo', () => {
    assert.equal(joinDictation('', 'hola tero'), 'hola tero');
    assert.equal(joinDictation('ayúdame con', 'mi biografía'), 'ayúdame con mi biografía');
    assert.equal(joinDictation('con espacios   ', '  y más  '), 'con espacios y más');
    assert.equal(joinDictation('solo lo escrito', ''), 'solo lo escrito');
    assert.equal(joinDictation(undefined, undefined), '');
  });

  it('respeta el tope del servidor', () => {
    assert.equal(joinDictation('a'.repeat(900), 'b'.repeat(500)).length, MAX_MESSAGE_LENGTH);
  });

  it('une los resultados parciales y finales en un solo texto', () => {
    const results = [[{ transcript: 'hola' }], [{ transcript: ' qué  tal ' }]];
    assert.equal(transcriptFromResults(results), 'hola qué tal');
    assert.equal(transcriptFromResults([]), '');
    assert.equal(transcriptFromResults(null), '');
    assert.equal(transcriptFromResults([[{}], [{ transcript: 5 }]]), '');
  });
});

describe('traducciones', () => {
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

  it('español e inglés tienen exactamente las mismas claves y ninguna vacía', () => {
    assert.deepEqual(flatten(locales.es).sort(), flatten(locales.en).sort());
    for (const lang of ['es', 'en']) for (const key of flatten(locales[lang])) {
      assert.ok(key.split('.').reduce((o, p) => o[p], locales[lang]).trim(), `${lang}.${key}`);
    }
  });

  it('existe un texto para cada error que la lógica puede emitir', () => {
    const keys = new Set(flatten(locales.es));
    const emitted = ['aborted', 'not-allowed', 'no-speech', 'audio-capture', 'network', 'language-not-supported', 'busy', 'x']
      .map(dictationErrorKind).filter(Boolean);
    for (const kind of [...emitted, 'insecure', 'unsupported']) assert.ok(keys.has(`errors.${kind}`), kind);
    for (const key of ['start', 'stop', 'listening', 'privacy']) assert.ok(keys.has(key), key);
  });

  it('avisa de que lo procesa el navegador y de que THERS no recibe el audio', () => {
    assert.match(locales.es.privacy, /navegador/i);
    assert.match(locales.es.privacy, /THERS no recibe el audio/);
    assert.match(locales.en.privacy, /does not receive the audio/);
  });
});

describe('privacidad y control', () => {
  const panel = read('src/features/tero/components/TeroChatPanel.jsx');
  const hook = read('src/features/tero/hooks/useDictation.js');

  it('dictar NUNCA envía: solo rellena el campo y enviar sigue siendo un acto aparte', () => {
    // El dictado llama a `setDraft`, no a `send`.
    const dictationBlock = panel.slice(panel.indexOf('const dictation = useDictation'), panel.indexOf('const toggleDictation'));
    assert.match(dictationBlock, /setDraft\(/);
    assert.ok(!/send\(/.test(dictationBlock));
    assert.ok(!/send\(/.test(hook));
  });

  it('el micrófono se pide solo al empezar a dictar, nunca al montar', () => {
    assert.equal([...hook.matchAll(/recognition\.start\(/g)].length, 1);
    const start = hook.slice(hook.indexOf('const start = useCallback'), hook.indexOf('// Soltar el micrófono'));
    assert.ok(start.includes('recognition.start('));
  });

  it('el audio no sale hacia THERS: el dictado no usa fetch ni axios ni el cliente de Tero', () => {
    for (const source of [hook, read('src/features/tero/lib/teroVoice.js')]) {
      assert.ok(!/fetch\(|axios|api\.post|sendToTero/.test(source));
    }
  });

  it('al enviar o cerrar el panel el dictado se detiene', () => {
    assert.match(panel, /dictation\.stop\(\);\s*\n\s*const text = draft;/);
    assert.match(hook, /recognition\.abort\(\)/);
  });

  it('está apagado salvo que VITE_TERO_VOICE_ENABLED valga exactamente "true"', () => {
    assert.match(read('src/shared/lib/voiceConfig.js'), /VITE_TERO_VOICE_ENABLED === "true"/);
    assert.match(panel, /TERO_VOICE_ENABLED && dictation\.unavailable !== "unsupported"/);
  });

  it('no se muestra un botón que no funciona: sin soporte, no aparece', () => {
    assert.match(panel, /dictationAvailable \? \(/);
  });
});
