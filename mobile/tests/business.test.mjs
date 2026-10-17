// Pruebas de la lógica pura del negocio, las reservas y el cotizador (ADR-040 fases 8 a 10).
// Se ejecutan con `npm test` (node --test). Se transpila el .ts al vuelo, igual que plans.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/places/businessTime.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('quarterMinutes acepta cuartos de hora y rechaza el resto', () => {
  assert.equal(mod.quarterMinutes('08:00'), 480);
  assert.equal(mod.quarterMinutes('8:15'), 495);
  assert.equal(mod.quarterMinutes('23:45'), 1425);
  for (const bad of ['08:10', '24:00', '8', '', 'ab:cd', '08:60']) {
    assert.equal(mod.quarterMinutes(bad), null, bad);
  }
});

test('intervalsError replica las reglas del servidor', () => {
  const ok = [
    { opens: '08:00', closes: '12:00' },
    { opens: '14:00', closes: '18:00' },
  ];
  assert.equal(mod.intervalsError([]), null);
  assert.equal(mod.intervalsError(ok), null);
  assert.match(mod.intervalsError([{ opens: '12:00', closes: '08:00' }]), /posterior/);
  assert.match(mod.intervalsError([{ opens: '08:00', closes: '08:00' }]), /posterior/);
  assert.match(mod.intervalsError([{ opens: '08:00', closes: '23:59' }]), /cuartos/);
  assert.match(mod.intervalsError([{ opens: '08:05', closes: '09:00' }]), /cuartos/);
  assert.match(
    mod.intervalsError([
      { opens: '08:00', closes: '12:00' },
      { opens: '11:45', closes: '13:00' },
    ]),
    /solapar/,
  );
  assert.match(mod.intervalsError(Array(4).fill({ opens: '08:00', closes: '09:00' })), /Máximo 3/);
  // Tramos contiguos (cierra a las 12:00 y abre a las 12:00) no se solapan.
  assert.equal(
    mod.intervalsError([
      { opens: '08:00', closes: '12:00' },
      { opens: '12:00', closes: '13:00' },
    ]),
    null,
  );
});

test('describeIntervals', () => {
  assert.equal(mod.describeIntervals([]), 'Cerrado');
  assert.equal(
    mod.describeIntervals([
      { opens: '08:00:00', closes: '12:00' },
      { opens: '14:00', closes: '18:00' },
    ]),
    '08:00–12:00 · 14:00–18:00',
  );
});

test('nextDays arranca hoy y avanza de a un día, también al cambiar de mes', () => {
  const days = mod.nextDays(4, new Date(2026, 0, 30, 15, 0));
  assert.deepEqual(
    days.map((d) => d.key),
    ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'],
  );
  assert.equal(days[0].label, 'Hoy');
  assert.equal(days[1].label, 'Mañana');
});

test('isDateKey rechaza fechas que no existen', () => {
  assert.equal(mod.isDateKey('2026-10-09'), true);
  assert.equal(mod.isDateKey('2026-02-30'), false);
  assert.equal(mod.isDateKey('09/10/2026'), false);
});

test('parsePriceCents usa enteros: sin errores de coma flotante', () => {
  assert.equal(mod.parsePriceCents('12'), 1200);
  assert.equal(mod.parsePriceCents('12.5'), 1250);
  assert.equal(mod.parsePriceCents('12,50'), 1250);
  assert.equal(mod.parsePriceCents('0.07'), 7);
  assert.equal(mod.parsePriceCents('19.99'), 1999);
  assert.equal(mod.parsePriceCents('1000000'), 100_000_000);
  for (const bad of ['', '-1', '1.234', 'abc', '1000001', '1e3', '12.', '.5']) {
    assert.equal(mod.parsePriceCents(bad), null, bad);
  }
});

test('parseQuantity acepta enteros de 1 a 10000', () => {
  assert.equal(mod.parseQuantity('1'), 1);
  assert.equal(mod.parseQuantity('10000'), 10000);
  for (const bad of ['0', '10001', '1.5', '-2', '', 'x']) {
    assert.equal(mod.parseQuantity(bad), null, bad);
  }
});
