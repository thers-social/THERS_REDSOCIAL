// Pruebas de las colecciones de Cápsulas. Sin dependencias: `node --test`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COLLECTIONS, filterCapsules, isCollection } from '../src/features/feed/lib/capsuleCollections.js';

const capsule = (id, authorId, followStatus = null) => ({
  id,
  author: { id: authorId, follow_status: followStatus },
});

const CAPSULES = [
  capsule('1', 'me'),
  capsule('2', 'ana', 'accepted'),
  capsule('3', 'luis', 'pending'),
  capsule('4', 'eva'),
];

describe('filterCapsules', () => {
  it('«all» devuelve todo en el mismo orden', () => {
    assert.deepEqual(filterCapsules(CAPSULES, 'all', 'me').map((c) => c.id), ['1', '2', '3', '4']);
  });

  it('«following» solo incluye seguimientos aceptados, no solicitudes pendientes', () => {
    assert.deepEqual(filterCapsules(CAPSULES, 'following', 'me').map((c) => c.id), ['2']);
  });

  it('«mine» incluye solo lo publicado por la persona actual', () => {
    assert.deepEqual(filterCapsules(CAPSULES, 'mine', 'me').map((c) => c.id), ['1']);
  });

  it('«mine» sin sesión no devuelve nada', () => {
    assert.deepEqual(filterCapsules(CAPSULES, 'mine', undefined), []);
  });

  it('una entrada que no es lista no rompe', () => {
    assert.deepEqual(filterCapsules(null, 'all', 'me'), []);
  });

  it('tolera publicaciones sin autor', () => {
    assert.deepEqual(filterCapsules([{ id: 'x' }], 'following', 'me'), []);
  });
});

describe('isCollection', () => {
  it('reconoce solo los ids definidos', () => {
    for (const collection of COLLECTIONS) assert.equal(isCollection(collection.id), true);
    assert.equal(isCollection('saved'), false);
    assert.equal(isCollection(null), false);
  });
});
