// Pruebas de las preferencias locales de Tero: valores por defecto, lectura
// tolerante de lo guardado y clave por cuenta.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampRatio,
  defaultPreferences,
  parsePreferences,
  preferencesKey,
  updatePreferences,
} from '../src/features/tero/lib/preferences.ts';

const NOW = new Date('2026-10-08T12:00:00.000Z');

describe('defaultPreferences', () => {
  it('arranca visible, a la derecha y abajo', () => {
    const prefs = defaultPreferences(NOW);
    assert.equal(prefs.version, 1);
    assert.equal(prefs.showTero, true);
    assert.equal(prefs.side, 'right');
    assert.equal(prefs.verticalRatio, 1);
    assert.equal(prefs.sounds, false);
    assert.equal(prefs.updatedAt, NOW.toISOString());
  });
});

describe('parsePreferences', () => {
  it('sin datos o con JSON roto devuelve los valores por defecto', () => {
    assert.deepEqual(parsePreferences(null, NOW), defaultPreferences(NOW));
    assert.deepEqual(parsePreferences('{no es json', NOW), defaultPreferences(NOW));
    assert.deepEqual(parsePreferences('"texto"', NOW), defaultPreferences(NOW));
  });

  it('conserva los campos válidos y repone solo los inválidos', () => {
    const raw = JSON.stringify({
      showTero: false,
      side: 'arriba',
      verticalRatio: 7,
      animations: 'sí',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    const prefs = parsePreferences(raw, NOW);
    assert.equal(prefs.showTero, false);
    assert.equal(prefs.side, 'right');
    assert.equal(prefs.verticalRatio, 1);
    assert.equal(prefs.animations, true);
    assert.equal(prefs.updatedAt, '2026-10-01T00:00:00.000Z');
  });

  it('ignora campos desconocidos (p. ej. algo sensible guardado por error)', () => {
    const prefs = parsePreferences(JSON.stringify({ side: 'left', token: 'abc' }), NOW);
    assert.equal(prefs.side, 'left');
    assert.equal('token' in prefs, false);
  });
});

describe('updatePreferences', () => {
  it('aplica el cambio, acota la altura y marca la fecha', () => {
    const later = new Date('2026-10-09T00:00:00.000Z');
    const next = updatePreferences(defaultPreferences(NOW), { side: 'left', verticalRatio: -2 }, later);
    assert.equal(next.side, 'left');
    assert.equal(next.verticalRatio, 0);
    assert.equal(next.updatedAt, later.toISOString());
  });
});

describe('clampRatio y preferencesKey', () => {
  it('acota a 0–1 y trata NaN como abajo', () => {
    assert.equal(clampRatio(0.4), 0.4);
    assert.equal(clampRatio(Number.NaN), 1);
  });

  it('la clave es por cuenta', () => {
    assert.notEqual(preferencesKey('a'), preferencesKey('b'));
  });
});
