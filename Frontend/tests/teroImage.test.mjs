// Preguntas a Tero con una imagen en la web (ADR-046): forma de la petición, errores, interruptor y
// conexión con el panel. `node --test`, sin dependencias.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import { chatBody, chatErrorKind } from '../src/features/tero/lib/teroChat.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const dict = {
  es: JSON.parse(read('src/shared/i18n/locales/es.json')).tero,
  en: JSON.parse(read('src/shared/i18n/locales/en.json')).tero,
};

describe('la petición', () => {
  const image = { media_type: 'image/jpeg', data: 'AAAA' };

  it('lleva la imagen en el campo `image` solo si hay una', () => {
    assert.deepEqual(chatBody('hola', { screen: 'home' }, [], image).image, image);
    assert.equal('image' in chatBody('hola', { screen: 'home' }, []), false);
    assert.equal('image' in chatBody('hola', { screen: 'home' }, [], null), false);
  });

  it('con imagen el texto puede ir vacío (el servidor pregunta qué se ve)', () => {
    assert.equal(chatBody('', { screen: 'home' }, [], image).message, '');
  });
});

describe('errores', () => {
  it('distingue el interruptor de imágenes apagado del módulo apagado', () => {
    const error = (code) => ({ status: 503, body: { code } });
    assert.equal(chatErrorKind(error('tero_images_disabled')), 'imagesDisabled');
    assert.equal(chatErrorKind(error('tero_disabled')), 'disabled');
    assert.equal(chatErrorKind(error('otro')), 'unavailable');
  });
});

describe('el interruptor', () => {
  it('está apagado salvo que VITE_TERO_IMAGES_ENABLED valga exactamente "true"', () => {
    assert.match(read('src/features/tero/lib/teroImage.js'), /VITE_TERO_IMAGES_ENABLED === "true"/);
    assert.match(read('.env.example'), /^VITE_TERO_IMAGES_ENABLED=false$/m);
  });

  it('el botón de imagen solo existe con el interruptor encendido', () => {
    assert.match(read('src/features/tero/components/TeroChatPanel.jsx'), /TERO_IMAGES_ENABLED \? \(/);
  });
});

describe('el panel', () => {
  const panel = read('src/features/tero/components/TeroChatPanel.jsx');

  it('adjunta una sola imagen y la quita antes de enviar si la persona quiere', () => {
    assert.match(panel, /disabled=\{pending \|\| preparing \|\| attached !== null\}/);
    assert.match(panel, /setAttached\(null\)/);
  });

  it('se puede enviar solo la imagen, sin texto', () => {
    assert.match(panel, /\(!draft\.trim\(\) && !attached\)/);
  });

  it('avisa de que la imagen sale a Anthropic y que THERS no la guarda', () => {
    assert.match(panel, /tero\.image\.privacy/);
    for (const lang of ['es', 'en']) assert.match(dict[lang].image.privacy, /Anthropic/);
    assert.match(dict.es.image.privacy, /no la guarda/);
  });

  it('reintentar un mensaje fallido vuelve a mandar su imagen', () => {
    assert.match(panel, /image: message\.image \?\? null/);
    assert.match(read('src/features/tero/hooks/useTeroChat.js'), /item\.id === userId\)\?\.image/);
  });

  it('el historial no arrastra la imagen: solo texto', () => {
    const chat = read('src/features/tero/lib/teroChat.js');
    const start = chat.indexOf('export function historyForRequest');
    const body = chat.slice(start, chat.indexOf('\nexport ', start + 10));
    assert.ok(body.length > 50);
    assert.doesNotMatch(body, /\.image/);
  });

  it('todas las claves de traducción existen en español e inglés', () => {
    for (const lang of ['es', 'en']) {
      for (const key of ['attach', 'preview', 'sent', 'remove', 'preparing', 'privacy', 'failed']) {
        assert.ok(dict[lang].image[key]?.length > 0, `${lang}.image.${key}`);
      }
      assert.ok(dict[lang].errors.imagesDisabled?.length > 0, `${lang}.errors.imagesDisabled`);
    }
  });
});
