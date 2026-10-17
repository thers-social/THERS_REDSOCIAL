// Visitas anónimas a la ficha en la web (ADR-040 §33). Sin dependencias: `node --test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

import { isHidden } from '../src/features/places/lib/analyticsFormat.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// placeVisits.js importa placesApi.js (axios + alias): se prueba su lógica con un `send` falso,
// extrayendo el módulo sin esa importación.
const source = read('src/features/places/lib/placeVisits.js').replace(/^import .*$/m, 'const recordPlaceVisit = () => {};');
const { trackPlaceVisit, resetViewedForTests, VISIT_EVENTS } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

describe('registro de visitas', () => {
  beforeEach(() => resetViewedForTests());

  it('solo envía los cuatro eventos conocidos', () => {
    const sent = [];
    const send = (id, event) => sent.push([id, event]);
    assert.deepEqual(VISIT_EVENTS, ['view', 'phone', 'website', 'directions']);
    for (const bad of ['click', '', null, undefined, 5]) assert.equal(trackPlaceVisit('p1', bad, send), false);
    assert.equal(trackPlaceVisit('', 'view', send), false);
    assert.equal(trackPlaceVisit(undefined, 'phone', send), false);
    assert.deepEqual(sent, []);
  });

  it('abrir la ficha cuenta una vez por lugar y por carga de página', () => {
    const sent = [];
    const send = (id, event) => sent.push([id, event]);
    assert.equal(trackPlaceVisit('p1', 'view', send), true);
    assert.equal(trackPlaceVisit('p1', 'view', send), false);
    assert.equal(trackPlaceVisit('p2', 'view', send), true);
    assert.deepEqual(sent, [['p1', 'view'], ['p2', 'view']]);
  });

  it('los toques (teléfono, web, ruta) cuentan cada vez', () => {
    const sent = [];
    const send = (id, event) => sent.push(event);
    for (const event of ['phone', 'phone', 'website', 'directions']) trackPlaceVisit('p1', event, send);
    assert.deepEqual(sent, ['phone', 'phone', 'website', 'directions']);
  });

  it('un fallo del servidor, síncrono o asíncrono, nunca llega a quien visita', async () => {
    assert.equal(trackPlaceVisit('p1', 'phone', () => Promise.reject(new Error('boom'))), true);
    await new Promise((resolve) => setTimeout(resolve, 0)); // sin "unhandled rejection"
    assert.equal(trackPlaceVisit('p1', 'website', () => 'ok'), true);
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
  it('la API manda el evento con la sesión opcional y la ficha lo registra', () => {
    const api = read('src/features/places/lib/placesApi.js');
    const fn = api.slice(api.indexOf('export async function recordPlaceVisit'));
    assert.match(fn, /\/visits/);
    assert.match(fn, /\{ event \}/);
    const panel = read('src/features/places/components/PlaceDetailPanel.jsx');
    for (const event of ['view', 'phone', 'website']) assert.ok(panel.includes(`trackPlaceVisit(`) && panel.includes(`"${event}"`), event);
    assert.match(read('src/features/places/components/PlaceRoute.jsx'), /trackPlaceVisit\(place\.id, "directions"\)/);
  });

  it('los textos nuevos existen en español e inglés', () => {
    for (const dict of [JSON.parse(read('src/shared/i18n/locales/es.json')), JSON.parse(read('src/shared/i18n/locales/en.json'))]) {
      const block = dict.places.analytics;
      assert.ok(block.conversion && block.visitsDetail && block.metrics.views);
      assert.match(block.visitsDetail, /\{\{phone\}\}.*\{\{website\}\}.*\{\{directions\}\}/);
    }
  });
});
