// Pulse del lugar (ADR-040 §32): la etiqueta sale solo de los tres niveles conocidos.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pulseLabel } from '../src/features/places/pulse.ts';

describe('pulseLabel', () => {
  it('traduce los tres niveles', () => {
    assert.equal(pulseLabel('moving'), 'Con movimiento');
    assert.equal(pulseLabel('active'), 'Activo');
    assert.equal(pulseLabel('buzzing'), 'Muy activo');
  });

  it('no inventa una etiqueta con poca actividad ni con valores raros', () => {
    for (const value of [null, undefined, '', 'quiet', 'toString', '__proto__', 5, {}, ['moving']]) {
      assert.equal(pulseLabel(value), null, String(value));
    }
  });
});
