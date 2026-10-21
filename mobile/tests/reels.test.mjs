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
  formatCount,
  withLike,
  withSaved,
  reelUrl,
  commentErrorMessage,
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

describe('lógica de la pantalla completa (ADR-055)', () => {
  it('formatea contadores compactos', () => {
    assert.equal(formatCount(undefined), '0');
    assert.equal(formatCount(999), '999');
    assert.equal(formatCount(1200), '1.2K');
    assert.equal(formatCount(3_400_000), '3.4M');
  });

  it('dar y quitar me gusta cambia el contador una sola vez', () => {
    const v = { id: 'a', liked_by_me: false, likes_count: 3 };
    const liked = withLike(v, true);
    assert.deepEqual([liked.liked_by_me, liked.likes_count], [true, 4]);
    assert.equal(withLike(liked, true), liked);
    assert.equal(withLike(liked, false).likes_count, 3);
  });

  it('guardar no toca contadores y el enlace apunta al Reel', () => {
    assert.equal(withSaved({ id: 'a', saved_by_me: false }, true).saved_by_me, true);
    assert.equal(reelUrl('https://x.test', 'a b'), 'https://x.test/videos?v=a%20b');
  });

  it('traduce los errores de comentar', () => {
    assert.match(commentErrorMessage(429), /muy rápido/);
    assert.match(commentErrorMessage(404), /ya no está disponible/);
    assert.equal(commentErrorMessage(400, 'Escribe algo'), 'Escribe algo');
  });
});

describe('la pantalla y el cliente', () => {
  const screen = read('app/(tabs)/reels.tsx');
  const slide = read('src/features/videos/ReelSlide.tsx');
  const api = read('src/features/videos/api.ts');

  it('con el módulo apagado (404) muestra «Próximamente» como antes', () => {
    assert.match(screen, /e\.status === 404 \? 'off'/);
    assert.match(screen, /llegará pronto/);
  });

  it('es un feed vertical a pantalla completa, un Reel por pantalla', () => {
    assert.match(screen, /pagingEnabled/);
    assert.match(screen, /snapToInterval=\{height\}/);
  });

  it('solo hay reproductores para el Reel activo y sus vecinos', () => {
    assert.match(screen, /Math\.abs\(index - active\) <= 1/);
    assert.match(slide, /near && playable/);
  });

  it('sube directo a Mux sin mandar el JWT de THERS a otro dominio', () => {
    assert.match(api, /uploadAsync\(uploadUrl, fileUri/);
    assert.match(api, /httpMethod: 'PUT'/);
    assert.ok(!/Authorization/.test(api));
    assert.match(api, /idempotency_key: idempotencyKey/);
  });

  it('no lee identificadores de Mux ni claves de almacenamiento', () => {
    assert.ok(!/storage_key|mux_/.test(screen + api + slide));
  });
});
