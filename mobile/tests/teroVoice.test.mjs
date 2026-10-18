// Dictado para Tero en la app (ADR-042 §1.2): lógica pura e invariantes de privacidad (nada se envía
// solo, el audio no llega a THERS). Espejo de Frontend/tests/teroVoice.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  DICTATION_MESSAGES,
  DICTATION_PRIVACY,
  MAX_DICTATED_LENGTH,
  RECOGNITION_LANG,
  dictationErrorKind,
  dictationPermissionProblem,
  joinDictation,
} from '../src/features/tero/lib/teroVoice.ts';
import { MAX_TERO_MESSAGE_LENGTH } from '../src/features/tero/lib/teroChat.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

describe('tope', () => {
  it('coincide con el del chat de Tero y el del servidor', () => {
    assert.equal(MAX_DICTATED_LENGTH, MAX_TERO_MESSAGE_LENGTH);
  });
});

describe('idioma', () => {
  it('es español de El Salvador', () => assert.equal(RECOGNITION_LANG, 'es-SV'));
});

describe('errores', () => {
  it('traduce los códigos del reconocimiento; detener a mano no es un error', () => {
    assert.equal(dictationErrorKind('aborted'), null);
    assert.equal(dictationErrorKind('not-allowed'), 'denied');
    assert.equal(dictationErrorKind('service-not-allowed'), 'unavailable');
    assert.equal(dictationErrorKind('no-speech'), 'noSpeech');
    assert.equal(dictationErrorKind('audio-capture'), 'noDevice');
    assert.equal(dictationErrorKind('network'), 'network');
    assert.equal(dictationErrorKind('language-not-supported'), 'language');
    assert.equal(dictationErrorKind('busy'), 'busy');
    assert.equal(dictationErrorKind('raro'), 'generic');
    assert.equal(dictationErrorKind(undefined), 'generic');
  });

  it('distingue permiso negado (se puede volver a pedir) de bloqueado (hay que ir a Ajustes)', () => {
    assert.equal(dictationPermissionProblem({ granted: true }), null);
    assert.equal(dictationPermissionProblem({ granted: false, canAskAgain: true }), 'denied');
    assert.equal(dictationPermissionProblem({ granted: false, canAskAgain: false }), 'blocked');
    assert.equal(dictationPermissionProblem(undefined), 'denied');
  });

  it('todos los problemas tienen un texto para la persona', () => {
    for (const kind of ['denied', 'blocked', 'noSpeech', 'noDevice', 'network', 'language', 'busy', 'unavailable', 'generic']) {
      assert.ok(DICTATION_MESSAGES[kind].trim().length > 10, kind);
    }
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
    assert.equal(joinDictation('a'.repeat(900), 'b'.repeat(500)).length, MAX_TERO_MESSAGE_LENGTH);
  });
});

describe('privacidad y control', () => {
  const button = read('src/features/tero/components/TeroDictationButton.tsx');
  const screen = read('app/tero/chat.tsx');

  it('avisa de que lo procesa el teléfono y de que THERS no recibe el audio', () => {
    assert.match(DICTATION_PRIVACY, /THERS no recibe el audio/);
    assert.match(DICTATION_PRIVACY, /teléfono/);
  });

  it('dictar NUNCA envía: solo rellena el campo', () => {
    assert.match(button, /onDraft\(joinDictation/);
    assert.ok(!/teroClient|send\(|submit\(/.test(button));
    // En la pantalla, el botón recibe `setDraft`, no `send`.
    assert.match(screen, /onDraft=\{setDraft\}/);
  });

  it('el audio no sale hacia THERS: el dictado no usa la red', () => {
    assert.ok(!/fetch\(|request\(|axios/.test(button));
  });

  it('el permiso se pide solo al pulsar, nunca al montar la pantalla', () => {
    assert.equal([...button.matchAll(/requestPermissionsAsync\(/g)].length, 1);
    const toggle = button.slice(button.indexOf('async function toggle'));
    assert.ok(toggle.includes('requestPermissionsAsync('));
  });

  it('se detiene al cerrar la pantalla', () => {
    assert.match(button, /ExpoSpeechRecognitionModule\.abort\(\)/);
  });

  it('está apagado salvo que EXPO_PUBLIC_TERO_VOICE_ENABLED valga exactamente "true"', () => {
    assert.match(read('src/features/messages/voiceConfig.ts'), /EXPO_PUBLIC_TERO_VOICE_ENABLED === 'true'/);
    assert.match(screen, /TERO_VOICE_ENABLED \? \(\s*<TeroDictationButton/);
  });

  it('la app declara los permisos de micrófono y reconocimiento de voz con texto claro', () => {
    const app = JSON.parse(read('app.json'));
    const plugin = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-speech-recognition');
    assert.ok(plugin, 'falta expo-speech-recognition');
    assert.match(plugin[1].microphonePermission, /Tero/);
    assert.match(plugin[1].speechRecognitionPermission, /Tero/);
  });
});
