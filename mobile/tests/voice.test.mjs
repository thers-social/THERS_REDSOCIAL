// Notas de voz en la app (ADR-042): la lógica pura de `voice.ts` y su integración con el estado del
// chat. Espejo de Frontend/tests/voice.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  MAX_VOICE_BYTES,
  MAX_VOICE_SECONDS,
  MIN_VOICE_MS,
  VOICE_MESSAGES,
  formatDuration,
  isVoiceOnlyPreview,
  permissionProblem,
  recordingProblem,
  voiceAccessibilityLabel,
  voiceFileName,
  voiceMimeFor,
  voiceSendErrorMessage,
} from '../src/features/messages/voice.ts';
import {
  makePending,
  makePendingVoice,
  mergeMessages,
  setLocalState,
} from '../src/features/messages/chatState.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

describe('topes', () => {
  it('coinciden con los del servidor (backend/app/domain/media/audio.py)', () => {
    const server = read('../backend/app/domain/media/audio.py');
    assert.match(server, new RegExp(`MAX_VOICE_SECONDS = ${MAX_VOICE_SECONDS}\\b`));
    assert.match(server, new RegExp(`MAX_VOICE_UPLOAD_BYTES = ${MAX_VOICE_BYTES / (1024 * 1024)} \\* 1024 \\* 1024`));
  });

  it('coinciden con los de la web (Frontend/src/shared/lib/voice.js)', () => {
    const web = read('../Frontend/src/shared/lib/voice.js');
    assert.match(web, new RegExp(`MAX_VOICE_SECONDS = ${MAX_VOICE_SECONDS};`));
    assert.match(web, new RegExp(`MIN_VOICE_MS = ${MIN_VOICE_MS};`));
  });
});

describe('formatDuration', () => {
  it('formatea mm:ss', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(999), '0:01');
    assert.equal(formatDuration(65_000), '1:05');
    assert.equal(formatDuration(120_000), '2:00');
  });

  it('nunca devuelve NaN ni negativos', () => {
    for (const bad of [NaN, -1, undefined, null, Infinity]) assert.equal(formatDuration(bad), '0:00');
  });
});

describe('archivo de la grabación', () => {
  it('deduce el tipo y el nombre de la extensión', () => {
    assert.equal(voiceMimeFor('file:///data/cache/Audio/rec.m4a'), 'audio/mp4');
    assert.equal(voiceMimeFor('file:///x/y.webm'), 'audio/webm');
    assert.equal(voiceMimeFor('file:///x/y.3gp'), 'audio/3gpp');
    assert.equal(voiceMimeFor('file:///x/y.wav?cache=1'), 'audio/wav');
    assert.equal(voiceMimeFor('file:///x/sin-extension'), 'audio/mp4');
    assert.equal(voiceFileName('file:///x/rec.m4a'), 'nota.m4a');
    assert.equal(voiceFileName('file:///x/rec.WEBM'), 'nota.webm');
    assert.equal(voiceFileName('file:///x/raro.extensionlarga'), 'nota.m4a');
    assert.equal(voiceFileName('file:///x/'), 'nota.m4a');
  });
});

describe('problemas de la grabación', () => {
  it('descarta lo demasiado corto o demasiado grande', () => {
    assert.equal(recordingProblem({ durationMs: MIN_VOICE_MS - 1 }), 'tooShort');
    assert.equal(recordingProblem({ durationMs: NaN }), 'tooShort');
    assert.equal(recordingProblem({ durationMs: 3000, size: MAX_VOICE_BYTES + 1 }), 'tooBig');
    assert.equal(recordingProblem({ durationMs: MIN_VOICE_MS, size: 5000 }), null);
    assert.equal(recordingProblem({ durationMs: 3000 }), null);
  });

  it('distingue permiso negado (se puede volver a pedir) de bloqueado (hay que ir a Ajustes)', () => {
    assert.equal(permissionProblem({ granted: true }), null);
    assert.equal(permissionProblem({ granted: false, canAskAgain: true }), 'denied');
    assert.equal(permissionProblem({ granted: false, canAskAgain: false }), 'blocked');
    assert.equal(permissionProblem(undefined), 'denied');
  });

  it('todos los problemas tienen un texto para la persona', () => {
    for (const kind of ['denied', 'blocked', 'busy', 'tooShort', 'tooBig', 'disabled', 'generic']) {
      assert.ok(VOICE_MESSAGES[kind].trim().length > 10, kind);
    }
  });
});

describe('errores del servidor', () => {
  it('traduce el servidor apagado y el archivo grande; lo demás lo explica el propio servidor', () => {
    assert.equal(voiceSendErrorMessage({ status: 503, body: { code: 'voice_disabled' } }), VOICE_MESSAGES.disabled);
    assert.equal(voiceSendErrorMessage({ status: 413 }), VOICE_MESSAGES.tooBig);
    assert.equal(voiceSendErrorMessage({ status: 400, body: { msg: 'x' } }), null);
    assert.equal(voiceSendErrorMessage({ status: 503, body: { code: 'otro' } }), null);
    assert.equal(voiceSendErrorMessage(undefined), null);
  });
});

