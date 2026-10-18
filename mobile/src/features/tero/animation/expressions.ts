/**
 * Lógica PURA del movimiento de Tero (fase 2): qué hace el cuerpo en cada estado
 * y cuándo puede reaccionar por su cuenta. Sin React ni `Animated`, para poder
 * probarla aislada (`tests/teroExpressions.test.mjs`).
 *
 * Reglas de personalidad (docs/tero/TERO_PERSONALITY.md):
 * - Tero se mueve cuando hay un motivo: aparecer, un toque, un cambio de estado.
 *   Fuera de eso se queda quieto; solo parpadea de vez en cuando.
 * - Nunca se mueve de sitio, abre paneles ni llama la atención por su cuenta.
 * - Si nadie lo usa durante un rato, se duerme (cara quieta, sin parpadeos).
 *
 * Los ocho estados son los de `TeroMood` (Fase 1). «Sorprendido» no es un estado
 * más sino una REACCIÓN breve (`TeroReaction`), para no ampliar el contrato.
 */

import type { TeroMood } from '../types';

export const TERO_MOODS: readonly TeroMood[] = [
  'idle',
  'attention',
  'listening',
  'thinking',
  'speaking',
  'happy',
  'error',
  'sleeping',
];

/**
 * Reacciones breves (una sola vez). `celebrate` y `droop` responden a lo que la persona hizo con
 * una tarjeta (confirmar una acción / que no se pudo completar); duran un poco más que las demás
 * (menos de un segundo) porque son el desenlace de algo que la persona esperaba.
 */
export type TeroReaction = 'enter' | 'tap' | 'surprise' | 'joy' | 'message' | 'celebrate' | 'droop';

export type MoodMotion = {
  /** Parpadea de vez en cuando (solo con los ojos abiertos y redondos). */
  blinks: boolean;
  /** Flotación: `none` deja el cuerpo quieto. */
  float: 'gentle' | 'slow' | 'none';
  /** Inclinación de la cabeza en grados (negativo: hacia la izquierda). */
  tilt: number;
  /** Muestra el indicador de «pensando». */
  thinkingDots: boolean;
};

export const MOOD_MOTION: Record<TeroMood, MoodMotion> = {
  idle: { blinks: true, float: 'gentle', tilt: 0, thinkingDots: false },
  // «Curioso»: mira con la cabeza inclinada.
  attention: { blinks: true, float: 'gentle', tilt: -8, thinkingDots: false },
  // Atento: quieto y apenas inclinado hacia quien le habla.
  listening: { blinks: true, float: 'none', tilt: 5, thinkingDots: false },
  thinking: { blinks: false, float: 'slow', tilt: 0, thinkingDots: true },
  speaking: { blinks: true, float: 'gentle', tilt: 0, thinkingDots: false },
  happy: { blinks: false, float: 'gentle', tilt: 0, thinkingDots: false },
  // Error: comprensible pero sin sacudidas ni parpadeos agresivos.
  error: { blinks: false, float: 'none', tilt: 0, thinkingDots: false },
  sleeping: { blinks: false, float: 'none', tilt: 0, thinkingDots: false },
};

/**
 * «Respiración»: cuánto crece el cuerpo (escala) en lo más alto de cada ciclo de flotación. Se
 * mueve con la misma ventana que la flotación, así que no añade animaciones infinitas.
 */
export const BREATH_SCALE = 0.025;

/** Cuánto dura el cruce entre la cara que se va y la que llega, en ms. */
export const FACE_CROSSFADE_MS = 200;

// --- Mirada ---------------------------------------------------------------------------------

export type Look = {
  /** Desplazamiento vertical de los ojos como fracción del tamaño (positivo: hacia abajo). */
  y: number;
  /** Si es mayor que 0, los ojos barren de lado a lado esa fracción del tamaño (pensando). */
  scan: number;
};

const LOOK_REST: Look = { y: 0, scan: 0 };

/**
 * Hacia dónde mira Tero. Al escuchar, mira hacia abajo, donde está el campo de texto; al pensar,
 * recorre despacio de lado a lado (ya mira hacia arriba por el dibujo). No sigue al dedo ni a nada
 * fuera de la propia conversación (guía de personalidad: sin vigilancia).
 */
export function lookFor(mood: TeroMood): Look {
  switch (mood) {
    case 'listening':
      return { y: 0.05, scan: 0 };
    case 'thinking':
      return { y: 0, scan: 0.03 };
    case 'attention':
      return { y: -0.01, scan: 0 };
    default:
      return LOOK_REST;
  }
}

/** Cuántas idas y vueltas de barrido hace al pensar antes de quedarse quieto. */
export const SCAN_CYCLES = 3;

// --- Boca al hablar -------------------------------------------------------------------------

export type MouthStep = { to: number; ms: number };

/** Apertura de la boca en reposo y límites al hablar (escala vertical, 1 = completamente abierta). */
export const MOUTH_REST = 0.45;
export const MOUTH_MIN = 0.3;
export const MOUTH_MAX = 1;

/** Tope de tiempo hablando aunque el estado dure más: nada se anima para siempre. */
export const SPEAK_MAX_MS = 6000;

