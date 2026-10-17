// Visitas anónimas a la ficha en la app (ADR-040 §33). Lógica pura: `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { createVisitTracker, VISIT_EVENTS } from '../src/features/places/visitTracker.ts';
import { isHidden } from '../src/features/places/analyticsFormat.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('registro de visitas', () => {
  it('solo envía los cuatro eventos conocidos', () => {
    const sent = [];
    const track = createVisitTracker((id, event) => sent.push([id, event]));
    assert.deepEqual([...VISIT_EVENTS], ['view', 'phone', 'website', 'directions']);
    for (const bad of ['click', '', null, undefined, 5]) assert.equal(track('p1', bad), false);
    assert.equal(track('', 'view'), false);
    assert.equal(track(undefined, 'phone'), false);
    assert.equal(track(null, 'phone'), false);
    assert.deepEqual(sent, []);
  });

  it('abrir la ficha cuenta una vez por lugar y por sesión de la app', () => {
    const sent = [];
    const track = createVisitTracker((id, event) => sent.push([id, event]));
    assert.equal(track('p1', 'view'), true);
    assert.equal(track('p1', 'view'), false);
    assert.equal(track('p2', 'view'), true);
    assert.deepEqual(sent, [['p1', 'view'], ['p2', 'view']]);
  });

  it('cada seguimiento tiene su propia memoria', () => {
    const a = createVisitTracker(() => {});
    const b = createVisitTracker(() => {});
    assert.equal(a('p1', 'view'), true);
    assert.equal(b('p1', 'view'), true);
  });

  it('los toques (teléfono, web, ruta) cuentan cada vez', () => {
    const sent = [];
    const track = createVisitTracker((id, event) => sent.push(event));
    for (const event of ['phone', 'phone', 'website', 'directions']) track('p1', event);
    assert.deepEqual(sent, ['phone', 'phone', 'website', 'directions']);
  });

  it('un fallo del envío, síncrono o asíncrono, nunca llega a quien visita', async () => {
    const asyncFail = createVisitTracker(() => Promise.reject(new Error('sin red')));
    assert.equal(asyncFail('p1', 'phone'), true);
    await new Promise((resolve) => setTimeout(resolve, 0)); // sin «unhandled rejection»
    const syncFail = createVisitTracker(() => {
      throw new Error('boom');
    });
    assert.equal(syncFail('p1', 'website'), true);
  });
});

describe('visitas en las estadísticas', () => {
  it('el servidor las oculta como «visits» y la serie las llama «views»', () => {
    assert.equal(isHidden(['saves', 'visits'], 'views'), true);
    assert.equal(isHidden(['saves'], 'views'), false);
    assert.equal(isHidden(['saves'], 'saves'), true);
    assert.equal(isHidden(undefined, 'views'), false);
  });
});

describe('integración', () => {
  it('la API manda el evento por POST con la sesión opcional', () => {
    const api = read('src/features/places/api.ts');
    const fn = api.slice(api.indexOf('export async function recordPlaceVisit'));
    assert.ok(fn.includes('/visits'));
    assert.ok(fn.includes("method: 'POST'") && fn.includes('body: { event }'));
  });

  it('la ficha y la ruta registran sus eventos', () => {
    const screen = read('app/places/[id].tsx');
    for (const event of ['view', 'phone', 'website']) assert.ok(screen.includes(`trackPlaceVisit(`) && screen.includes(`'${event}'`), event);
    assert.ok(read('src/features/places/PlaceRoute.tsx').includes("trackPlaceVisit(place.id, 'directions')"));
  });
});