describe('lista de conversaciones', () => {
  it('detecta un mensaje que es solo una nota de voz', () => {
    assert.equal(isVoiceOnlyPreview({ has_audio: true, content: '' }), true);
    assert.equal(isVoiceOnlyPreview({ has_audio: true, content: 'mira' }), false);
    assert.equal(isVoiceOnlyPreview({ has_audio: false, content: '' }), false);
    assert.equal(isVoiceOnlyPreview(undefined), false);
  });

  it('la etiqueta accesible dice de quién es y cuánto dura', () => {
    assert.equal(voiceAccessibilityLabel({ mine: true, name: 'Ana', durationMs: 65_000 }), 'Nota de voz de ti, 1:05');
    assert.equal(voiceAccessibilityLabel({ mine: false, name: 'Ana', durationMs: 5000 }), 'Nota de voz de Ana, 0:05');
  });
});

describe('mensaje local con nota de voz', () => {
  const recording = { uri: 'file:///x/rec.m4a', durationMs: 4200, mime: 'audio/mp4', name: 'nota.m4a' };

  it('nace en vuelo, con la grabación a mano para reintentar y para oírla mientras viaja', () => {
    const pending = makePendingVoice('c1', 'a', 'b', recording, '');
    assert.equal(pending.local, 'sending');
    assert.equal(pending.content, '');
    assert.equal(pending.client_id, 'c1');
    assert.deepEqual(pending.localAudio, recording);
    // Se reproduce el archivo local mientras no hay URL del servidor.
    assert.deepEqual(pending.audio, { url: recording.uri, duration_ms: 4200 });
  });

  it('al fallar conserva la grabación para el reintento', () => {
    const failed = setLocalState([makePendingVoice('c1', 'a', 'b', recording, '')], 'c1', 'failed');
    assert.equal(failed[0].local, 'failed');
    assert.deepEqual(failed[0].localAudio, recording);
  });

  it('el mensaje confirmado reemplaza al local y trae la URL del servidor', () => {
    const local = makePendingVoice('c1', 'a', 'b', recording, '');
    const confirmed = {
      id: 'srv-1', sender_id: 'a', recipient_id: 'b', content: '', read: false,
      created_at: new Date().toISOString(), edited: false, client_id: 'c1',
      audio: { url: 'https://api/media/voice/abc.m4a', duration_ms: 4180 },
    };
    const merged = mergeMessages([local], [confirmed]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'srv-1');
    assert.equal(merged[0].local, undefined);
    assert.equal(merged[0].audio.url, 'https://api/media/voice/abc.m4a');
  });

  it('un mensaje de texto no tiene audio', () => {
    const text = makePending('c2', 'a', 'b', 'hola');
    assert.equal(text.audio, undefined);
    assert.equal(text.localAudio, undefined);
  });
});

describe('interruptor y permisos', () => {
  it('apagado salvo que EXPO_PUBLIC_VOICE_ENABLED valga exactamente "true"', () => {
    const config = read('src/features/messages/voiceConfig.ts');
    assert.match(config, /EXPO_PUBLIC_VOICE_ENABLED === 'true'/);
    assert.match(config, /EXPO_PUBLIC_TERO_VOICE_ENABLED === 'true'/);
  });

  it('la app declara el permiso del micrófono con un texto claro', () => {
    const app = JSON.parse(read('app.json'));
    const plugin = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-audio');
    assert.ok(plugin, 'falta expo-audio con su texto de permiso');
    assert.match(plugin[1].microphonePermission, /nota de voz/i);
  });

  it('el micrófono se pide solo al empezar a grabar', () => {
    const hook = read('src/features/messages/useVoiceRecorder.ts');
    const first = hook.indexOf('requestRecordingPermissionsAsync');
    assert.ok(first > hook.indexOf('const start = useCallback'));
    assert.equal([...hook.matchAll(/requestRecordingPermissionsAsync\(/g)].length, 1);
  });
});

describe('subida del archivo', () => {
  const api = read('src/features/messages/api.ts');
  const send = api.slice(
    api.indexOf('export async function sendVoiceMessage'),
    api.indexOf('export async function editMessage'),
  );

  it('el audio se sube como un File de expo-file-system, no como {uri, name, type}', () => {
    // El fetch de Expo SDK 57 rechaza el formato clásico de React Native con
    // «Unsupported FormDataPart implementation», y la app lo mostraba como falta de red.
    assert.ok(api.includes("import { File } from 'expo-file-system'"));
    assert.ok(send.includes('new File(recording.uri)'));
    assert.ok(!send.includes('uri: recording.uri'), 'volvió el formato {uri, name, type}');
  });

  it('el cuerpo multipart no fija Content-Type a mano (lo pone el sistema con el boundary)', () => {
    const http = read('src/shared/lib/api.ts');
    assert.ok(http.includes('body instanceof FormData'));
    assert.ok(http.includes('if (body !== undefined && !isForm)'));
  });

  it('un envío de voz no deja diagnósticos temporales', () => {
    for (const path of ['src/features/messages/useChat.ts', 'src/shared/lib/api.ts']) {
      assert.ok(!read(path).includes('TEMPORAL'), path);
    }
  });
});
