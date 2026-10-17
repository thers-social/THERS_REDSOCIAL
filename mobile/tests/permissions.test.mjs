// Pruebas del estado de los permisos y de la selección de avisos locales.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { actionFor, actionLabel, stateLabel } from '../src/features/permissions/permissionState.ts';
import { MAX_INDIVIDUAL_ALERTS, planAlerts } from '../src/features/notifications/alertLogic.ts';

describe('actionFor', () => {
  it('un permiso concedido no ofrece nada', () => {
    assert.equal(actionFor({ state: 'granted', canAskAgain: true }), 'none');
  });
  it('sin decidir se pide con el diálogo del sistema', () => {
    assert.equal(actionFor({ state: 'undetermined', canAskAgain: true }), 'request');
  });
  it('negado pero con opción de volver a preguntar se pide otra vez', () => {
    assert.equal(actionFor({ state: 'denied', canAskAgain: true }), 'request');
  });
  it('negado para siempre manda a Ajustes', () => {
    assert.equal(actionFor({ state: 'denied', canAskAgain: false }), 'open-settings');
  });
});

describe('textos', () => {
  it('estados', () => {
    assert.equal(stateLabel({ state: 'granted', canAskAgain: true }), 'Permitido');
    assert.equal(stateLabel({ state: 'undetermined', canAskAgain: true }), 'Sin decidir');
    assert.equal(stateLabel({ state: 'denied', canAskAgain: true }), 'No permitido');
    assert.equal(stateLabel({ state: 'denied', canAskAgain: false }), 'Bloqueado en Ajustes');
  });
  it('botones', () => {
    assert.equal(actionLabel('request'), 'Permitir');
    assert.equal(actionLabel('open-settings'), 'Abrir Ajustes');
    assert.equal(actionLabel('none'), null);
  });
});

const item = (id, minutes, read = false) => ({
  id,
  type: 'like',
  actor: null,
  post_id: null,
  place: null,
  object_id: null,
  detail: null,
  read,
  created_at: new Date(Date.UTC(2026, 9, 17, 12, minutes)).toISOString(),
});

describe('planAlerts', () => {
  it('la primera consulta no avisa de nada y lo registra todo', () => {
    const plan = planAlerts([item('a', 1), item('b', 2)], null);
    assert.deepEqual(plan.individual, []);
    assert.equal(plan.overflow, 0);
    assert.deepEqual([...plan.nextSeen].sort(), ['a', 'b']);
  });

  it('avisa solo de lo nuevo y sin leer', () => {
    const plan = planAlerts([item('a', 1), item('b', 2), item('c', 3, true)], new Set(['a']));
    assert.deepEqual(plan.individual.map((n) => n.id), ['b']);
    assert.ok(plan.nextSeen.has('c'));
  });

  it('no repite lo que ya avisó', () => {
    const first = planAlerts([item('a', 1), item('b', 2)], new Set(['a']));
    const second = planAlerts([item('a', 1), item('b', 2)], first.nextSeen);
    assert.deepEqual(second.individual, []);
  });

  it('ordena del más reciente al más antiguo y resume el exceso', () => {
    const items = [item('1', 1), item('2', 2), item('3', 3), item('4', 4), item('5', 5)];
    const plan = planAlerts(items, new Set());
    assert.deepEqual(plan.individual.map((n) => n.id), ['5', '4', '3']);
    assert.equal(plan.individual.length, MAX_INDIVIDUAL_ALERTS);
    assert.equal(plan.overflow, 2);
  });

  it('una lista vacía no avisa', () => {
    const plan = planAlerts([], new Set(['a']));
    assert.deepEqual(plan.individual, []);
    assert.equal(plan.overflow, 0);
  });
});
