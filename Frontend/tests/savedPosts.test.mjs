// Guardar y compartir publicaciones en la web (ADR-047): textos, conexión de las pantallas y reglas
// de la tarjeta. `node --test`, sin dependencias.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const dict = {
  es: JSON.parse(read('src/shared/i18n/locales/es.json')).postActions,
  en: JSON.parse(read('src/shared/i18n/locales/en.json')).postActions,
};

const leaves = (object, prefix = '') =>
  Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'object' ? leaves(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );

describe('textos', () => {
  it('español e inglés tienen exactamente las mismas claves', () => {
    assert.ok(dict.es && dict.en, 'falta el bloque postActions');
    assert.deepEqual(leaves(dict.es).sort(), leaves(dict.en).sort());
  });

  it('todas las claves usadas en el código existen', () => {
    const sources = [
      'src/features/feed/components/CapsuleCard.jsx',
      'src/features/feed/components/SharePostDialog.jsx',
      'src/features/feed/pages/Saved.jsx',
      'src/features/feed/pages/Messages.jsx',
      'src/shared/components/SharedPostCard.jsx',
      'src/app/layout/thers/Topbar.jsx',
    ].map(read);
    const known = new Set(leaves(dict.es));
    for (const source of sources) {
      for (const [, key] of source.matchAll(/t\("postActions\.([a-zA-Z.]+)"/g)) {
        assert.ok(known.has(key), `falta postActions.${key}`);
      }
    }
  });
});

describe('cliente', () => {
  const api = read('src/features/feed/lib/savedPostsApi.js');

  it('guardar es POST y quitar es DELETE sobre /posts/<id>/save', () => {
    assert.match(api, /api\.post\(`\/posts\/\$\{postId\}\/save`/);
    assert.match(api, /api\.delete\(`\/posts\/\$\{postId\}\/save`/);
    assert.match(api, /\/posts\/saved/);
  });

  it('compartir manda `post_id` por mensaje directo y el texto solo si existe', () => {
    assert.match(api, /body = \{ post_id: postId \}/);
    assert.match(api, /if \(content\) body\.content = content/);
  });
});

describe('pantallas', () => {
  it('la tarjeta ya no deja guardar ni compartir deshabilitados', () => {
    const card = read('src/features/feed/components/CapsuleCard.jsx');
    assert.doesNotMatch(card, /PendingAction/);
    assert.match(card, /handleToggleSave/);
    assert.match(card, /<SharePostDialog/);
    assert.match(card, /aria-pressed=\{saved\}/);
  });

  it('el chat enseña la tarjeta de la publicación compartida y el aviso en la lista', () => {
    const messages = read('src/features/feed/pages/Messages.jsx');
    assert.match(messages, /<SharedPostCard post=\{message\.post\}/);
    assert.match(messages, /last\.has_post/);
  });

  it('la tarjeta distingue publicación no disponible y sensible, y nunca usa HTML crudo', () => {
    const card = read('src/shared/components/SharedPostCard.jsx');
    assert.match(card, /!post\.available/);
    assert.match(card, /post\.is_sensitive && post\.excerpt === null/);
    assert.doesNotMatch(card, /dangerouslySetInnerHTML/);
  });

  it('hay ruta /saved y enlace en el menú del perfil', () => {
    assert.match(read('src/app/router/router.jsx'), /path="\/saved" element=\{<Saved \/>\}/);
    assert.match(read('src/app/layout/thers/Topbar.jsx'), /to="\/saved"/);
  });
});
