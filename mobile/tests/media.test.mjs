// Fotos y videos en la app (ADR-046): reglas puras y conexión de las pantallas. `node --test`, sin
// dependencias. La lógica pura se prueba directamente; lo que toca módulos nativos, por su código.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  MAX_IMAGE_BYTES,
  MAX_MESSAGE_IMAGES,
  MAX_POST_IMAGES,
  MAX_TERO_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  canAddVideo,
  fileNameFor,
  fitsTero,
  formatDuration,
  imageRoom,
  mediaProblem,
  resolveMimeType,
  teroImagePayload,
} from '../src/shared/media/mediaRules.ts';
import { chatBody, chatErrorMessage } from '../src/features/tero/lib/teroCards.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const image = (extra = {}) => ({ uri: 'file:///a.jpg', kind: 'image', name: 'foto.jpg', mimeType: 'image/jpeg', width: 10, height: 10, size: 1000, durationMs: null, ...extra });
const video = (extra = {}) => ({ uri: 'file:///a.mp4', kind: 'video', name: 'video.mp4', mimeType: 'video/mp4', width: 10, height: 10, size: 1000, durationMs: 5000, ...extra });

describe('límites', () => {
  it('coinciden con los del servidor', () => {
    assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
    assert.equal(MAX_VIDEO_BYTES, 25 * 1024 * 1024);
    assert.equal(MAX_VIDEO_SECONDS, 60);
    assert.equal(MAX_POST_IMAGES, 10);
    assert.equal(MAX_MESSAGE_IMAGES, 1);
  });
});

describe('qué se puede adjuntar', () => {
  it('una foto de hasta 5 MB y un video de hasta 25 MB y un minuto', () => {
    assert.equal(mediaProblem(image({ size: MAX_IMAGE_BYTES })), null);
    assert.equal(mediaProblem(video({ size: MAX_VIDEO_BYTES, durationMs: 60_000 })), null);
  });

  it('rechaza lo que pasa de los límites, con un texto claro', () => {
    assert.match(mediaProblem(image({ size: MAX_IMAGE_BYTES + 1 })), /5 MB/);
    assert.match(mediaProblem(video({ size: MAX_VIDEO_BYTES + 1 })), /25 MB/);
    assert.match(mediaProblem(video({ durationMs: 61_000 })), /60 segundos/);
  });

  it('tolera medio segundo de más en la duración y datos que el sistema no informa', () => {
    assert.equal(mediaProblem(video({ durationMs: 60_400 })), null);
    assert.equal(mediaProblem(video({ size: null, durationMs: null })), null);
    assert.equal(mediaProblem(image({ size: null })), null);
  });

  it('fotos y video son excluyentes', () => {
    assert.equal(canAddVideo([]), true);
    assert.equal(canAddVideo([image()]), false);
    assert.equal(canAddVideo([video()]), false);
    assert.equal(imageRoom(4, [image(), image()]), 2);
    assert.equal(imageRoom(4, [video()]), 0);
    assert.equal(imageRoom(1, [image()]), 0);
    assert.equal(imageRoom(4, []), 4);
  });
});

describe('tipo de archivo', () => {
  it('usa el que informa el sistema si es admitido', () => {
    assert.equal(resolveMimeType('image', 'image/png', 'file:///x'), 'image/png');
    assert.equal(resolveMimeType('video', 'video/quicktime', 'file:///x'), 'video/quicktime');
  });

  it('lo deduce de la extensión si el sistema no lo informa', () => {
    assert.equal(resolveMimeType('image', null, 'file:///a/b.PNG?x=1'), 'image/png');
    assert.equal(resolveMimeType('image', 'image/*', 'file:///a/b.jpeg'), 'image/jpeg');
    assert.equal(resolveMimeType('video', undefined, 'file:///a/b.webm'), 'video/webm');
  });

  it('por defecto, JPEG para fotos y MP4 para videos (el servidor decide por el contenido)', () => {
    assert.equal(resolveMimeType('image', null, 'content://media/123'), 'image/jpeg');
    assert.equal(resolveMimeType('video', null, 'content://media/123'), 'video/mp4');
  });

  it('el nombre del archivo coincide con su tipo', () => {
    assert.equal(fileNameFor('image', 'image/png'), 'foto.png');
    assert.equal(fileNameFor('video', 'video/quicktime'), 'video.mov');
    assert.equal(fileNameFor('video', 'video/desconocido'), 'video.mp4');
  });
});

describe('duración', () => {
  it('se muestra como m:ss', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(7400), '0:07');
    assert.equal(formatDuration(60_000), '1:00');
    assert.equal(formatDuration(null), '0:00');
  });
});

