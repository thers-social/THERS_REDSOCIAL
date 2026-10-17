// Estadísticas del panel de negocio en la web (ADR-040 §31). Sin dependencias: `node --test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  ANALYTICS_METRICS,
  ANALYTICS_PERIODS,
  axisLabels,
  changeLabel,
  chartBars,
  shortDay,
} from '../src/features/places/lib/analyticsFormat.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const es = JSON.parse(read('src/shared/i18n/locales/es.json'));
const en = JSON.parse(read('src/shared/i18n/locales/en.json'));
const point = (date, values = {}) => ({ date, reviews: 0, reservations: 0, quotes: 0, posts: 0, saves: 0, plans: 0, ...values });

describe('formato de las estadísticas', () => {
  it('la variación lleva signo y no inventa datos', () => {
    assert.deepEqual(changeLabel(50), { sign: 'up', text: '+50 %' });
    assert.deepEqual(changeLabel(-20), { sign: 'down', text: '−20 %' });
    assert.deepEqual(changeLabel(0), { sign: 'flat', text: '0 %' });
    for (const bad of [null, undefined, NaN, Infinity, '5']) assert.equal(changeLabel(bad), null);
  });

  it('los días cortos se escriben dd/mm', () => {
    assert.equal(shortDay('2026-10-09'), '09/10');
    assert.equal(shortDay('mañana'), 'mañana');
  });

  it('la barra más alta ocupa todo y un valor positivo nunca desaparece', () => {
    const bars = chartBars([point('a', { quotes: 10 }), point('b', { quotes: 1 }), point('c')], 'quotes');
    assert.deepEqual(bars.map((b) => b.heightPercent), [100, 10, 0]);
    assert.equal(chartBars([point('a', { quotes: 1000 }), point('b', { quotes: 1 })], 'quotes')[1].heightPercent, 4);
  });

  it('sin actividad no hay división por cero y una métrica oculta no dibuja barras', () => {
    assert.deepEqual(chartBars([point('a'), point('b')], 'posts').map((b) => b.heightPercent), [0, 0]);
    assert.deepEqual(chartBars([point('a', { saves: null }), point('b', { saves: null })], 'saves'), []);
    assert.deepEqual(chartBars([], 'saves'), []);
    assert.deepEqual(chartBars(undefined, 'saves'), []);
  });

  it('el eje muestra el primer, el del medio y el último día', () => {
    const days = Array.from({ length: 7 }, (_, i) => point(`2026-10-0${i + 1}`));
    assert.deepEqual(axisLabels(days), ['01/10', '04/10', '07/10']);
    assert.deepEqual(axisLabels([]), []);
  });
});

describe('integración', () => {
  it('pide al servidor los periodos permitidos y solo con sesión', () => {
    assert.deepEqual(ANALYTICS_PERIODS, [7, 30, 90]);
    const api = read('src/features/places/lib/placesApi.js');
    const fn = api.slice(api.indexOf('export async function fetchManageAnalytics'));
    assert.match(fn, /manage\/analytics/);
    assert.match(fn, /authConfig\(\)/);
  });

  it('el bloque está dentro del panel del negocio, que solo ve quien gestiona', () => {
    assert.match(read('src/features/places/components/PlaceManagePanel.jsx'), /<ManageAnalytics placeId=\{placeId\} \/>/);
    assert.match(read('src/features/places/components/PlaceDetailPanel.jsx'), /place\.managed_by_me && <PlaceManagePanel/);
  });

  it('los textos existen en español e inglés, con las seis métricas', () => {
    for (const [name, dict] of [['es', es], ['en', en]]) {
      const block = dict.places.analytics;
      for (const key of ['title', 'period', 'days', 'range', 'quiet', 'vsPrevious', 'hidden', 'reservationsDetail', 'quotesDetail']) {
        assert.ok(block[key], `${name}: places.analytics.${key}`);
      }
      for (const metric of ANALYTICS_METRICS) assert.ok(block.metrics[metric], `${name}: ${metric}`);
    }
  });

  it('el aviso de lo oculto explica el mínimo en los dos idiomas', () => {
    assert.match(es.places.analytics.hidden, /\{\{min\}\}/);
    assert.match(en.places.analytics.hidden, /\{\{min\}\}/);
  });
});
