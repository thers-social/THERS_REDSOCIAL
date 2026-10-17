// Pruebas del filtro de fecha del buscador. Sin dependencias: `node --test`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DATE_RANGES, isDateRange, withinDateRange } from '../src/features/feed/lib/searchDate.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const ago = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString();

describe('withinDateRange', () => {
  it('«any» acepta todo, incluso fechas inválidas', () => {
    assert.equal(withinDateRange(ago(24 * 400), 'any', NOW), true);
    assert.equal(withinDateRange('no-es-fecha', 'any', NOW), true);
  });

  it('respeta cada ventana', () => {
    assert.equal(withinDateRange(ago(23), 'day', NOW), true);
    assert.equal(withinDateRange(ago(25), 'day', NOW), false);
    assert.equal(withinDateRange(ago(24 * 6), 'week', NOW), true);
    assert.equal(withinDateRange(ago(24 * 8), 'week', NOW), false);
    assert.equal(withinDateRange(ago(24 * 29), 'month', NOW), true);
    assert.equal(withinDateRange(ago(24 * 31), 'month', NOW), false);
  });

  it('una fecha inválida o muy futura no pasa un filtro con ventana', () => {
    assert.equal(withinDateRange('no-es-fecha', 'week', NOW), false);
    assert.equal(withinDateRange(ago(-48), 'week', NOW), false);
  });

  it('un rango desconocido no filtra', () => {
    assert.equal(withinDateRange(ago(24 * 400), 'otro', NOW), true);
  });
});

describe('isDateRange', () => {
  it('reconoce solo los ids definidos', () => {
    for (const range of DATE_RANGES) assert.equal(isDateRange(range.id), true);
    assert.equal(isDateRange('year'), false);
    assert.equal(isDateRange(null), false);
  });
});
