// Reels en la web (ADR-043, ADR-043-A). Sin dependencias: `node --test`. Las funciones puras se
// importan; los componentes se comprueban leyendo el código fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  MAX_FILE_BYTES,
  canPlay,
  isInProgress,
  isModuleOff,
  makeIdempotencyKey,
  mergeVideos,
  statusText,
  uploadErrorMessage,
  validateCaption,
  validateDuration,
  validateFile,
} from '../src/features/videos/lib/reelsLogic.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const page = read('src/features/videos/pages/Reels.jsx');
const player = read('src/features/videos/components/ReelPlayer.jsx');
const api = read('src/features/videos/lib/videosApi.js');
const videosRoute = read('src/features/feed/pages/Videos.jsx');

describe('validación del archivo (comodidad: el servidor lo repite)', () => {
  const video = (over = {}) => ({ type: 'video/mp4', size: 1000, ...over });

  it('acepta un video normal', () => assert.equal(validateFile(video()), null));
  it('rechaza lo que no es video, lo vacío y lo enorme', () => {
    assert.ok(validateFile(null));
    assert.ok(validateFile(video({ type: 'image/png' })));
    assert.ok(validateFile(video({ type: '' })));
    assert.ok(validateFile(video({ size: 0 })));
    assert.ok(validateFile(video({ size: MAX_FILE_BYTES + 1 })));
    assert.equal(validateFile(video({ size: MAX_FILE_BYTES })), null);
  });

  it('la duración máxima es de 60 segundos', () => {
    assert.equal(validateDuration(60), null);
    assert.ok(validateDuration(60.1));
    for (const bad of [0, -1, NaN, Infinity, undefined]) assert.ok(validateDuration(bad), String(bad));
  });

  it('el texto admite hasta 200 caracteres', () => {
    assert.equal(validateCaption('x'.repeat(200)), null);
    assert.ok(validateCaption('x'.repeat(201)));
    assert.equal(validateCaption(undefined), null);
  });
});

describe('estados', () => {
  it('describe cada paso y la espera de la revisión', () => {
    assert.match(statusText({ status: 'uploading' }), /Subiendo/);
    assert.match(statusText({ status: 'processing' }), /Procesando/);
    assert.match(statusText({ status: 'ready', moderation_status: 'pending' }), /En revisión/);
    assert.match(statusText({ status: 'ready', moderation_status: 'held' }), /En revisión/);
    assert.equal(statusText({ status: 'ready', moderation_status: 'approved' }), 'Publicado');
    assert.match(statusText({ status: 'ready', moderation_status: 'rejected' }), /No se aprobó/);
  });

  it('explica por qué falló', () => {
    assert.match(statusText({ status: 'blocked', failure_reason: 'duration_exceeded' }), /60 segundos/);
    assert.match(statusText({ status: 'failed', failure_reason: 'asset_errored' }), /otro archivo/);
    assert.equal(statusText({ status: 'failed', failure_reason: 'desconocido' }), 'No se pudo procesar');
    assert.equal(statusText(null), '');
  });

  it('solo consulta mientras no haya un estado final', () => {
    for (const s of ['pending', 'uploading', 'processing']) assert.equal(isInProgress({ status: s }), true);
    for (const s of ['ready', 'failed', 'blocked']) assert.equal(isInProgress({ status: s }), false);
    assert.equal(isInProgress(undefined), false);
  });

  it('solo se reproduce con la reproducción firmada que entrega el servidor', () => {
    assert.equal(canPlay({ playback: { hls_url: 'https://x/y.m3u8?token=t' } }), true);
    assert.equal(canPlay({ playback: null }), false);
    assert.equal(canPlay({ status: 'ready' }), false);
    assert.equal(canPlay(null), false);
  });
});

describe('errores y claves', () => {
  it('traduce los códigos de la API sin mostrar detalles internos', () => {
    assert.match(uploadErrorMessage({ response: { status: 404 } }), /no está disponible para tu cuenta/);
    assert.match(uploadErrorMessage({ response: { status: 429 } }), /límite/);
    assert.match(uploadErrorMessage({ response: { status: 503 } }), /servicio de video/);
    assert.equal(uploadErrorMessage({ response: { status: 400, data: { msg: 'Texto largo' } } }), 'Texto largo');
    assert.match(uploadErrorMessage(new Error('boom')), /No se pudo subir/);
    assert.ok(!/boom/.test(uploadErrorMessage(new Error('boom'))));
  });

  it('un 404 significa módulo apagado', () => {
    assert.equal(isModuleOff({ response: { status: 404 } }), true);
    assert.equal(isModuleOff({ response: { status: 500 } }), false);
    assert.equal(isModuleOff(undefined), false);
  });

  it('la clave de idempotencia es válida para el servidor y distinta cada vez', () => {
    const a = makeIdempotencyKey();
    const b = makeIdempotencyKey(() => 0.123456, () => 99);
    assert.match(a, /^[A-Za-z0-9_-]{1,80}$/);
    assert.match(b, /^[A-Za-z0-9_-]{1,80}$/);
    assert.notEqual(a, makeIdempotencyKey());
  });

  it('mezclar páginas no duplica videos', () => {
    assert.deepEqual(mergeVideos([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]).map((v) => v.id), [1, 2, 3]);
  });
});

describe('seguridad y comportamiento de la pantalla', () => {
  it('con el módulo apagado (404) muestra «Próximamente»', () => {
    assert.match(page, /state === "off"\) return <ComingSoon/);
    assert.match(page, /llegará pronto/);
  });

  it('declara que la subida pública sigue bloqueada por D3 y que el servidor decide', () => {
    assert.match(page, /D3/);
    assert.match(page, /el servidor lo comprueba siempre/);
  });

  it('oculta el panel de subida si el servidor dice que la cuenta no puede subir', () => {
    assert.match(page, /status === 404\) setUnavailable\(true\)/);
    assert.match(page, /if \(unavailable\) return null/);
  });

  it('sube directo a Mux, sin mandar el JWT de THERS a otro dominio', () => {
    assert.match(api, /request\.open\("PUT", uploadUrl\)/);
    assert.ok(!/setRequestHeader/.test(api), 'no debe añadir encabezados al PUT a Mux');
    assert.match(api, /"Idempotency-Key": idempotencyKey/);
  });

  it('reproduce HLS nativo en Safari y hls.js bajo demanda en el resto', () => {
    assert.match(player, /application\/vnd\.apple\.mpegurl/);
    assert.match(player, /import\("hls\.js"\)/);
    assert.ok(!/^import .*hls\.js/m.test(player), 'hls.js no debe entrar en el paquete principal');
  });

  it('libera el reproductor y avisa cuando el token vence', () => {
    assert.match(player, /hls\.destroy\(\)/);
    assert.match(player, /\[401, 403\]\.includes/);
    assert.match(player, /onExpired/);
  });

  it('la ruta /videos usa Reels y no dibuja nada que el servidor no haya entregado', () => {
    assert.match(videosRoute, /<Reels \/>/);
    assert.match(page, /canPlay\(video\) \?/);
    assert.ok(!/storage_key|mux_/.test(page + player + api), 'no debe leer identificadores de Mux');
  });
});
