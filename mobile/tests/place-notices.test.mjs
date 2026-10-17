// Texto y destino de los avisos de Places en la app (ADR-040 fase 12). Lógica pura: `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/notifications/describe.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { describePlaceNotice, placeNoticeTarget } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const place = { id: 'p1', name: 'Café Aurora' };
const notice = (type, detail = null, withPlace = place) => ({ type, detail, place: withPlace });

test('cada tipo de aviso de Places tiene texto', () => {
  const types = [
    'place_reservation_new',
    'place_reservation_decided',
    'place_reservation_cancelled',
    'place_quote_new',
    'place_quote_decided',
    'place_plan_invite',
    'place_claim_decided',
    'place_review_reply',
  ];
  for (const type of types) assert.ok(describePlaceNotice(notice(type)), type);
});

test('el estado cambia el texto', () => {
  assert.match(describePlaceNotice(notice('place_reservation_decided', 'confirmed')), /confirmó/);
  assert.match(describePlaceNotice(notice('place_reservation_decided', 'declined')), /rechazó/);
  assert.match(describePlaceNotice(notice('place_quote_decided', 'accepted')), /aceptó/);
  assert.match(describePlaceNotice(notice('place_quote_decided', 'rejected')), /rechazó/);
  assert.match(describePlaceNotice(notice('place_claim_decided', 'approved')), /aprobó/);
  assert.match(describePlaceNotice(notice('place_claim_decided', 'rejected')), /rechazó/);
});

test('un estado o un tipo desconocido no rompe nada', () => {
  assert.ok(describePlaceNotice(notice('place_reservation_decided', 'otra-cosa')));
  assert.ok(describePlaceNotice(notice('place_quote_decided', null)));
  assert.equal(describePlaceNotice(notice('like')), null);
  assert.equal(describePlaceNotice(notice('place_futuro')), null);
});

test('quien gestiona abre su panel; el resto, la ficha del lugar', () => {
  for (const type of ['place_reservation_new', 'place_reservation_cancelled', 'place_quote_new']) {
    assert.deepEqual(placeNoticeTarget(notice(type)), { pathname: '/places/manage/[id]', params: { id: 'p1' } });
  }
  for (const type of ['place_reservation_decided', 'place_quote_decided', 'place_plan_invite', 'place_claim_decided', 'place_review_reply']) {
    assert.deepEqual(placeNoticeTarget(notice(type)), { pathname: '/places/[id]', params: { id: 'p1' } });
  }
});

test('sin lugar o sin ser de Places no hay destino', () => {
  assert.equal(placeNoticeTarget(notice('place_quote_new', null, null)), null);
  assert.equal(placeNoticeTarget(notice('like')), null);
});
