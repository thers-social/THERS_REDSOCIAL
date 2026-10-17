// Formato de las estadísticas del panel de negocio en la app (ADR-040 §31). Lógica pura: `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/places/analyticsFormat.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const fmt = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const point = (date, values = {}) => ({
  date, reviews: 0, reservations: 0, quotes: 0, posts: 0, saves: 0, plans: 0, ...values,
});

test('la variación se escribe con signo y sin inventar datos', () => {
  assert.equal(fmt.formatChange(50), '+50 %');
  assert.equal(fmt.formatChange(-20), '−20 %');
  assert.equal(fmt.formatChange(0), 'Igual');
  for (const bad of [null, undefined, NaN, Infinity, '5']) assert.equal(fmt.formatChange(bad), '');
});

test('el tono de la variación sube, baja o es neutro', () => {
  assert.equal(fmt.changeTone(10), 'up');
  assert.equal(fmt.changeTone(-10), 'down');
  for (const flat of [0, null, undefined, NaN]) assert.equal(fmt.changeTone(flat), 'flat');
});

test('los días cortos se escriben dd/mm y una fecha rara no rompe', () => {
  assert.equal(fmt.shortDay('2026-10-09'), '09/10');
  assert.equal(fmt.shortDay('2026-01-31'), '31/01');
  assert.equal(fmt.shortDay('mañana'), 'mañana');
});

test('la barra más alta ocupa todo y un valor positivo nunca desaparece', () => {
  const series = [point('2026-10-08', { quotes: 10 }), point('2026-10-09', { quotes: 1 }), point('2026-10-10')];
  const bars = fmt.chartBars(series, 'quotes');
  assert.deepEqual(bars.map((b) => b.value), [10, 1, 0]);
  assert.equal(bars[0].heightPercent, 100);
  assert.equal(bars[1].heightPercent, 10);
  assert.equal(bars[2].heightPercent, 0);
  const tiny = fmt.chartBars([point('a', { quotes: 1000 }), point('b', { quotes: 1 })], 'quotes');
  assert.equal(tiny[1].heightPercent, 4);
});

test('sin actividad todas las barras miden cero y no hay división por cero', () => {
  const bars = fmt.chartBars([point('2026-10-09'), point('2026-10-10')], 'reservations');
  assert.deepEqual(bars.map((b) => b.heightPercent), [0, 0]);
});

test('una métrica oculta (valores nulos) no dibuja barras ni suma', () => {
  const series = [point('2026-10-09', { saves: null }), point('2026-10-10', { saves: null })];
  assert.deepEqual(fmt.chartBars(series, 'saves'), []);
  assert.equal(fmt.seriesTotal(series, 'saves'), null);
  assert.deepEqual(fmt.chartBars([], 'saves'), []);
  assert.equal(fmt.seriesTotal([], 'saves'), null);
});

test('el total de la serie suma los días', () => {
  assert.equal(fmt.seriesTotal([point('a', { posts: 2 }), point('b', { posts: 3 })], 'posts'), 5);
});

test('el eje muestra el primer, el del medio y el último día', () => {
  const days = Array.from({ length: 7 }, (_, i) => point(`2026-10-0${i + 1}`));
  assert.deepEqual(fmt.axisLabels(days), ['01/10', '04/10', '07/10']);
  assert.deepEqual(fmt.axisLabels(days.slice(0, 2)), ['01/10', '02/10']);
  assert.deepEqual(fmt.axisLabels([]), []);
});

test('hay una etiqueta por métrica y un periodo por opción', () => {
  assert.deepEqual([...fmt.PERIODS], [7, 30, 90]);
  for (const metric of fmt.METRIC_ORDER) assert.ok(fmt.METRIC_LABEL[metric], metric);
  assert.equal(fmt.METRIC_ORDER.length, 7); // las seis de antes + las visitas (ADR-040 §33)
});

test('la nota de lo oculto dice el mínimo', () => {
  assert.match(fmt.hiddenNote(5), /5 o más/);
});
