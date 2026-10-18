// La voz de Tero en la web (ADR-045): elección de voz, limpieza del texto, preferencia e invariantes de
// privacidad. `node --test`, sin dependencias. Espejo de mobile/tests/teroSpeech.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  MAX_SPOKEN_CHARS,
  SPEAK_STORAGE_KEY,
  VOICE_SAMPLES,
  VOICE_STORAGE_KEY_EN,
  detectLanguage,
  TERO_PITCH,
  TERO_RATE,
  VOICE_STORAGE_KEY,
  pickVoice,
  rankedVoices,
  readSpeakPreference,
  readVoicePreference,
  resolveVoice,
  speechLang,
  speechSupported,
  speechText,
  voiceScore,
  writeSpeakPreference,
  writeVoicePreference,
} from '../src/features/tero/lib/teroSpeech.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const v = (name, lang, extra = {}) => ({ name, lang, localService: true, ...extra });
const speech = {
  es: JSON.parse(read('src/shared/i18n/locales/es.json')).tero.speech,
  en: JSON.parse(read('src/shared/i18n/locales/en.json')).tero.speech,
};

describe('voz de Tero', () => {
  it('suena casi natural: sin deformar el tono ni acelerar (eso la vuelve robótica)', () => {
    assert.ok(TERO_PITCH >= 1 && TERO_PITCH <= 1.1);
    assert.ok(TERO_RATE >= 0.9 && TERO_RATE <= 1.05);
  });

  it('ordena las voces de mejor a peor y deja fuera las de otro idioma', () => {
    const list = rankedVoices([v('b', 'es-ES'), v('x', 'fr-FR'), v('a', 'es-MX', { localService: false }), v('c', 'es-MX')]);
    assert.deepEqual(list.map((x) => x.name), ['a', 'c', 'b']);
    assert.deepEqual(rankedVoices(undefined), []);
  });

  it('respeta la voz elegida si sigue disponible y, si no, vuelve a la automática', () => {
    const voices = [v('mx', 'es-MX', { localService: false }), v('es', 'es-ES')];
    assert.equal(resolveVoice(voices, 'es').name, 'es');
    assert.equal(resolveVoice(voices, 'desaparecida').name, 'mx');
    assert.equal(resolveVoice(voices, null).name, 'mx');
  });

  it('prefiere español latinoamericano antes que el de España', () => {
    assert.equal(pickVoice([v('a', 'es-ES'), v('b', 'es-MX'), v('c', 'en-US')]).name, 'b');
  });

  it('prefiere El Salvador y acepta guion bajo', () => {
    assert.equal(pickVoice([v('mx', 'es-MX'), v('sv', 'es_SV')]).name, 'sv');
  });

  it('una voz de red o neuronal gana a una básica del mismo idioma', () => {
    const best = pickVoice([
      v('Basica', 'es-MX'),
      v('Microsoft Dalia Online (Natural)', 'es-MX', { localService: false }),
    ]);
    assert.match(best.name, /Dalia/);
  });

  it('ignora lo que no es español y devuelve undefined si no hay ninguna', () => {
    assert.equal(voiceScore(v('x', 'en-US')), null);
    assert.equal(pickVoice([v('x', 'fr-FR')]), undefined);
    assert.equal(pickVoice([]), undefined);
    assert.equal(pickVoice(undefined), undefined);
  });

  it('elige inglés para la interfaz en inglés y el idioma de síntesis sigue a la interfaz', () => {
    assert.equal(pickVoice([v('es', 'es-MX'), v('en', 'en-US')], 'en').name, 'en');
    assert.equal(speechLang('en'), 'en-US');
    assert.equal(speechLang('es'), 'es-MX');
  });
});

describe('idioma de la respuesta', () => {
  it('reconoce el inglés', () => {
    assert.equal(detectLanguage("Hi! I can help you improve your profile. What do you want to change?"), 'en');
    assert.equal(detectLanguage('Who can I follow?'), 'en');
    assert.equal(detectLanguage('Hello'), 'en');
    assert.equal(detectLanguage('Thanks, that is great'), 'en');
  });

  it('reconoce el español, con o sin tildes', () => {
    assert.equal(detectLanguage('¡Hola! Puedo ayudarte a mejorar tu perfil. ¿Qué quieres cambiar?'), 'es');
    assert.equal(detectLanguage('Que puedes hacer por mi'), 'es');
    assert.equal(detectLanguage('Gracias'), 'es');
  });

  it('ante la duda, español: texto vacío, sin pistas, empate o no textual', () => {
    assert.equal(detectLanguage(''), 'es');
    assert.equal(detectLanguage('THERS'), 'es');
    assert.equal(detectLanguage('ok'), 'es');
    assert.equal(detectLanguage(undefined), 'es');
    assert.equal(detectLanguage(42), 'es');
  });

  it('una respuesta en español con una palabra inglesa sigue siendo español', () => {
    assert.equal(detectLanguage('Tu bio dice: «follow me». Quieres que la mejore para el perfil?'), 'es');
  });
});

