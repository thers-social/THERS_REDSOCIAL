// Videos cortos en la web (ADR-046): validación en el navegador y conexión de las pantallas.
// `node --test`, sin dependencias. La lógica pura se prueba directamente; las pantallas, por su código.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

// `import.meta.env` no existe en Node: se sustituye antes de importar la lógica pura.
const source = readFileSync(new URL('../src/shared/lib/videoAttachments.js', import.meta.url), 'utf-8')
  .replace('import.meta.env.VITE_VIDEO_ENABLED', 'process.env.VITE_VIDEO_ENABLED');
const lib = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const file = (type, size = 1000) => ({ type, size });

describe('validación del video', () => {
  it('acepta MP4, MOV y WebM', () => {
    for (const type of ['video/mp4', 'video/quicktime', 'video/webm']) {
      assert.equal(lib.videoProblem(file(type)), null, type);
    }
  });

  it('rechaza lo que no es video', () => {
    for (const type of ['image/png', 'audio/mp4', 'application/pdf', '']) {
      assert.match(lib.videoProblem(file(type)), /MP4, MOV o WebM/, type);
    }
    assert.match(lib.videoProblem(null), /MP4, MOV o WebM/);
  });

  it('rechaza lo que pesa más de 25 MB', () => {
    assert.equal(lib.videoProblem(file('video/mp4', lib.MAX_VIDEO_BYTES)), null);
    assert.match(lib.videoProblem(file('video/mp4', lib.MAX_VIDEO_BYTES + 1)), /25 MB/);
  });

  it('rechaza lo que dura más de un minuto, con medio segundo de tolerancia', () => {
    assert.equal(lib.videoProblem(file('video/mp4'), 60), null);
    assert.equal(lib.videoProblem(file('video/mp4'), 60.4), null);
    assert.match(lib.videoProblem(file('video/mp4'), 61), /60 segundos/);
  });

  it('una duración desconocida no bloquea: el servidor la vuelve a medir', () => {
    assert.equal(lib.videoProblem(file('video/mp4'), null), null);
  });

  it('los límites coinciden con los del servidor', () => {
    assert.equal(lib.MAX_VIDEO_BYTES, 25 * 1024 * 1024);
    assert.equal(lib.MAX_VIDEO_SECONDS, 60);
  });

  it('formatea la duración como m:ss', () => {
    assert.equal(lib.formatVideoDuration(0), '0:00');
    assert.equal(lib.formatVideoDuration(7400), '0:07');
    assert.equal(lib.formatVideoDuration(60_000), '1:00');
    assert.equal(lib.formatVideoDuration(undefined), '0:00');
  });

  it('distingue el interruptor apagado del servidor y el archivo demasiado grande', () => {
    assert.equal(lib.videoSendErrorKind({ response: { status: 503, data: { code: 'video_disabled' } } }), 'disabled');
    assert.equal(lib.videoSendErrorKind({ response: { status: 413, data: {} } }), 'too_large');
    assert.equal(lib.videoSendErrorKind({ response: { status: 400, data: {} } }), null);
    assert.equal(lib.videoSendErrorKind(new Error('red')), null);
  });
});

