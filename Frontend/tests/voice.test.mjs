// Notas de voz en la web (ADR-042): la lógica pura (`voice.js`), que TODAS las claves de
// traducción que la interfaz pide existan en español e inglés y que el interruptor esté
// apagado por defecto. Sin dependencias: `node --test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  MAX_VOICE_BYTES,
  MAX_VOICE_SECONDS,
  MIN_VOICE_MS,
  extensionFor,
  formatDuration,
  isVoiceOnlyPreview,
  pickRecordingMime,
  recordingErrorKind,
  recordingProblem,
  recordingUnavailableReason,
  sendErrorKind,
} from '../src/shared/lib/voice.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const locales = {
  es: JSON.parse(read('src/shared/i18n/locales/es.json')).voice,
  en: JSON.parse(read('src/shared/i18n/locales/en.json')).voice,
};

describe('topes', () => {
  it('coinciden con los del servidor (backend/app/domain/media/audio.py)', () => {
    const server = read('../backend/app/domain/media/audio.py');
    assert.match(server, new RegExp(`MAX_VOICE_SECONDS = ${MAX_VOICE_SECONDS}\\b`));
    assert.match(server, new RegExp(`MAX_VOICE_UPLOAD_BYTES = ${MAX_VOICE_BYTES / (1024 * 1024)} \\* 1024 \\* 1024`));
  });
});

describe('formato de grabación', () => {
  it('elige el primer formato que el navegador soporta', () => {
    assert.equal(pickRecordingMime((m) => m === 'audio/webm;codecs=opus'), 'audio/webm;codecs=opus');
    // Safari: solo MP4.
    assert.equal(pickRecordingMime((m) => m.startsWith('audio/mp4')), 'audio/mp4;codecs=mp4a.40.2');
    assert.equal(pickRecordingMime((m) => m === 'audio/mp4'), 'audio/mp4');
  });

  it('devuelve vacío si no hay ninguno o no hay función (el navegador elige)', () => {
    assert.equal(pickRecordingMime(() => false), '');
    assert.equal(pickRecordingMime(undefined), '');
    assert.equal(pickRecordingMime(null), '');
  });

  it('la extensión sale del tipo y nunca falla', () => {
    assert.equal(extensionFor('audio/webm;codecs=opus'), 'webm');
    assert.equal(extensionFor('audio/mp4'), 'm4a');
    assert.equal(extensionFor('audio/x-m4a'), 'm4a');
    assert.equal(extensionFor('audio/ogg;codecs=opus'), 'ogg');
    assert.equal(extensionFor('audio/wav'), 'wav');
    assert.equal(extensionFor(undefined), 'webm');
    assert.equal(extensionFor(''), 'webm');
  });
});

describe('duración', () => {
  it('formatea mm:ss', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(999), '0:01');
    assert.equal(formatDuration(5000), '0:05');
    assert.equal(formatDuration(65_000), '1:05');
    assert.equal(formatDuration(120_000), '2:00');
  });

  it('nunca devuelve NaN ni negativos', () => {
    for (const bad of [NaN, -5000, undefined, null, Infinity, 'abc']) {
      assert.match(formatDuration(bad), /^\d+:\d\d$/);
    }
    assert.equal(formatDuration(NaN), '0:00');
    assert.equal(formatDuration(-1), '0:00');
  });
});

describe('disponibilidad del micrófono', () => {
  const ok = { isSecureContext: true, hasMediaRecorder: true, hasGetUserMedia: true };

  it('disponible con contexto seguro, MediaRecorder y getUserMedia', () => {
    assert.equal(recordingUnavailableReason(ok), null);
  });

  it('http sin localhost: avisa que hace falta https', () => {
    assert.equal(recordingUnavailableReason({ ...ok, isSecureContext: false }), 'insecure');
  });

  it('sin MediaRecorder o sin getUserMedia: no soportado', () => {
    assert.equal(recordingUnavailableReason({ ...ok, hasMediaRecorder: false }), 'unsupported');
    assert.equal(recordingUnavailableReason({ ...ok, hasGetUserMedia: false }), 'unsupported');
    assert.equal(recordingUnavailableReason(undefined), 'unsupported');
  });
});

