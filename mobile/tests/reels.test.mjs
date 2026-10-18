// Pruebas de la lógica de Reels de la app (ADR-043, ADR-043-A). Sin red ni dispositivo; el
// reproductor nativo (`expo-video`) NO se prueba aquí: exige recompilar y un teléfono.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  MAX_FILE_BYTES,
  canPlay,
  isInProgress,
  makeIdempotencyKey,
  mergeVideos,
  statusText,
  uploadErrorMessage,
  validateCaption,
  validatePicked,
} from '../src/features/videos/reelsLogic.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

describe('validación del archivo elegido (comodidad: el servidor lo repite)', () => {
  it('acepta un video normal y uno sin datos opcionales', () => {
    assert.equal(validatePicked({ size: 1000, mimeType: 'video/mp4', duration: 30000 }), null);
    assert.equal(validatePicked({}), null);
  });

  it('rechaza lo vacío, lo enorme, lo que no es video y lo largo', () => {
    assert.ok(validatePicked(null));
    assert.ok(validatePicked({ size: 0 }));
    assert.ok(validatePicked({ size: MAX_FILE_BYTES + 1 }));
    assert.equal(validatePicked({ size: MAX_FILE_BYTES }), null);
    assert.ok(validatePicked({ mimeType: 'image/png' }));
    assert.equal(validatePicked({ duration: 60000 }), null);
    assert.ok(validatePicked({ duration: 60001 }));
  });

  it('el texto admite hasta 200 caracteres', () => {
    assert.equal(validateCaption('x'.repeat(200)), null);
    assert.ok(validateCaption('x'.repeat(201)));
  });
});

describe('estados', () => {
  it('describe cada paso y la espera de la revisión', () => {
    assert.match(statusText({ status: 'uploading' }), /Subiendo/);
    assert.match(statusText({ status: 'processing' }), /Procesando/);
    assert.match(statusText({ status: 'ready', moderation_status: 'pending' }), /En revisión/);
    assert.equal(statusText({ status: 'ready', moderation_status: 'approved' }), 'Publicado');
    assert.match(statusText({ status: 'ready', moderation_status: 'rejected' }), /No se aprobó/);
  });

  it('explica por qué falló y no rompe con un motivo desconocido', () => {
    assert.match(statusText({ status: 'blocked', failure_reason: 'duration_exceeded' }), /60 segundos/);
    assert.equal(statusText({ status: 'failed', failure_reason: 'nuevo' }), 'No se pudo procesar');
    assert.equal(statusText(null), '');
    assert.equal(statusText({}), '');
  });

  it('solo consulta mientras no haya un estado final', () => {
    for (const s of ['pending', 'uploading', 'processing']) assert.equal(isInProgress({ status: s }), true);
    for (const s of ['ready', 'failed', 'blocked']) assert.equal(isInProgress({ status: s }), false);
    assert.equal(isInProgress(undefined), false);
  });

  it('solo se reproduce con la reproducción firmada del servidor', () => {
    assert.equal(canPlay({ playback: { hls_url: 'https://x/y.m3u8?token=t', expires_in: 3600 } }), true);
    assert.equal(canPlay({ playback: null }), false);
    assert.equal(canPlay(null), false);
  });
});

describe('errores, claves y listas', () => {
  it('traduce los códigos de la API sin mostrar detalles internos', () => {
    assert.match(uploadErrorMessage(404), /no está disponible para tu cuenta/);
    assert.match(uploadErrorMessage(429), /límite/);
    assert.match(uploadErrorMessage(503), /servicio de video/);
    assert.equal(uploadErrorMessage(400, 'Texto largo'), 'Texto largo');
    assert.match(uploadErrorMessage(500, 'stack trace secreto'), /No se pudo subir/);
    assert.ok(!/secreto/.test(uploadErrorMessage(500, 'stack trace secreto')));
  });

  it('la clave de idempotencia es válida para el servidor y distinta cada vez', () => {
    const a = makeIdempotencyKey();
    assert.match(a, /^[A-Za-z0-9_-]{1,80}$/);
    assert.match(makeIdempotencyKey(() => 0.5, () => 1), /^[A-Za-z0-9_-]{1,80}$/);
    assert.notEqual(a, makeIdempotencyKey());
  });

  it('mezclar páginas no duplica videos', () => {
    assert.deepEqual(mergeVideos([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((v) => v.id), ['a', 'b', 'c']);
  });
});

describe('la pantalla y el cliente', () => {
  const screen = read('app/(tabs)/reels.tsx');
  const api = read('src/features/videos/api.ts');
  const player = read('src/features/videos/ReelPlayer.tsx');

  it('con el módulo apagado (404) muestra «Próximamente» como antes', () => {
    assert.match(screen, /e\.status === 404 \? 'off'/);
    assert.match(screen, /llegará pronto/);
  });

  it('oculta la subida si el servidor dice que la cuenta no puede subir (D3)', () => {
    assert.match(screen, /D3/);
    assert.match(screen, /setUploadUnavailable\(true\)/);
    assert.match(screen, /!uploadUnavailable/);
  });

  it('sube directo a Mux sin mandar el JWT de THERS a otro dominio', () => {
    assert.match(api, /fetch\(uploadUrl, \{ method: 'PUT', body: file \}\)/);
    assert.ok(!/Authorization/.test(api));
    assert.match(api, /idempotency_key: idempotencyKey/);
  });

  it('el reproductor solo se monta al pulsar «Reproducir» y declara que no se probó en teléfono', () => {
    assert.match(screen, /playing === item\.id/);
    assert.match(player, /NO se ha probado en un teléfono/);
  });

  it('no lee identificadores de Mux ni claves de almacenamiento', () => {
    assert.ok(!/storage_key|mux_/.test(screen + api + player));
  });
});
