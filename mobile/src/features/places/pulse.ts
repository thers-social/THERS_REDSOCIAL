// Pulse del lugar (ADR-040 §32): solo un nivel de actividad reciente, nunca una cifra ni quién.

export type PulseLevel = 'moving' | 'active' | 'buzzing';

const LABELS: Record<PulseLevel, string> = {
  moving: 'Con movimiento',
  active: 'Activo',
  buzzing: 'Muy activo',
};

/** Etiqueta del nivel, o `null` si no hay nivel (poca actividad) o el valor no es de la lista. */
export function pulseLabel(level: unknown): string | null {
  return typeof level === 'string' && Object.hasOwn(LABELS, level) ? LABELS[level as PulseLevel] : null;
}
