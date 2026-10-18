// Pruebas del sistema de expresiones de Tero (fase 2): cobertura de los ocho
// estados, ritmo de parpadeo, ventanas de flotación y reglas de personalidad.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVE_WINDOW_MS,
  BREATH_SCALE,
  FACE_CROSSFADE_MS,
  floatCycles,
  floatHalfCycleMs,
  floatingMood,
  isDoubleBlink,
  lookFor,
  moodForActionOutcome,
  MOOD_MOTION,
  MOUTH_MAX,
  MOUTH_MIN,
  MOUTH_REST,
  mouthKeyframes,
  mouthLoops,
  nextBlinkDelayMs,
  reactionForActionOutcome,
  reactionForMoodChange,
  SCAN_CYCLES,
  settledMood,
  SPEAK_MAX_MS,
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

describe('boca al hablar', () => {
  // Generador fijo para que la secuencia sea reproducible.
  const fixed = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it('alterna abierta y casi cerrada, dentro de los límites, y termina en reposo', () => {
    const steps = mouthKeyframes(fixed([0.1, 0.5, 0.9, 0.3]));
    assert.ok(steps.length >= 4);
    steps.forEach((step, index) => {
      assert.ok(step.to >= MOUTH_MIN && step.to <= MOUTH_MAX, `paso ${index}: ${step.to}`);
    });
    // Los pasos pares abren y los impares casi cierran.
    for (let i = 0; i + 1 < steps.length - 1; i += 2) assert.ok(steps[i].to > steps[i + 1].to);
    assert.equal(steps.at(-1).to, MOUTH_REST);
  });

  it('cada sílaba dura entre 90 y 170 ms (ritmo de habla, no un parpadeo ni un temblor)', () => {
    for (const r of [0, 0.5, 0.999]) {
      const steps = mouthKeyframes(() => r);
      for (const step of steps.slice(0, -1)) assert.ok(step.ms >= 90 && step.ms <= 170, `${step.ms}`);
    }
  });

  it('nunca habla más del tope aunque el estado dure más', () => {
    const steps = mouthKeyframes(() => 0.5);
    const cycle = steps.reduce((total, step) => total + step.ms, 0);
    assert.ok(mouthLoops(steps) * cycle <= SPEAK_MAX_MS);
    assert.ok(mouthLoops(steps) >= 1);
    assert.equal(mouthLoops([{ to: 1, ms: 99_999 }]), 1);
  });

  it('con valores aleatorios reales siempre es una secuencia válida', () => {
    for (let n = 0; n < 200; n += 1) {
      const steps = mouthKeyframes();
      assert.ok(steps.every((s) => Number.isFinite(s.to) && s.ms > 0));
    }
  });
});

describe('mirada', () => {
  it('al escuchar mira hacia abajo, al campo de texto; no se desplaza de lado', () => {
    const look = lookFor('listening');
    assert.ok(look.y > 0);
    assert.equal(look.scan, 0);
  });

  it('al pensar barre de lado a lado y no se mueve en vertical', () => {
    const look = lookFor('thinking');
    assert.ok(look.scan > 0);
    assert.equal(look.y, 0);
  });

  it('el resto de estados mira al frente, y ningún desplazamiento es exagerado', () => {
    for (const mood of ['idle', 'speaking', 'happy', 'error', 'sleeping']) {
      assert.deepEqual(lookFor(mood), { y: 0, scan: 0 }, mood);
    }
    for (const mood of TERO_MOODS) {
      const look = lookFor(mood);
      assert.ok(Math.abs(look.y) <= 0.05 && look.scan <= 0.05, mood);
    }
  });

  it('el barrido tiene tope de pasadas: no es una animación infinita', () => {
    assert.ok(Number.isInteger(SCAN_CYCLES) && SCAN_CYCLES > 0 && SCAN_CYCLES <= 5);
  });
});

describe('desenlace de una tarjeta', () => {
  it('celebra solo lo que realmente se hizo', () => {
    assert.equal(reactionForActionOutcome('confirmed'), 'celebrate');
    assert.equal(moodForActionOutcome('confirmed'), 'happy');
  });

  it('si no se pudo completar se encoge con calma y queda en el estado de error', () => {
    assert.equal(reactionForActionOutcome('failed'), 'droop');
    assert.equal(moodForActionOutcome('failed'), 'error');
  });

  it('cancelar, vencer o que ya no exista no es ni éxito ni fallo: sin reacción', () => {
    for (const outcome of ['cancelled', 'expired', 'unavailable']) {
      assert.equal(reactionForActionOutcome(outcome), null, outcome);
      assert.equal(moodForActionOutcome(outcome), null, outcome);
    }
  });

  it('un error nunca salta ni celebra (guía de personalidad)', () => {
    assert.notEqual(reactionForActionOutcome('failed'), 'celebrate');
    assert.notEqual(reactionForActionOutcome('failed'), 'joy');
  });
});

describe('respiración y cruce de caras', () => {
  it('respirar es un cambio de escala sutil (menos de 5 %)', () => {
    assert.ok(BREATH_SCALE > 0 && BREATH_SCALE < 0.05);
  });

  it('el cruce entre dos caras es rápido pero perceptible', () => {
    assert.ok(FACE_CROSSFADE_MS >= 120 && FACE_CROSSFADE_MS <= 350);
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
