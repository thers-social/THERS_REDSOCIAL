// Registro de visitas a la ficha (ADR-040 §33). Lógica pura, sin red: `send` se inyecta.
// Un fallo NUNCA se muestra ni rompe la ficha: contar visitas es un extra del negocio.

export const VISIT_EVENTS = ['view', 'phone', 'website', 'directions'] as const;
export type VisitEvent = (typeof VISIT_EVENTS)[number];

type Send = (placeId: string, event: VisitEvent) => Promise<unknown> | unknown;

/**
 * Abrir la ficha cuenta una sola vez por lugar y por sesión de la app (volver atrás no infla la
 * cifra). Los toques (teléfono, web, ruta) sí cuentan cada vez: son una intención.
 * Devuelve `true` si se envió.
 */
export function createVisitTracker(send: Send) {
  const viewed = new Set<string>();
  return function track(placeId: string | undefined | null, event: string): boolean {
    if (!placeId || !(VISIT_EVENTS as readonly string[]).includes(event)) return false;
    if (event === 'view') {
      if (viewed.has(placeId)) return false;
      viewed.add(placeId);
    }
    try {
      void Promise.resolve(send(placeId, event as VisitEvent)).catch(() => {});
    } catch {
      // un envío que falla de forma síncrona tampoco debe llegar a quien visita
    }
    return true;
  };
}