describe('Tero con una imagen', () => {
  it('lo que se manda es {media_type, data} y solo si hay imagen', () => {
    const payload = teroImagePayload('QUJD', 'image/jpeg');
    assert.deepEqual(payload, { media_type: 'image/jpeg', data: 'QUJD' });
    assert.deepEqual(chatBody('hola', { screen: 'tero' }, [], payload).image, payload);
    assert.equal('image' in chatBody('hola', { screen: 'tero' }, []), false);
  });

  it('con imagen el texto puede ir vacío', () => {
    assert.equal(chatBody('', { screen: 'tero' }, [], teroImagePayload('QQ==', 'image/png')).message, '');
  });

  it('una imagen demasiado grande no se manda', () => {
    const small = 'A'.repeat(1000);
    const big = 'A'.repeat(Math.ceil((MAX_TERO_IMAGE_BYTES * 4) / 3) + 100);
    assert.equal(fitsTero(small), true);
    assert.equal(fitsTero(big), false);
  });

  it('distingue el interruptor de imágenes apagado en el servidor', () => {
    const off = { status: 503, body: { code: 'tero_images_disabled' } };
    assert.match(chatErrorMessage(off), /todavía no puede ver imágenes/);
    assert.match(chatErrorMessage({ status: 503, body: { code: 'tero_disabled' } }), /no está disponible en este momento/);
  });
});

describe('los interruptores', () => {
  const config = read('src/shared/media/mediaConfig.ts');

  it('video y Tero con imágenes están apagados salvo que valgan exactamente "true"', () => {
    assert.match(config, /EXPO_PUBLIC_VIDEO_ENABLED === 'true'/);
    assert.match(config, /EXPO_PUBLIC_TERO_IMAGES_ENABLED === 'true'/);
    assert.match(read('.env.example'), /^EXPO_PUBLIC_VIDEO_ENABLED=false$/m);
    assert.match(read('.env.example'), /^EXPO_PUBLIC_TERO_IMAGES_ENABLED=false$/m);
  });

  it('el botón de video y el de imagen para Tero solo existen con su interruptor', () => {
    assert.match(read('src/shared/media/MediaAttachmentBar.tsx'), /VIDEO_ENABLED && allowVideo/);
    assert.match(read('app/tero/chat.tsx'), /TERO_IMAGES_ENABLED \? \(/);
  });
});

describe('las pantallas', () => {
  it('publicar manda fotos en `images` y el video en `video`, y es JSON si no hay archivos', () => {
    const api = read('src/features/posts/api.ts');
    assert.match(api, /item\.kind === 'video' \? 'video' : 'images'/);
    assert.match(api, /if \(media\.length === 0\)/);
    assert.match(read('src/features/posts/Composer.tsx'), /trimmed\.length > 0 \|\| media\.items\.length > 0/);
  });

  it('el chat manda una foto o un video y los muestra, también los que aún no se confirman', () => {
    assert.match(read('src/features/messages/api.ts'), /sendMediaMessage/);
    assert.match(read('src/features/messages/useChat.ts'), /target\.localMedia/);
    const chat = read('src/features/messages/ChatScreen.tsx');
    assert.match(chat, /<ImageGridView images=\{message\.images\}/);
    assert.match(chat, /<VideoPlayerView video=\{message\.video\}/);
    assert.match(chat, /Enviando video…/);
  });

  it('las publicaciones sensibles ocultan también sus fotos y su video', () => {
    const card = read('src/features/posts/PostCard.tsx');
    assert.match(card, /\{!hidden \? \(\s*<>\s*<ImageGridView/);
  });

  it('la foto de perfil se cambia y se quita desde la edición del perfil', () => {
    assert.match(read('src/features/settings/api.ts'), /appendMedia\(form, 'file', media\)/);
    assert.match(read('src/features/settings/api.ts'), /'\/users\/me\/avatar'/);
    assert.match(read('src/shared/ui/EditProfileModal.tsx'), /editProfile.photo.change/);
  });

  it('el panel del negocio sube y quita la imagen del lugar', () => {
    assert.match(read('src/features/places/api.ts'), /\/places\/\$\{placeId\}\/manage\/image/);
    assert.match(read('app/places/manage/[id].tsx'), /<ManageImage/);
  });

  it('el reproductor no carga el video hasta que se toca y reserva su espacio', () => {
    const player = read('src/shared/media/VideoPlayerView.tsx');
    assert.match(player, /useState\(false\)/);
    assert.match(player, /aspectRatio: ratio/);
    assert.match(player, /thumbnail_url/);
  });

  it('publicaciones, chat y perfil usan solo la galería; la cámara es solo para historias', () => {
    const picker = read('src/shared/media/pickMedia.ts');
    assert.match(picker, /launchImageLibraryAsync/);
    assert.doesNotMatch(picker, /launchCameraAsync|requestCameraPermissions/);
    // La cámara está únicamente en la hoja de «Crear» del botón central (historias, ADR-054 / ADR-046 enmienda).
    assert.match(read('src/features/stories/CreateSheet.tsx'), /launchCameraAsync/);
    const app = JSON.parse(read('app.json'));
    const plugin = app.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-image-picker');
    assert.ok(plugin, 'falta el plugin de expo-image-picker');
    // Con `false` Android quita CAMERA del manifiesto y la cámara de historias no podría abrirse: lleva el texto de uso.
    assert.equal(typeof plugin[1].cameraPermission, 'string');
    assert.ok(plugin[1].cameraPermission.length > 20);
    // OJO: `microphonePermission: false` quitaría RECORD_AUDIO de TODA la app (notas de voz y dictado, ADR-042).
    assert.equal('microphonePermission' in plugin[1], false);
  });

  it('la subida usa un File de expo-file-system, no el formato {uri, name, type}', () => {
    const form = read('src/shared/media/mediaForm.ts');
    assert.match(form, /new File\(media\.uri\) as unknown as Blob/);
    assert.doesNotMatch(form, /\{\s*uri:/);
  });
});
