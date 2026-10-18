// Pruebas de la lógica del visor de historias de la app.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  STORY_DURATION_MS,
  barFill,
  firstUnseenIndex,
  nextPosition,
  previousPosition,
} from '../src/features/stories/storyProgress.ts';

describe('firstUnseenIndex', () => {
  it('abre la primera historia sin ver', () => {
    assert.equal(firstUnseenIndex([{ seen_by_me: true }, { seen_by_me: false }, {}]), 1);
  });
  it('si ya las viste todas, vuelve a la primera', () => {
    assert.equal(firstUnseenIndex([{ seen_by_me: true }, { seen_by_me: true }]), 0);
  });
  it('una lista vacía da 0', () => {
    assert.equal(firstUnseenIndex([]), 0);
  });
});

describe('nextPosition', () => {
  const counts = [2, 1];
  it('avanza dentro de la misma persona', () => {
    assert.deepEqual(nextPosition({ authorIndex: 0, storyIndex: 0 }, counts), { authorIndex: 0, storyIndex: 1 });
  });
  it('pasa a la siguiente persona al terminar las suyas', () => {
    assert.deepEqual(nextPosition({ authorIndex: 0, storyIndex: 1 }, counts), { authorIndex: 1, storyIndex: 0 });
  });
  it('devuelve null al terminar todo', () => {
    assert.equal(nextPosition({ authorIndex: 1, storyIndex: 0 }, counts), null);
  });
});

describe('previousPosition', () => {
  const counts = [2, 3];
  it('retrocede dentro de la misma persona', () => {
    assert.deepEqual(previousPosition({ authorIndex: 1, storyIndex: 2 }, counts), { authorIndex: 1, storyIndex: 1 });
  });
  it('vuelve a la última historia de la persona anterior', () => {
    assert.deepEqual(previousPosition({ authorIndex: 1, storyIndex: 0 }, counts), { authorIndex: 0, storyIndex: 1 });
  });
  it('en la primera de todas se queda donde está', () => {
    assert.deepEqual(previousPosition({ authorIndex: 0, storyIndex: 0 }, counts), { authorIndex: 0, storyIndex: 0 });
  });
});

describe('barFill', () => {
  it('llena las anteriores, vacía las siguientes y avanza la actual', () => {
    assert.equal(barFill(0, 1, 0), 1);
    assert.equal(barFill(2, 1, 0), 0);
    assert.equal(barFill(1, 1, STORY_DURATION_MS / 2), 0.5);
  });
  it('nunca pasa de 1 ni baja de 0', () => {
    assert.equal(barFill(1, 1, STORY_DURATION_MS * 3), 1);
    assert.equal(barFill(1, 1, -50), 0);
  });
});