describe('texto que se lee', () => {
  it('quita Markdown, enlaces, emoji y saltos', () => {
    assert.equal(
      speechText('**Hola** 😀\n\n- mira [esto](https://x.sv) y https://thers.sv/a\n`code`'),
      'Hola mira esto y un enlace code',
    );
  });

  it('no lee bloques de código', () => {
    assert.equal(speechText('Antes ```const a = 1;``` después'), 'Antes después');
  });

  it('acota y corta en un final de frase', () => {
    const out = speechText('Una frase corta. '.repeat(80));
    assert.ok(out.length <= MAX_SPOKEN_CHARS);
    assert.ok(out.endsWith('.'));
  });

  it('sin finales de frase corta en una palabra con puntos suspensivos', () => {
    const out = speechText('palabra '.repeat(200));
    assert.ok(out.length <= MAX_SPOKEN_CHARS + 1);
    assert.ok(out.endsWith('…'));
  });

  it('vacío o no textual no habla', () => {
    assert.equal(speechText(''), '');
    assert.equal(speechText('  😀 '), '');
    assert.equal(speechText(undefined), '');
  });
});

describe('preferencia', () => {
  const store = () => {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, x) => data.set(k, x), data };
  };

  it('Tero habla salvo que se haya apagado', () => {
    const s = store();
    assert.equal(readSpeakPreference(s), true);
    writeSpeakPreference(s, false);
    assert.equal(s.data.get(SPEAK_STORAGE_KEY), 'off');
    assert.equal(readSpeakPreference(s), false);
    writeSpeakPreference(s, true);
    assert.equal(readSpeakPreference(s), true);
  });

  it('sin almacenamiento o con uno que falla no rompe', () => {
    const broken = {
      getItem() {
        throw new Error('x');
      },
      setItem() {
        throw new Error('x');
      },
    };
    assert.equal(readSpeakPreference(null), true);
    assert.equal(readSpeakPreference(broken), true);
    assert.doesNotThrow(() => writeSpeakPreference(broken, false));
  });

  it('la voz elegida se guarda por nombre y se puede volver a la automática', () => {
    const data = new Map();
    const s = { getItem: (k) => data.get(k) ?? null, setItem: (k, x) => data.set(k, x), removeItem: (k) => data.delete(k) };
    assert.equal(readVoicePreference(s), null);
    writeVoicePreference(s, 'Microsoft Dalia Online (Natural)');
    assert.equal(data.get(VOICE_STORAGE_KEY), 'Microsoft Dalia Online (Natural)');
    assert.equal(readVoicePreference(s), 'Microsoft Dalia Online (Natural)');
    writeVoicePreference(s, null);
    assert.equal(readVoicePreference(s), null);
    assert.equal(readVoicePreference(null), null);
    data.set(VOICE_STORAGE_KEY, 'x'.repeat(201));
    assert.equal(readVoicePreference(s), null);
  });

  it('la voz en inglés se guarda aparte de la de español', () => {
    const data = new Map();
    const s = { getItem: (k) => data.get(k) ?? null, setItem: (k, x) => data.set(k, x), removeItem: (k) => data.delete(k) };
    writeVoicePreference(s, 'Voz ES', 'es');
    writeVoicePreference(s, 'Voice EN', 'en');
    assert.equal(data.get(VOICE_STORAGE_KEY_EN), 'Voice EN');
    assert.equal(readVoicePreference(s, 'es'), 'Voz ES');
    assert.equal(readVoicePreference(s, 'en'), 'Voice EN');
    writeVoicePreference(s, null, 'en');
    assert.equal(readVoicePreference(s, 'en'), null);
    assert.equal(readVoicePreference(s, 'es'), 'Voz ES');
  });

  it('hay una frase de prueba en cada idioma y cada una se reconoce como tal', () => {
    assert.equal(detectLanguage(VOICE_SAMPLES.en), 'en');
    assert.equal(detectLanguage(VOICE_SAMPLES.es), 'es');
  });

  it('detecta si el navegador trae síntesis', () => {
    assert.equal(speechSupported(null), false);
    assert.equal(speechSupported({}), false);
    assert.equal(speechSupported({ speechSynthesis: {}, SpeechSynthesisUtterance: function X() {} }), true);
  });
});

describe('uso y privacidad', () => {
  it('usa la síntesis del navegador y no sube el texto a ningún servidor', () => {
    const hook = read('src/features/tero/hooks/useTeroSpeech.js');
    assert.match(hook, /speechSynthesis/);
    assert.match(hook, /family \?\? detectLanguage\(text\)/);
    assert.doesNotMatch(hook, /fetch\(|axios|XMLHttpRequest/);
  });

  it('el panel lee solo respuestas de Tero y se calla al enviar o dictar', () => {
    const panel = read('src/features/tero/components/TeroChatPanel.jsx');
    assert.match(panel, /last\.role === "tero" && speakOn/);
    assert.match(panel, /stopSpeech\(\);\n\s+dictation\.stop\(\);/);
    assert.match(panel, /stopSpeech\(\);\n\s+dictationBase\.current = draft/);
    assert.match(panel, /aria-pressed=\{speakOn\}/);
    assert.match(panel, /onChange=\{\(event\) => chooseVoice\(family, event\.target\.value\)\}/);
    // Un selector por idioma: Tero lee en inglés cuando contesta en inglés.
    assert.match(panel, /\["es", "en"\]\.map\(\(family\)/);
  });

  it('las traducciones existen en español e inglés', () => {
    for (const lang of ['es', 'en']) {
      for (const key of ['on', 'off', 'note', 'auto']) assert.ok(speech[lang][key]?.length > 0, `${lang}.${key}`);
      for (const family of ['es', 'en']) assert.ok(speech[lang].voice[family]?.length > 0, `${lang}.voice.${family}`);
    }
  });
});