describe('errores', () => {
  it('traduce los errores del navegador a claves, nunca a texto técnico', () => {
    assert.equal(recordingErrorKind({ name: 'NotAllowedError' }), 'denied');
    assert.equal(recordingErrorKind({ name: 'SecurityError' }), 'denied');
    assert.equal(recordingErrorKind({ name: 'NotFoundError' }), 'noDevice');
    assert.equal(recordingErrorKind({ name: 'NotReadableError' }), 'busy');
    assert.equal(recordingErrorKind({ name: 'Otro' }), 'generic');
    assert.equal(recordingErrorKind(undefined), 'generic');
  });

  it('descarta grabaciones accidentales o demasiado grandes', () => {
    assert.equal(recordingProblem({ durationMs: MIN_VOICE_MS - 1, size: 5000 }), 'tooShort');
    assert.equal(recordingProblem({ durationMs: 3000, size: 0 }), 'tooShort');
    assert.equal(recordingProblem({ durationMs: NaN, size: 100 }), 'tooShort');
    assert.equal(recordingProblem({ durationMs: 3000, size: MAX_VOICE_BYTES + 1 }), 'tooBig');
    assert.equal(recordingProblem({ durationMs: MIN_VOICE_MS, size: 5000 }), null);
  });

  it('distingue el servidor apagado y el archivo grande; lo demás lo resuelve getErrorMessage', () => {
    assert.equal(sendErrorKind({ response: { status: 503, data: { code: 'voice_disabled' } } }), 'disabled');
    assert.equal(sendErrorKind({ response: { status: 413 } }), 'tooBig');
    assert.equal(sendErrorKind({ response: { status: 400, data: { msg: 'x' } } }), null);
    assert.equal(sendErrorKind({ response: { status: 503, data: { code: 'otro' } } }), null);
    assert.equal(sendErrorKind(new Error('red')), null);
  });
});

describe('lista de conversaciones', () => {
  it('detecta un mensaje que es solo una nota de voz', () => {
    assert.equal(isVoiceOnlyPreview({ has_audio: true, content: '' }), true);
    assert.equal(isVoiceOnlyPreview({ has_audio: true, content: 'mira' }), false);
    assert.equal(isVoiceOnlyPreview({ has_audio: false, content: '' }), false);
    assert.equal(isVoiceOnlyPreview(undefined), false);
  });
});

describe('traducciones', () => {
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

  it('español e inglés tienen exactamente las mismas claves', () => {
    assert.deepEqual(flatten(locales.es).sort(), flatten(locales.en).sort());
  });

  it('ninguna está vacía', () => {
    for (const lang of ['es', 'en']) for (const key of flatten(locales[lang])) {
      assert.ok(key.split('.').reduce((o, p) => o[p], locales[lang]).trim(), `${lang}.${key}`);
    }
  });

  it('existen todas las claves que la lógica puede emitir', () => {
    const keys = new Set(flatten(locales.es));
    for (const kind of ['denied', 'noDevice', 'busy', 'insecure', 'unsupported', 'tooShort', 'tooBig', 'disabled', 'generic', 'playback']) {
      assert.ok(keys.has(`errors.${kind}`), `errors.${kind}`);
    }
    for (const key of ['record', 'stop', 'cancel', 'discard', 'send', 'play', 'pause', 'seek', 'preview', 'recording', 'requesting', 'maxHint', 'preview_list']) {
      assert.ok(keys.has(key), key);
    }
  });

  it('cada clave `voice.*` que usan los componentes existe', () => {
    const keys = new Set(flatten(locales.es));
    const sources = [
      'src/shared/components/VoiceNotePlayer.jsx',
      'src/shared/components/VoiceRecorderBar.jsx',
      'src/features/feed/pages/Messages.jsx',
    ].map(read).join('\n');
    const used = [...sources.matchAll(/t\(\s*["`]voice\.([a-zA-Z_.]+)["`]/g)].map((m) => m[1]);
    assert.ok(used.length >= 10, 'se esperaban varias claves en uso');
    for (const key of used) assert.ok(keys.has(key), `voice.${key}`);
  });
});

describe('el interruptor', () => {
  it('apagado salvo que VITE_VOICE_ENABLED valga exactamente "true"', () => {
    const config = read('src/shared/lib/voiceConfig.js');
    assert.match(config, /VITE_VOICE_ENABLED === "true"/);
    assert.match(config, /VITE_TERO_VOICE_ENABLED === "true"/);
  });

  it('los mensajes solo muestran el micrófono con el interruptor encendido', () => {
    const page = read('src/features/feed/pages/Messages.jsx');
    assert.match(page, /VOICE_ENABLED && !draft\.trim\(\)/);
    assert.match(page, /VOICE_ENABLED && voice\.status !== "idle"/);
  });

  it('el micrófono se pide solo al empezar a grabar, nunca al montar la pantalla', () => {
    const hook = read('src/shared/hooks/useVoiceRecorder.js');
    const calls = [...hook.matchAll(/getUserMedia\(/g)].length;
    assert.equal(calls, 1);
    // …y la única llamada vive dentro de `start`, no en un efecto.
    const start = hook.slice(hook.indexOf('const start = useCallback'));
    assert.ok(start.includes('getUserMedia('));
    const beforeStart = hook.slice(0, hook.indexOf('const start = useCallback'));
    assert.ok(!beforeStart.includes('getUserMedia({'));
  });
});
