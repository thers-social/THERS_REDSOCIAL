/**
 * Lógica PURA de las preferencias de Tero: valores por defecto y validación de
 * lo que se lee del almacenamiento. Sin React ni AsyncStorage, para poder
 * probarla aislada (`tests/teroPreferences.test.mjs`).
 *
 * Lo que se lee del disco no es confiable (versión vieja, valor corrupto, otra
 * app de desarrollo con la misma clave): cada campo se valida por separado y lo
 * inválido vuelve a su valor por defecto, en vez de descartar todo.
 */

import type { TeroPreferences } from '../types';

export function defaultPreferences(now: Date = new Date()): TeroPreferences {
  return {
    version: 1,
    showTero: true,
    side: 'right',
    // Abajo, cerca de la barra de navegación (esquina inferior derecha).
    verticalRatio: 1,
    animations: true,
    sounds: false,
    language: 'es',
    updatedAt: now.toISOString(),
  };
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** Convierte lo leído del almacenamiento en preferencias válidas. Nunca lanza. */
export function parsePreferences(raw: string | null, now: Date = new Date()): TeroPreferences {
  const defaults = defaultPreferences(now);
  if (!raw) return defaults;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!data || typeof data !== 'object') return defaults;
  const value = data as Record<string, unknown>;

  return {
    version: 1,
    showTero: typeof value.showTero === 'boolean' ? value.showTero : defaults.showTero,
    side: value.side === 'left' || value.side === 'right' ? value.side : defaults.side,
    verticalRatio:
      typeof value.verticalRatio === 'number' ? clampRatio(value.verticalRatio) : defaults.verticalRatio,
    animations: typeof value.animations === 'boolean' ? value.animations : defaults.animations,
    sounds: typeof value.sounds === 'boolean' ? value.sounds : defaults.sounds,
    language: 'es',
    updatedAt:
      typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
        ? value.updatedAt
        : defaults.updatedAt,
  };
}

/** Aplica un cambio y marca la fecha de modificación. */
export function updatePreferences(
  current: TeroPreferences,
  patch: Partial<Omit<TeroPreferences, 'version' | 'updatedAt' | 'language'>>,
  now: Date = new Date(),
): TeroPreferences {
  const next = { ...current, ...patch, updatedAt: now.toISOString() };
  return { ...next, verticalRatio: clampRatio(next.verticalRatio) };
}

/**
 * Clave por cuenta: dos personas que usan el mismo teléfono no comparten la
 * posición ni la visibilidad de Tero. El id de usuario es un UUID, no un secreto.
 */
export function preferencesKey(userId: string): string {
  return `thers.tero.preferences.v1.${userId}`;
}
