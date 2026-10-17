// Pruebas de la búsqueda local sobre las publicaciones cargadas y del formato de tiempo.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalize, searchPosts } from '../src/features/posts/searchPosts.ts';
import { formatRelativeTime } from '../src/shared/lib/time.ts';

function post(id, content, name, username, createdAt, likes = 0) {
  return {
    id,
    content,
    created_at: createdAt,
    likes_count: likes,
    author: { id: `u-${id}`, name, username },
  };
}

const POSTS = [
  post('1', 'Hola desde El Salvador', 'José Pérez', 'jose_p', '2026-10-01T10:00:00Z', 2),
  post('2', 'Receta de pupusas', 'Ana Gómez', 'ana_g', '2026-10-02T10:00:00Z', 9),
  post('3', 'Otro mensaje cualquiera', 'Luis', 'luis99', '2026-09-30T10:00:00Z', 5),
];

describe('normalize', () => {
  it('quita tildes y pasa a minúsculas', () => {
    assert.equal(normalize('  JOSÉ Pérez '), 'jose perez');
  });
});

describe('searchPosts', () => {
  it('una consulta vacía no devuelve nada (no es lo mismo que «sin resultados»)', () => {
    assert.deepEqual(searchPosts(POSTS, ''), []);
    assert.deepEqual(searchPosts(POSTS, '   '), []);
  });

  it('busca en el texto', () => {
    assert.deepEqual(searchPosts(POSTS, 'pupusas').map((p) => p.id), ['2']);
  });

  it('busca por nombre y por @usuario del autor', () => {
    assert.deepEqual(searchPosts(POSTS, 'ana').map((p) => p.id), ['2']);
    assert.deepEqual(searchPosts(POSTS, 'luis99').map((p) => p.id), ['3']);
  });

  it('no distingue tildes ni mayúsculas', () => {
    assert.deepEqual(searchPosts(POSTS, 'JOSE').map((p) => p.id), ['1']);
    assert.deepEqual(searchPosts(POSTS, 'gomez').map((p) => p.id), ['2']);
  });

  it('exige todas las palabras, en cualquier orden', () => {
    assert.deepEqual(searchPosts(POSTS, 'salvador hola').map((p) => p.id), ['1']);
    assert.deepEqual(searchPosts(POSTS, 'salvador pupusas'), []);
  });

  it('ordena por fecha o por me gusta', () => {
    assert.deepEqual(searchPosts(POSTS, 'e', 'recent').map((p) => p.id), ['2', '1', '3']);
    assert.deepEqual(searchPosts(POSTS, 'e', 'likes').map((p) => p.id), ['2', '3', '1']);
  });

  it('no modifica la lista original', () => {
    const copy = [...POSTS];
    searchPosts(POSTS, 'e', 'likes');
    assert.deepEqual(POSTS, copy);
  });
});

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-10-02T12:00:00Z');

  it('ahora, minutos, horas, ayer y días', () => {
    assert.equal(formatRelativeTime('2026-10-02T11:59:50Z', NOW), 'ahora');
    assert.equal(formatRelativeTime('2026-10-02T11:30:00Z', NOW), 'hace 30 min');
    assert.equal(formatRelativeTime('2026-10-02T09:00:00Z', NOW), 'hace 3 h');
    assert.equal(formatRelativeTime('2026-10-01T09:00:00Z', NOW), 'ayer');
    assert.equal(formatRelativeTime('2026-09-29T12:00:00Z', NOW), 'hace 3 d');
  });

  it('una fecha futura (reloj desajustado) se muestra como «ahora», no negativa', () => {
    assert.equal(formatRelativeTime('2026-10-02T13:00:00Z', NOW), 'ahora');
  });

  it('una fecha inválida devuelve vacío en vez de «NaN»', () => {
    assert.equal(formatRelativeTime('no-es-fecha', NOW), '');
  });
});

describe('filtro de fecha', () => {
  const NOW = Date.parse('2026-10-03T10:00:00Z');
  it('«any» no filtra', () => {
    assert.equal(searchPosts(POSTS, 'a', 'recent', 'any', NOW).length, searchPosts(POSTS, 'a', 'recent').length);
  });
  it('«day» deja solo lo publicado en las últimas 24 horas', () => {
    const ids = searchPosts(POSTS, 'a', 'recent', 'day', NOW).map((p) => p.id);
    assert.deepEqual(ids, ['2']);
  });
  it('«week» excluye lo más viejo que 7 días', () => {
    const old = [post('9', 'antiguo', 'Ana', 'ana', '2026-09-01T10:00:00Z'), ...POSTS];
    assert.equal(searchPosts(old, 'a', 'recent', 'week', NOW).some((p) => p.id === '9'), false);
  });
});