describe('el interruptor', () => {
  it('está apagado salvo que VITE_VIDEO_ENABLED valga exactamente "true"', () => {
    assert.match(read('src/shared/lib/videoAttachments.js'), /VITE_VIDEO_ENABLED === "true"/);
    assert.match(read('.env.example'), /^VITE_VIDEO_ENABLED=false$/m);
  });

  it('el compositor y el chat solo ofrecen el botón con el interruptor encendido', () => {
    assert.match(read('src/features/feed/components/CreateCapsuleFlow.jsx'), /VIDEO_ENABLED && \(\s*<VideoAttachmentPicker/);
    assert.match(read('src/features/feed/pages/Messages.jsx'), /VIDEO_ENABLED && \(\s*<>/);
  });
});

describe('las pantallas', () => {
  it('publicar manda el video en el campo `video` y lo hace excluyente con las imágenes', () => {
    const shell = read('src/app/layout/AppShell.jsx');
    assert.match(shell, /body\.append\("video", video\)/);
    const flow = read('src/features/feed/components/CreateCapsuleFlow.jsx');
    assert.match(flow, /disabled=\{isSubmitting \|\| video\.file !== null\}/);
    assert.match(flow, /disabled=\{isSubmitting \|\| images\.items\.length > 0\}/);
    assert.match(flow, /onSubmit\(content\.trim\(\), isSensitive, images\.files, video\.file\)/);
  });

  it('con solo un video se puede publicar (el texto es opcional)', () => {
    assert.match(read('src/features/feed/components/CreateCapsuleFlow.jsx'), /images\.items\.length > 0 \|\| video\.file !== null/);
  });

  it('el chat manda el video, lo pinta y lo anuncia en la lista de conversaciones', () => {
    const chat = read('src/features/feed/pages/Messages.jsx');
    assert.match(chat, /body\.append\("video", video\.file\)/);
    assert.match(chat, /<VideoPlayer video=\{message\.video\}/);
    assert.match(chat, /last\.has_video/);
    // Excluyente con imágenes y nota de voz.
    assert.match(chat, /video\.file !== null \|\| image\.items\.length > 0\}/);
    assert.match(chat, /!video\.file && \(/);
  });

  it('el feed y los lugares muestran el video', () => {
    assert.match(read('src/features/feed/components/CapsuleCard.jsx'), /<VideoPlayer video=\{capsule\.video\}/);
    assert.match(read('src/features/places/components/PlacePosts.jsx'), /<VideoPlayer video=\{post\.video\}/);
  });

  it('el reproductor no descarga el video hasta que se reproduce y reserva su espacio', () => {
    const player = read('src/shared/components/VideoPlayer.jsx');
    assert.match(player, /preload="none"/);
    assert.match(player, /poster=\{video\.thumbnail_url\}/);
    assert.match(player, /aspectRatio/);
    assert.match(player, /playsInline/);
  });

  it('la vista previa se libera al quitar o al desmontar (sin fugas de memoria)', () => {
    const hook = read('src/shared/hooks/useVideoAttachment.js');
    assert.match(hook, /URL\.revokeObjectURL/);
    assert.match(hook, /useEffect\(\s*\(\) => \(\) => \{/);
  });
});

// --- Imagen que identifica a un lugar (ADR-046) ---

describe('imagen del lugar', () => {
  const es = JSON.parse(read('src/shared/i18n/locales/es.json')).places;
  const en = JSON.parse(read('src/shared/i18n/locales/en.json')).places;

  it('las traducciones del panel y de la ficha existen en español e inglés', () => {
    for (const dict of [es, en]) {
      for (const key of ['title', 'current', 'none', 'add', 'change', 'remove', 'working', 'saved', 'removed', 'hint']) {
        assert.ok(dict.manage.image[key]?.length > 0, `manage.image.${key}`);
      }
      assert.match(dict.detail.imageAlt, /\{\{name\}\}/);
    }
  });

  it('el panel lo sube con PUT multipart y lo quita con DELETE', () => {
    const api = read('src/features/places/lib/placesApi.js');
    assert.match(api, /api\.put\(`\/places\/\$\{placeId\}\/manage\/image`, form/);
    assert.match(api, /form\.append\("image", file\)/);
    assert.match(api, /api\.delete\(`\/places\/\$\{placeId\}\/manage\/image`/);
  });

  it('el panel de negocio reduce la foto antes de subirla y está en el panel', () => {
    assert.match(read('src/features/places/components/ManageImage.jsx'), /prepareImage\(file, MAX_SIDE\)/);
    assert.match(read('src/features/places/components/PlaceManagePanel.jsx'), /<ManageImage/);
  });

  it('la tarjeta y la ficha muestran la imagen cuando existe', () => {
    assert.match(read('src/features/places/components/PlaceCard.jsx'), /place\.cover_image_url \?/);
    assert.match(read('src/features/places/components/PlaceDetailPanel.jsx'), /place\.cover_image_url && \(/);
  });
});
