/**
 * Qué avisos del servidor merecen una notificación local. Lógica pura (sin React Native):
 * probada en `tests/alertLogic.test.mjs`.
 *
 * La primera consulta de una sesión NO notifica: todo lo que ya estaba sin leer es "visto" para
 * no disparar una ráfaga al abrir la app. Después, solo lo no leído y no visto antes.
 */

import type { AppNotification } from './api';

/** Máximo de notificaciones individuales por consulta; el resto se resume en una sola. */
export const MAX_INDIVIDUAL_ALERTS = 3;

export type AlertPlan = {
  /** Avisos nuevos, del más reciente al más antiguo, hasta el tope. */
  individual: AppNotification[];
  /** Cuántos más hubo (se resumen en una sola notificación). */
  overflow: number;
  /** Ids a recordar como vistos después de esta consulta. */
  nextSeen: Set<string>;
};

export function planAlerts(
  items: AppNotification[],
  seen: Set<string> | null,
  max: number = MAX_INDIVIDUAL_ALERTS,
): AlertPlan {
  const nextSeen = new Set(seen ?? []);
  const fresh: AppNotification[] = [];

  for (const item of items) {
    if (!seen) {
      // Primera consulta: se registra todo sin avisar.
      nextSeen.add(item.id);
      continue;
    }
    if (!item.read && !seen.has(item.id)) fresh.push(item);
    nextSeen.add(item.id);
  }

  fresh.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return {
    individual: fresh.slice(0, max),
    overflow: Math.max(0, fresh.length - max),
    nextSeen,
  };
}
