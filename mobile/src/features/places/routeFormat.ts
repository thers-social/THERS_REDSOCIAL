// Formato de las rutas hacia un lugar (ADR-040 fase 13). Funciones puras, sin React.

export type RouteProfile = 'walk' | 'bike' | 'car';

export const PROFILE_LABEL: Record<RouteProfile, string> = {
  walk: 'A pie',
  bike: 'En bici',
  car: 'En carro',
};

export const PROFILES: RouteProfile[] = ['walk', 'bike', 'car'];

/** «45 s», «12 min», «1 h», «1 h 5 min». Un valor inválido da cadena vacía. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

type Position = [number, number];

/** `[oeste, sur, este, norte]` que contiene la línea y los puntos extra; `null` si no hay puntos. */
export function boundsOf(
  line: Position[],
  extra: (Position | null)[] = [],
): [number, number, number, number] | null {
  const points = [...line, ...extra.filter((p): p is Position => p !== null)];
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/** Texto de atribución que exige el proveedor y OpenStreetMap. */
export const ROUTE_ATTRIBUTION = 'Ruta: OpenRouteService · Datos © colaboradores de OpenStreetMap';

/** Calle de una indicación, o «Sin nombre» cuando la vía no lo tiene. */
export function stepTitle(step: { street: string | null }): string {
  return step.street ?? 'Vía sin nombre';
}
