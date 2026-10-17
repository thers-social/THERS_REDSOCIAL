// Planes con amistades en la app (ADR-040, fase 5). Sin dependencias: `node --test`.
// Cubren la conversión de fecha/hora (lógica pura) y reglas que no deben romperse por accidente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { parseLocalDateTime, planStartsAt } from '../src/features/places/planTime.ts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const code = (path) => readFileSync(join(root, path), 'utf8');

const NOW = new Date(2026, 9, 8, 12, 0, 0); // 8 oct 2026, 12:00 local

describe('fecha y hora del plan', () => {
  it('acepta una fecha real y la devuelve en UTC (ISO-8601 con Z)', () => {
    const iso = planStartsAt('2026-10-10', '15:30', NOW);
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(new Date(iso).getTime(), new Date(2026, 9, 10, 15, 30).getTime());
  });

  it('acepta la hora con un solo dígito y espacios alrededor', () => {
    assert.ok(planStartsAt(' 2026-10-10 ', ' 9:05 ', NOW));
  });

  it('rechaza formatos inválidos', () => {
    for (const [date, time] of [
      ['', '10:00'],
      ['2026-10-10', ''],
      ['10/10/2026', '10:00'],
      ['2026-1-1', '10:00'],
      ['2026-10-10', '25:00'],
      ['2026-10-10', '10:61'],
      ['2026-10-10', '1000'],
    ]) {
      assert.equal(planStartsAt(date, time, NOW), null, `${date} ${time}`);
    }
  });

  it('rechaza una fecha que no existe en el calendario', () => {
    assert.equal(parseLocalDateTime('2026-02-30', '10:00'), null);
    assert.equal(parseLocalDateTime('2026-13-01', '10:00'), null);
    assert.equal(parseLocalDateTime('2027-02-29', '10:00'), null);
    assert.ok(parseLocalDateTime('2028-02-29', '10:00'));
  });

  it('rechaza el pasado y el instante actual', () => {
    assert.equal(planStartsAt('2026-10-08', '11:59', NOW), null);
    assert.equal(planStartsAt('2026-10-08', '12:00', NOW), null);
    assert.ok(planStartsAt('2026-10-08', '12:01', NOW));
  });
});

describe('pantalla de planes', () => {
  it('la ficha del lugar incluye los planes', () => {
    assert.match(code('app/places/[id].tsx'), /<PlacePlans placeId=\{place\.id\}/);
  });

  it('el texto de planes y personas se pinta como <Text>, nunca como HTML', () => {
    assert.doesNotMatch(code('src/features/places/PlacePlans.tsx'), /dangerouslySetInnerHTML|WebView/);
  });

  it('el cliente usa las rutas documentadas', () => {
    const api = code('src/features/places/api.ts');
    for (const route of ['/users/me/friends', '/plans?scope=upcoming', '/places/${placeId}/plans', '/plans/${planId}/response']) {
      assert.ok(api.includes(route), route);
    }
  });
});
