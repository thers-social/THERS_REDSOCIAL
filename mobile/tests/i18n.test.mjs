import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from '../src/shared/i18n/locales/en.ts';
import { es } from '../src/shared/i18n/locales/es.ts';
import { detectLanguage, interpolate, translateFrom } from '../src/shared/i18n/translate.ts';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('idiomas', () => {
  it('inglés y español tienen exactamente las mismas claves', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  });

  it('cada clave usa los mismos {parámetros} en los dos idiomas', () => {
    for (const key of Object.keys(es)) {
      assert.deepEqual(placeholders(en[key]), placeholders(es[key]), key);
    }
  });

  it('interpola y deja visible el parámetro que falta', () => {
    assert.equal(interpolate('Hola {name}', { name: 'Ana' }), 'Hola Ana');
    assert.equal(interpolate('Hola {name}', {}), 'Hola {name}');
  });

  it('si falta la traducción cae al español y luego a la clave', () => {
    const dictionaries = { es: { a: 'uno' }, en: {} };
    assert.equal(translateFrom(dictionaries, 'en', 'a'), 'uno');
    assert.equal(translateFrom(dictionaries, 'en', 'zzz'), 'zzz');
  });

  it('detecta el inglés del teléfono y el resto queda en español', () => {
    assert.equal(detectLanguage('en-US'), 'en');
    assert.equal(detectLanguage('es-SV'), 'es');
    assert.equal(detectLanguage('fr-FR'), 'es');
    assert.equal(detectLanguage(null), 'es');
  });
});
