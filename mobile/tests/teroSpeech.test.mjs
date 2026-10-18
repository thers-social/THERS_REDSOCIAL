// La voz de Tero en la app (ADR-045): elección de voz, limpieza del texto e invariantes de privacidad.
// Espejo de Frontend/tests/teroSpeech.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  MAX_SPOKEN_CHARS,
  VOICE_SAMPLES,
  detectLanguage,
  speechLangFor,
  TERO_PITCH,
  TERO_RATE,
  isPremiumVoice,
  pickVoice,
  rankedVoices,
  resolveVoice,
  speechText,
  voiceScore,
} from '../src/features/tero/lib/teroSpeech.ts';
import { defaultPreferences, parsePreferences } from '../src/features/tero/lib/preferences.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const v = (id, lang, extra = {}) => ({ id, name: id, lang, premium: false, ...extra });

describe('voz de Tero', () => {
  it('suena casi natural: sin deformar el tono ni acelerar (eso la vuelve robótica)', () => {
    assert.ok(TERO_PITCH >= 1 && TERO_PITCH <= 1.1);
    assert.ok(TERO_RATE >= 0.9 && TERO_RATE <= 1.05);
  });

  it('reconoce las voces neuronales o de red por su id, su nombre o su calidad', () => {
    assert.equal(isPremiumVoice({ id: 'es-us-x-esd-network', name: 'x' }), true);
    assert.equal(isPremiumVoice({ id: 'a', name: 'Microsoft Dalia Online (Natural)' }), true);
    assert.equal(isPremiumVoice({ id: 'a', name: 'b', quality: 'Enhanced' }), true);
    assert.equal(isPremiumVoice({ id: 'es-us-x-sfb-local', name: 'x' }), false);
    // Android marca casi todas como Enhanced: una local o la genérica no cuenta como mejor calidad.
    assert.equal(isPremiumVoice({ id: 'es-us-x-esd-local', name: 'x', quality: 'Enhanced' }), false);
    assert.equal(isPremiumVoice({ id: 'es-US-language', name: 'x', quality: 'Enhanced' }), false);
  });

  it('ordena las voces de mejor a peor y deja fuera las de otro idioma', () => {
    const list = rankedVoices([v('b', 'es-ES'), v('x', 'fr-FR'), v('a', 'es-MX', { premium: true }), v('c', 'es-MX')]);
    assert.deepEqual(list.map((x) => x.id), ['a', 'c', 'b']);
  });

  it('las voces de red van primero y la genérica del idioma, al final', () => {
    const list = rankedVoices([
      v('es-US-language', 'es-US'),
      v('es-us-x-esd-local', 'es-US'),
      v('es-us-x-sfb-network', 'es-US', { premium: true }),
    ]);
    assert.deepEqual(list.map((x) => x.id), ['es-us-x-sfb-network', 'es-us-x-esd-local', 'es-US-language']);
  });

  it('respeta la voz elegida si sigue instalada y, si no, vuelve a la automática', () => {
    const voices = [v('mx', 'es-MX', { premium: true }), v('es', 'es-ES')];
    assert.equal(resolveVoice(voices, 'es').id, 'es');
    assert.equal(resolveVoice(voices, 'desinstalada').id, 'mx');
    assert.equal(resolveVoice(voices, null).id, 'mx');
  });

  it('prefiere español latinoamericano antes que el de España', () => {
    const best = pickVoice([v('es', 'es-ES'), v('mx', 'es-MX'), v('en', 'en-US')]);
    assert.equal(best.id, 'mx');
  });

  it('prefiere El Salvador y acepta el formato de Android con guion bajo', () => {
    assert.equal(pickVoice([v('mx', 'es-MX'), v('sv', 'es_SV')]).id, 'sv');
  });

  it('una voz mejorada gana a una básica del mismo idioma', () => {
    const best = pickVoice([v('basic', 'es-MX'), v('good', 'es-US', { premium: true })]);
    assert.equal(best.id, 'good');
  });

  it('ignora lo que no es español y devuelve undefined si no hay ninguna', () => {
    assert.equal(voiceScore(v('x', 'en-US')), null);
    assert.equal(voiceScore(v('x', 'esperanto')), null);
    assert.equal(pickVoice([v('x', 'fr-FR')]), undefined);
    assert.equal(pickVoice([]), undefined);
  });

  it('puede elegir una voz en inglés para la interfaz en inglés', () => {
    assert.equal(pickVoice([v('es', 'es-MX'), v('en', 'en-US')], 'en').id, 'en');
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
  it('quita Markdown, enlaces, emoji y saltos de línea', () => {
    const out = speechText('**Hola** 😀\n\n- mira [esto](https://x.sv) y https://thers.sv/a\n`code`');
    assert.equal(out, 'Hola mira esto y un enlace code');
  });

  it('no lee bloques de código', () => {
    assert.equal(speechText('Antes ```const a = 1;``` después'), 'Antes después');
  });

  it('acota y corta en un final de frase cuando puede', () => {
    const long = `${'Una frase corta. '.repeat(80)}`;
    const out = speechText(long);
    assert.ok(out.length <= MAX_SPOKEN_CHARS);
    assert.ok(out.endsWith('.'));
  });

  it('un texto sin finales de frase se corta en una palabra y termina en puntos suspensivos', () => {
    const out = speechText('palabra '.repeat(200));
    assert.ok(out.length <= MAX_SPOKEN_CHARS + 1);
    assert.ok(out.endsWith('…'));
  });

  it('vacío o no textual no habla', () => {
    assert.equal(speechText(''), '');
    assert.equal(speechText('   😀  '), '');
    assert.equal(speechText(undefined), '');
  });
});

describe('preferencia', () => {
  it('Tero habla por defecto y se puede apagar', () => {
    assert.equal(defaultPreferences().speakReplies, true);
    assert.equal(parsePreferences(JSON.stringify({ speakReplies: false })).speakReplies, false);
  });

  it('un valor corrupto vuelve al valor por defecto', () => {
    assert.equal(parsePreferences(JSON.stringify({ speakReplies: 'no' })).speakReplies, true);
  });

  it('la voz es automática por defecto y acepta solo un id razonable', () => {
    assert.equal(defaultPreferences().voiceId, null);
    assert.equal(parsePreferences(JSON.stringify({ voiceId: 'es-us-x-esd-network' })).voiceId, 'es-us-x-esd-network');
    assert.equal(parsePreferences(JSON.stringify({ voiceId: 7 })).voiceId, null);
    assert.equal(parsePreferences(JSON.stringify({ voiceId: '' })).voiceId, null);
    assert.equal(parsePreferences(JSON.stringify({ voiceId: 'x'.repeat(201) })).voiceId, null);
  });

  it('la voz en inglés es independiente de la de español', () => {
    assert.equal(defaultPreferences().voiceIdEn, null);
    const prefs = parsePreferences(JSON.stringify({ voiceId: 'es-us-x-sfb-network', voiceIdEn: 'en-us-x-iom-network' }));
    assert.equal(prefs.voiceId, 'es-us-x-sfb-network');
    assert.equal(prefs.voiceIdEn, 'en-us-x-iom-network');
    assert.equal(parsePreferences(JSON.stringify({ voiceIdEn: 5 })).voiceIdEn, null);
  });
});

describe('idioma de síntesis', () => {
  it('elige el idioma de la voz según el de la respuesta', () => {
    assert.equal(speechLangFor('en'), 'en-US');
    assert.equal(speechLangFor('es'), 'es-MX');
  });

  it('hay una frase de prueba en cada idioma y cada una se reconoce como tal', () => {
    assert.equal(detectLanguage(VOICE_SAMPLES.en), 'en');
    assert.equal(detectLanguage(VOICE_SAMPLES.es), 'es');
  });

  it('el hook lee en el idioma de la respuesta y usa la voz elegida para ese idioma', () => {
    const hook = read('src/features/tero/lib/useTeroSpeech.ts');
    assert.match(hook, /family \?\? detectLanguage\(text\)/);
    assert.match(hook, /choiceRef\.current\?\.\[language\]/);
  });
});

describe('privacidad y uso', () => {
  it('usa la voz del sistema y no sube el texto a ningún servidor', () => {
    const hook = read('src/features/tero/lib/useTeroSpeech.ts');
    assert.match(hook, /from 'expo-speech'/);
    assert.doesNotMatch(hook, /fetch\(|axios|XMLHttpRequest|api\./);
  });

  it('el chat lee solo las respuestas y se calla al enviar o dictar', () => {
    const chat = read('app/tero/chat.tsx');
    assert.match(chat, /speakRepliesRef\.current\) void speak\(reply\.text\)/);
    assert.match(chat, /stop\(\);\n\s+const message: TeroMessage/);
    assert.match(chat, /if \(listening\) stop\(\)/);
    // El interruptor es un `switch` accesible con nombre.
    assert.match(chat, /accessibilityRole="switch"/);
  });

  it('los ajustes tienen el interruptor y el selector de voz', () => {
    const settings = read('app/tero/settings.tsx');
    assert.match(settings, /label="Tero habla"/);
    assert.match(settings, /<TeroVoicePicker \/>/);
  });

  it('el selector deja elegir la automática y reproduce una frase de prueba', () => {
    const picker = read('src/features/tero/components/TeroVoicePicker.tsx');
    assert.match(picker, /Automática/);
    assert.match(picker, /speak\(VOICE_SAMPLES\[family\], voiceId, family\)/);
    // Una sección por idioma: Tero lee en inglés cuando contesta en inglés.
    assert.match(picker, /<VoiceSection family="es" \/>/);
    assert.match(picker, /<VoiceSection family="en" \/>/);
    assert.match(picker, /accessibilityRole="radio"/);
  });
});
