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

/** Reacciones breves (una sola vez, menos de medio segundo). */
export type TeroReaction = 'enter' | 'tap' | 'surprise' | 'joy' | 'message';

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