/**
 * Secuencia de aperturas que imita el ritmo del habla: sílabas de 90 a 170 ms, alternando abierta
 * y casi cerrada, y termina en reposo. `random` en [0, 1) para poder probarla con valores fijos.
 */
export function mouthKeyframes(random: () => number = Math.random, count = 8): MouthStep[] {
  const steps: MouthStep[] = [];
  for (let i = 0; i < count; i += 1) {
    const open = i % 2 === 0;
    const amount = open ? 0.62 + random() * (MOUTH_MAX - 0.62) : MOUTH_MIN + random() * 0.15;
    steps.push({ to: Number(amount.toFixed(3)), ms: Math.round(90 + random() * 80) });
  }
  steps.push({ to: MOUTH_REST, ms: 120 });
  return steps;
}

/** Cuántas veces repetir la secuencia para cubrir `SPEAK_MAX_MS` como máximo. */
export function mouthLoops(steps: MouthStep[], maxMs = SPEAK_MAX_MS): number {
  const cycle = steps.reduce((total, step) => total + step.ms, 0);
  return Math.max(1, Math.floor(maxMs / Math.max(1, cycle)));
}

// --- Desenlace de una acción ----------------------------------------------------------------

/** Cómo termina una tarjeta, para decidir cómo reacciona Tero. */
export type ActionOutcome = 'confirmed' | 'cancelled' | 'expired' | 'failed' | 'unavailable';

/**
 * Reacción al desenlace de una tarjeta. Celebra solo lo que de verdad se hizo; si no se pudo
 * completar, se encoge con calma (nunca sacude: un error no debe alarmar). Cancelar o que venza no
 * es un éxito ni un fallo, así que no hay reacción.
 */
export function reactionForActionOutcome(outcome: ActionOutcome): TeroReaction | null {
  if (outcome === 'confirmed') return 'celebrate';
  if (outcome === 'failed') return 'droop';
  return null;
}

/** Estado en que queda Tero tras el desenlace, o `null` si no cambia. */
export function moodForActionOutcome(outcome: ActionOutcome): TeroMood | null {
  if (outcome === 'confirmed') return 'happy';
  if (outcome === 'failed') return 'error';
  return null;
}

/** Duración de medio ciclo de flotación, en ms. */
export function floatHalfCycleMs(float: MoodMotion['float']): number {
  return float === 'slow' ? 2400 : 1600;
}

/**
 * Tiempo durante el que Tero flota después de un motivo (aparecer, un toque, un
 * cambio de estado). Pasado ese tiempo se asienta: una animación infinita
 * mantendría la pantalla redibujándose y gastaría batería sin aportar nada.
 */
export const ACTIVE_WINDOW_MS = 8000;

/** Cuántos ciclos completos de flotación caben en la ventana activa (mínimo 1). */
export function floatCycles(float: MoodMotion['float'], windowMs = ACTIVE_WINDOW_MS): number {
  if (float === 'none') return 0;
  return Math.max(1, Math.round(windowMs / (2 * floatHalfCycleMs(float))));
}

/** Parpadeo natural: entre 3,2 y 7 s. `random` en [0, 1). */
export function nextBlinkDelayMs(random: () => number = Math.random): number {
  const r = Math.min(0.999999, Math.max(0, random()));
  return Math.round(3200 + r * 3800);
}

/** Uno de cada cinco parpadeos es doble, como en una persona. */
export function isDoubleBlink(random: () => number = Math.random): boolean {
  return random() < 0.2;
}

/**
 * Reacción automática al cambiar de estado, o `null`. Solo hay reacción cuando
 * el cambio la merece; un error nunca "salta" (sería alarmante).
 */
export function reactionForMoodChange(previous: TeroMood | null, next: TeroMood): TeroReaction | null {
  if (previous === null || previous === next) return null;
  if (next === 'happy') return 'joy';
  if (previous === 'thinking' && next === 'speaking') return 'message';
  if (previous === 'sleeping') return 'surprise';
  return null;
}

/** La burbuja se duerme tras este tiempo sin que nadie la toque. */
export const SLEEP_AFTER_MS = 90_000;

/**
 * Estado que muestra la burbuja flotante. Con el panel abierto, curioso; tras
 * `SLEEP_AFTER_MS` sin que nadie la toque, dormido; si no, en reposo.
 */
export function floatingMood(options: { panelOpen: boolean; asleep: boolean }): TeroMood {
  if (options.panelOpen) return 'attention';
  return options.asleep ? 'sleeping' : 'idle';
}

/** Reacción al tocar la burbuja: si dormía, se despierta sorprendido. */
export function tapReaction(asleep: boolean): TeroReaction {
  return asleep ? 'surprise' : 'tap';
}

/** Cuánto dura un estado transitorio (p. ej. «hablando») antes de volver a reposo. */
export const SETTLE_AFTER_MS = 2600;

/** Estado al que vuelve Tero después de una respuesta, pasado `SETTLE_AFTER_MS`. */
export function settledMood(current: TeroMood): TeroMood {
  return current === 'speaking' || current === 'happy' ? 'idle' : current;
}
