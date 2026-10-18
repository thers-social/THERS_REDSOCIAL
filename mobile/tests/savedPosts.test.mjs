// Guardar y compartir publicaciones en la app (ADR-047): conexión de las pantallas con el contrato.
// `node --test`, sin dependencias: se comprueba el código de las pantallas, que toca módulos nativos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

describe('cliente', () => {
  it('guardar es POST y quitar es DELETE sobre /posts/<id>/save, y la lista es /posts/saved', () => {
    const api = read('src/features/posts/api.ts');
    assert.match(api, /`\/posts\/\$\{postId\}\/save`/);
    assert.match(api, /method: saved \? 'POST' : 'DELETE'/);
    assert.match(api, /'\/posts\/saved'/);
  });

  it('compartir manda `post_id` por mensaje directo con client_id', () => {
    const api = read('src/features/messages/api.ts');
    assert.match(api, /body: \{ post_id: postId, content, client_id: clientId \}/);
    assert.match(api, /has_post\?: boolean/);
  });
});

describe('pantallas', () => {
  it('la tarjeta ya no avisa «próximamente» para guardar ni compartir', () => {
    const card = read('src/features/posts/PostCard.tsx');
    assert.doesNotMatch(card, /comingSoon/);
    assert.match(card, /toggleSave\(post\.id\)/);
    assert.match(card, /<SharePostSheet/);
    assert.match(card, /post\.saved_by_me/);
  });

  it('guardar es optimista y se revierte si el servidor rechaza', () => {
    const context = read('src/features/posts/PostsContext.tsx');
    assert.match(context, /replacePost\(\{ \.\.\.before, saved_by_me: next \}\)/);
    assert.match(context, /replacePost\(before\);\s*throw e;/);
  });

  it('el chat enseña la tarjeta de la publicación y la lista de chats la nombra', () => {
    assert.match(read('src/features/messages/ChatScreen.tsx'), /<SharedPostCard post=\{message\.post\}/);
    assert.match(read('app/(tabs)/messages.tsx'), /has_post/);
  });

  it('la tarjeta distingue no disponible y sensible, y no usa HTML', () => {
    const card = read('src/features/posts/SharedPostCard.tsx');
    assert.match(card, /!post\.available/);
    assert.match(card, /post\.is_sensitive && post\.excerpt === null/);
  });

  it('Ajustes → Guardado abre la pantalla real', () => {
    assert.match(read('app/settings/index.tsx'), /route: '\/settings\/saved'/);
    const saved = read('app/settings/saved.tsx');
    assert.match(saved, /fetchSavedPosts/);
    assert.match(saved, /setPostSaved\(post\.id, false\)/);
  });
});
