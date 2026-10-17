// Formato de las rutas hacia un lugar en la app (ADR-040 fase 13). Lógica pura: `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/places/routeFormat.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { formatDuration, boundsOf, PROFILES, PROFILE_LABEL, ROUTE_ATTRIBUTION, stepTitle } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('la duración se escribe en segundos, minutos y horas', () => {
  assert.equal(formatDuration(0), '1 s');
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(60), '1 min');
  assert.equal(formatDuration(12 * 60 + 20), '12 min');
  assert.equal(formatDuration(3600), '1 h');
  assert.equal(formatDuration(3600 + 5 * 60), '1 h 5 min');
  assert.equal(formatDuration(7 * 3600 + 59 * 60), '7 h 59 min');
});

test('una duración inválida da cadena vacía y no rompe', () => {
  for (const bad of [null, undefined, -1, NaN, Infinity, '10']) assert.equal(formatDuration(bad), '');
});

test('los tres perfiles tienen etiqueta', () => {
  assert.deepEqual(PROFILES, ['walk', 'bike', 'car']);
  for (const p of PROFILES) assert.ok(PROFILE_LABEL[p]);
});

test('los límites contienen la línea y los puntos extra', () => {
  const line = [[-89.22, 13.69], [-89.2, 13.7], [-89.21, 13.68]];
  assert.deepEqual(boundsOf(line), [-89.22, 13.68, -89.2, 13.7]);
  assert.deepEqual(boundsOf(line, [[-89.3, 13.6], null]), [-89.3, 13.6, -89.2, 13.7]);
});

test('sin puntos válidos no hay límites', () => {
  assert.equal(boundsOf([]), null);
  assert.equal(boundsOf([[NaN, NaN]]), null);
});

test('la atribución nombra al proveedor y a OpenStreetMap', () => {
  assert.match(ROUTE_ATTRIBUTION, /OpenRouteService/);
  assert.match(ROUTE_ATTRIBUTION, /OpenStreetMap/);
});

test('una vía sin nombre se dice «Vía sin nombre» y una con nombre, su nombre', () => {
  assert.equal(stepTitle({ street: null }), 'Vía sin nombre');
  assert.equal(stepTitle({ street: '1a Calle Poniente' }), '1a Calle Poniente');
});
