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
  commentErrorMessage,
  formatClock,
  formatCount,
  mostVisibleIndex,
  progressFraction,
  reelUrl,
  seekTarget,
  withLike,
  withSaved,
} from '../src/features/videos/lib/reelsLogic.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const page = read('src/features/videos/pages/Reels.jsx');
const player = read('src/features/videos/components/ReelPlayer.jsx');
const slide = read('src/features/videos/components/ReelSlide.jsx');
const comments = read('src/features/videos/components/ReelComments.jsx');
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
    assert.match(slide, /near && playable \?/);
    assert.match(slide, /const playable = canPlay\(video\)/);
    assert.ok(!/storage_key|mux_/.test(page + player + slide + comments + api), 'no debe leer identificadores de Mux');
  });
});

describe('Reels de pantalla completa (ADR-055)', () => {
  it('abrevia los contadores', () => {
    assert.equal(formatCount(0), '0');
    assert.equal(formatCount(999), '999');
    assert.equal(formatCount(1000), '1K');
    assert.equal(formatCount(1250), '1.2K');
    assert.equal(formatCount(15_300), '15.3K');
    assert.equal(formatCount(2_000_000), '2M');
    assert.equal(formatCount(undefined), '0');
    assert.equal(formatCount(-4), '0');
  });

  it('da formato al reloj de la barra de progreso', () => {
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(7.9), '0:07');
    assert.equal(formatClock(65), '1:05');
    assert.equal(formatClock(NaN), '0:00');
  });

  it('calcula la fracción reproducida sin salirse de 0–1', () => {
    assert.equal(progressFraction(15, 60), 0.25);
    assert.equal(progressFraction(90, 60), 1);
    assert.equal(progressFraction(-3, 60), 0);
    assert.equal(progressFraction(5, NaN), 0);
    assert.equal(progressFraction(5, 0), 0);
  });

  it('adelantar y atrasar se queda dentro del video', () => {
    assert.equal(seekTarget(10, 5, 60), 15);
    assert.equal(seekTarget(3, -5, 60), 0);
    assert.equal(seekTarget(58, 5, 60), 60);
    assert.equal(seekTarget(10, 5, NaN), 15);
  });

  it('el me gusta optimista cambia estado y contador una sola vez', () => {
    const video = { liked_by_me: false, likes_count: 4 };
    const liked = withLike(video, true);
    assert.deepEqual([liked.liked_by_me, liked.likes_count], [true, 5]);
    assert.equal(withLike(liked, true), liked, 'repetir no suma de nuevo');
    const unliked = withLike(liked, false);
    assert.deepEqual([unliked.liked_by_me, unliked.likes_count], [false, 4]);
    assert.equal(withLike({ liked_by_me: false, likes_count: 0 }, false).likes_count, 0);
    assert.equal(withSaved({ saved_by_me: false }, true).saved_by_me, true);
  });

  it('el Reel activo es el más visible y solo si pasa del umbral', () => {
    assert.equal(mostVisibleIndex([{ index: 0, ratio: 0.3 }, { index: 1, ratio: 0.7 }]), 1);
    assert.equal(mostVisibleIndex([{ index: 0, ratio: 0.5 }, { index: 1, ratio: 0.5 }]), -1);
    assert.equal(mostVisibleIndex([{ index: 2, ratio: 0.6 }, { index: 3, ratio: 0.9 }]), 3);
    assert.equal(mostVisibleIndex([]), -1);
  });

  it('el enlace para compartir lleva el id codificado', () => {
    assert.equal(reelUrl('https://staging.thersweb.com', 'abc-123'), 'https://staging.thersweb.com/videos?v=abc-123');
  });

  it('explica los errores al comentar', () => {
    assert.match(commentErrorMessage({ response: { status: 429 } }), /muy rápido/);
    assert.match(commentErrorMessage({ response: { status: 404 } }), /ya no está disponible/);
    assert.equal(commentErrorMessage({ response: { status: 400, data: { msg: 'vacío' } } }), 'vacío');
    assert.match(commentErrorMessage(new Error('red')), /No se pudo publicar/);
  });

  it('un Reel ocupa todo el escenario y se engancha al desplazarse', () => {
    assert.match(page, /snap-y snap-mandatory/);
    assert.match(slide + page, /snap-start snap-always/);
    assert.match(page, /IntersectionObserver/);
  });

  it('solo el Reel activo suena y los lejanos no montan reproductor', () => {
    assert.match(page, /near=\{Math\.abs\(index - active\) <= 1\}/);
    assert.match(slide, /if \(active\) \{/);
    assert.match(slide, /el\.pause\(\)/);
  });

  it('ofrece pausa, barra para adelantar y atrasar, silencio, me gusta, guardar, comentar y compartir', () => {
    assert.match(slide, /type="range"/);
    assert.match(slide, /aria-label="Posición del video"/);
    assert.match(slide, /togglePlay/);
    assert.match(slide, /aria-label="Comentarios"|label="Comentarios"/);
    assert.match(slide, /icon="bookmark"/);
    assert.match(slide, /icon="share"/);
    assert.match(slide, /Activar sonido/);
  });

  it('el doble toque da me gusta pero nunca lo quita', () => {
    assert.match(slide, /if \(!video\.liked_by_me\) onLike\(video\)/);
  });

  it('revierte el me gusta si el servidor falla', () => {
    assert.match(page, /withLike\(v, !next\)/);
  });

  it('los comentarios se piden por la API de Reels y limitan el texto', () => {
    assert.match(comments, /MAX_COMMENT = 1000/);
    assert.match(comments, /fetchComments\(videoId/);
    assert.match(api, /`\/videos\/\$\{id\}\/comments`/);
  });
});
