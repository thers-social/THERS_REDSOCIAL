// Pruebas del sistema de expresiones de Tero (fase 2): cobertura de los ocho
// estados, ritmo de parpadeo, ventanas de flotación y reglas de personalidad.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVE_WINDOW_MS,
  floatCycles,
  floatHalfCycleMs,
  floatingMood,
  isDoubleBlink,
  MOOD_MOTION,
  nextBlinkDelayMs,
  reactionForMoodChange,
  settledMood,
  tapReaction,
  TERO_MOODS,
} from '../src/features/tero/animation/expressions.ts';

describe('MOOD_MOTION', () => {
  it('describe exactamente los ocho estados de la fase 1, sin duplicados', () => {
    assert.equal(TERO_MOODS.length, 8);
    assert.equal(new Set(TERO_MOODS).size, 8);
    assert.deepEqual(Object.keys(MOOD_MOTION).sort(), [...TERO_MOODS].sort());
  });

  it('solo parpadea con los ojos redondos abiertos', () => {
    for (const mood of ['happy', 'sleeping', 'error', 'thinking']) {
      assert.equal(MOOD_MOTION[mood].blinks, false, mood);
    }
    assert.equal(MOOD_MOTION.idle.blinks, true);
  });

  it('error y sueño quedan quietos (sin animaciones agresivas)', () => {
    assert.equal(MOOD_MOTION.error.float, 'none');
    assert.equal(MOOD_MOTION.sleeping.float, 'none');
  });

  it('curioso inclina la cabeza y solo pensando muestra los puntos', () => {
    assert.notEqual(MOOD_MOTION.attention.tilt, 0);
    assert.deepEqual(
      TERO_MOODS.filter((mood) => MOOD_MOTION[mood].thinkingDots),
      ['thinking'],
    );
  });
});

describe('parpadeo', () => {
  it('ocurre cada 3,2–7 s, nunca de forma rápida', () => {
    assert.equal(nextBlinkDelayMs(() => 0), 3200);
    assert.equal(nextBlinkDelayMs(() => 0.999999), 7000);
    for (let i = 0; i < 200; i += 1) {
      const delay = nextBlinkDelayMs();
      assert.ok(delay >= 3200 && delay <= 7000, String(delay));
    }
  });

  it('tolera un aleatorio fuera de rango', () => {
    assert.equal(nextBlinkDelayMs(() => -1), 3200);
    assert.equal(nextBlinkDelayMs(() => 5), 7000);
  });

  it('doble parpadeo solo a veces', () => {
    assert.equal(isDoubleBlink(() => 0.1), true);
    assert.equal(isDoubleBlink(() => 0.5), false);
  });
});

describe('flotación por ventanas', () => {
  it('nunca es infinita y cabe en la ventana activa', () => {
    for (const float of ['gentle', 'slow']) {
      const cycles = floatCycles(float);
      assert.ok(cycles >= 1);
      assert.ok(cycles * 2 * floatHalfCycleMs(float) <= ACTIVE_WINDOW_MS * 1.5);
    }
  });

  it('sin flotación, cero ciclos', () => {
    assert.equal(floatCycles('none'), 0);
  });
});

describe('reacciones al cambiar de estado', () => {
  it('alegría al ponerse feliz y "mensaje" al pasar de pensar a hablar', () => {
    assert.equal(reactionForMoodChange('idle', 'happy'), 'joy');
    assert.equal(reactionForMoodChange('thinking', 'speaking'), 'message');
  });

  it('sorpresa al despertar', () => {
    assert.equal(reactionForMoodChange('sleeping', 'attention'), 'surprise');
  });

  it('sin reacción al montar, sin cambio o ante un error', () => {
    assert.equal(reactionForMoodChange(null, 'happy'), null);
    assert.equal(reactionForMoodChange('idle', 'idle'), null);
    assert.equal(reactionForMoodChange('thinking', 'error'), null);
  });
});

describe('personalidad de la burbuja', () => {
  it('curioso con el panel abierto, dormido tras inactividad, si no reposo', () => {
    assert.equal(floatingMood({ panelOpen: true, asleep: true }), 'attention');
    assert.equal(floatingMood({ panelOpen: false, asleep: true }), 'sleeping');
    assert.equal(floatingMood({ panelOpen: false, asleep: false }), 'idle');
  });

  it('un toque despierta con sorpresa; despierto, solo responde al toque', () => {
    assert.equal(tapReaction(true), 'surprise');
    assert.equal(tapReaction(false), 'tap');
  });

  it('tras responder vuelve a reposo; el resto de estados se mantiene', () => {
    assert.equal(settledMood('speaking'), 'idle');
    assert.equal(settledMood('happy'), 'idle');
    assert.equal(settledMood('error'), 'error');
    assert.equal(settledMood('thinking'), 'thinking');
  });
});
