// Navegación en vivo (ADR-040 §30). Lógica PURA, sin React ni red: proyecta la posición de la
// persona sobre la línea de la ruta, calcula el avance y el paso que toca, decide cuándo hablar y
// cuándo hay que recalcular. La posición exacta vive solo en estas funciones: nunca se guarda ni
// se envía (solo el origen de un recalculo, redondeado, ver `api.ts`).

export type LngLat = [number, number];
export type NavProfile = 'walk' | 'bike' | 'car';

export type NavStep = {
  instruction: string;
  street: string | null;
  distance_m: number;
  duration_s: number;
  type: number | null;
  /** Punto `[lng, lat]` donde empieza la maniobra del paso. */
  at: LngLat;
};

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distancia en metros entre dos puntos `[lng, lat]`. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo en grados (0 = norte, 90 = este) de `a` hacia `b`. */
export function bearingDegrees(a: LngLat, b: LngLat): number {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

// ---------------------------------------------------------------- la ruta como línea medida

export type RouteIndex = {
  line: LngLat[];
  /** Metros recorridos desde el inicio hasta cada vértice. */
  cumulative: number[];
  total: number;
};

export function buildRouteIndex(line: LngLat[]): RouteIndex {
  const cumulative = [0];
  for (let i = 1; i < line.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(line[i - 1], line[i]));
  }
  return { line, cumulative, total: cumulative[cumulative.length - 1] ?? 0 };
}

export type Snap = {
  /** Distancia de la persona a la ruta. */
  distanceFromRoute: number;
  /** Metros recorridos sobre la ruta hasta el punto más cercano. */
  along: number;
  /** Punto de la ruta más cercano a la persona. */
  point: LngLat;
};

/**
 * Punto de la ruta más cercano a `position`. Proyecta cada tramo en un plano local (suficiente
 * para tramos de decenas de metros). `hintAlong` (dónde iba la persona) desempata cuando la ruta
 * pasa dos veces por el mismo sitio: un salto de 1 km cuesta como 10 m de lejanía.
 */
export function snapToRoute(index: RouteIndex, position: LngLat, hintAlong?: number): Snap {
  const { line, cumulative } = index;
  if (line.length === 0) return { distanceFromRoute: Infinity, along: 0, point: position };
  if (line.length === 1) {
    return { distanceFromRoute: haversineMeters(position, line[0]), along: 0, point: line[0] };
  }
  const cosLat = Math.cos(toRad(position[1]));
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLng = mPerDegLat * cosLat;

  let best: Snap | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const abx = (b[0] - a[0]) * mPerDegLng;
    const aby = (b[1] - a[1]) * mPerDegLat;
    const apx = (position[0] - a[0]) * mPerDegLng;
    const apy = (position[1] - a[1]) * mPerDegLat;
    const lengthSq = abx * abx + aby * aby;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lengthSq));
    const dx = apx - t * abx;
    const dy = apy - t * aby;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const along = cumulative[i] + t * (cumulative[i + 1] - cumulative[i]);
    const score = distance + (hintAlong === undefined ? 0 : Math.min(Math.abs(along - hintAlong), 2000) * 0.01);
    if (score < bestScore) {
      bestScore = score;
      best = {
        distanceFromRoute: distance,
        along,
        point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      };
    }
  }
  return best as Snap;
}

/** Punto de la ruta a `along` metros del inicio (para simular un recorrido). */
export function pointAtAlong(index: RouteIndex, along: number): LngLat {
  const { line, cumulative, total } = index;
  if (line.length === 0) return [0, 0];
  if (along <= 0) return line[0];
  if (along >= total) return line[line.length - 1];
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < along) i += 1;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span === 0 ? 0 : (along - cumulative[i - 1]) / span;
  return [
    line[i - 1][0] + t * (line[i][0] - line[i - 1][0]),
    line[i - 1][1] + t * (line[i][1] - line[i - 1][1]),
  ];
}

// ---------------------------------------------------------------- pasos y avance

/** Cuánto antes de la maniobra se da por empezado un paso (el GPS y la línea no son exactos). */
export const STEP_TOLERANCE_M = 15;

/** Metros desde el inicio donde empieza cada paso. Nunca decrece; el primero es 0. */
export function stepStarts(index: RouteIndex, steps: NavStep[]): number[] {
  const starts: number[] = [];
  let previous = 0;
  steps.forEach((step, i) => {
    const along = i === 0 ? 0 : snapToRoute(index, step.at, previous).along;
    previous = Math.max(previous, along);
    starts.push(previous);
  });
  return starts;
}

/** Índice del paso en el que va la persona. -1 si no hay pasos. */
export function locateStep(starts: number[], along: number): number {
  let found = starts.length === 0 ? -1 : 0;
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i] <= along + STEP_TOLERANCE_M) found = i;
  }
  return found;
}

export type Progress = {
  stepIndex: number;
  /** La próxima maniobra y a cuántos metros está; `null` si ya no queda ninguna. */
  next: { step: NavStep; distance: number } | null;
  remainingMeters: number;
  remainingSeconds: number;
};

export function progressAt(
  index: RouteIndex,
  steps: NavStep[],
  starts: number[],
  along: number,
  route: { distance_m: number; duration_s: number },
): Progress {
  const fraction = index.total <= 0 ? 0 : Math.max(0, Math.min(1, (index.total - along) / index.total));
  const stepIndex = locateStep(starts, along);
  const nextIndex = stepIndex + 1;
  const next =
    stepIndex >= 0 && nextIndex < steps.length
      ? { step: steps[nextIndex], distance: Math.max(0, starts[nextIndex] - along) }
      : null;
  return {
    stepIndex,
    next,
    remainingMeters: Math.round(route.distance_m * fraction),
    remainingSeconds: Math.round(route.duration_s * fraction),
  };
}

// ---------------------------------------------------------------- llegada y desvío

export const ARRIVAL_M = 25;
/** Una lectura peor que esto (metros de error) no cuenta para nada. */
export const MAX_ACCURACY_M = 50;
export const OFF_ROUTE_M = 40;
export const OFF_ROUTE_STRIKES = 3;
export const MIN_REROUTE_GAP_MS = 30_000;

export function hasArrived(remainingMeters: number, distanceToDestination: number): boolean {
  return remainingMeters <= ARRIVAL_M || distanceToDestination <= ARRIVAL_M;
}

export type OffRouteState = { strikes: number; lastRerouteAt: number | null };
export const INITIAL_OFF_ROUTE: OffRouteState = { strikes: 0, lastRerouteAt: null };

/**
 * Decide si hay que recalcular. Hacen falta varias lecturas seguidas fuera de la ruta (un salto
 * suelto del GPS no basta), lejos de verdad (el umbral sube con el error de la lectura) y que
 * haya pasado un mínimo desde el último recalculo, para no pedir rutas en bucle.
 */
export function updateOffRoute(
  state: OffRouteState,
  reading: { distanceFromRoute: number; accuracy: number | null; now: number },
): { state: OffRouteState; reroute: boolean } {
  const accuracy = reading.accuracy ?? 0;
  if (accuracy > MAX_ACCURACY_M) return { state, reroute: false };
  const limit = Math.max(OFF_ROUTE_M, accuracy);
  if (reading.distanceFromRoute <= limit) {
    return { state: { ...state, strikes: 0 }, reroute: false };
  }
  const strikes = state.strikes + 1;
  const waited = state.lastRerouteAt === null || reading.now - state.lastRerouteAt >= MIN_REROUTE_GAP_MS;
  if (strikes >= OFF_ROUTE_STRIKES && waited) {
    return { state: { strikes: 0, lastRerouteAt: reading.now }, reroute: true };
  }
  return { state: { ...state, strikes }, reroute: false };
}

// ---------------------------------------------------------------- voz

/** Metros antes de la maniobra a los que se avisa; el último es «ahora». */
export const ANNOUNCE_AT: Record<NavProfile, number[]> = {
  walk: [60, 20],
  bike: [120, 40],
  car: [400, 120, 30],
};

/** «120 metros», «1,5 kilómetros». Redondea para que suene natural. */
export function spokenDistance(meters: number): string {
  if (meters >= 950) {
    const km = Math.round(meters / 100) / 10;
    return `${String(km).replace('.', ',')} ${km === 1 ? 'kilómetro' : 'kilómetros'}`;
  }
  const rounded = meters >= 100 ? Math.round(meters / 50) * 50 : Math.max(10, Math.round(meters / 10) * 10);
  return `${rounded} metros`;
}

const lowerFirst = (text: string) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/**
 * Qué decir ahora, si toca. `announced` guarda lo ya dicho (`paso:umbral`); si la persona saltó
 * varios umbrales de golpe, solo se dice el más cercano y los demás se dan por dichos.
 */
export function nextAnnouncement(
  profile: NavProfile,
  stepKey: number,
  step: NavStep,
  distance: number,
  announced: Set<string>,
): { text: string; keys: string[] } | null {
  const thresholds = ANNOUNCE_AT[profile];
  const crossed = thresholds.filter((t) => distance <= t && !announced.has(`${stepKey}:${t}`));
  if (crossed.length === 0) return null;
  const smallest = Math.min(...crossed);
  const isNow = smallest === thresholds[thresholds.length - 1];
  const text = isNow ? step.instruction : `En ${spokenDistance(distance)}, ${lowerFirst(step.instruction)}`;
  return { text, keys: crossed.map((t) => `${stepKey}:${t}`) };
}

/** Texto de la llegada. */
export function arrivalText(placeName: string): string {
  return `Llegaste a ${placeName}`;
}

/** Tiempo restante legible: «45 s», «12 min», «1 h 5 min». */
export function formatRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Flecha de una maniobra según el código del proveedor (0 izquierda, 1 derecha, 10 meta...). */
const ARROWS: Record<number, string> = {
  0: '←',
  1: '→',
  2: '↙',
  3: '↘',
  4: '↖',
  5: '↗',
  6: '↑',
  7: '↻',
  8: '↻',
  9: '↶',
  10: '⚑',
  11: '↑',
  12: '↖',
  13: '↗',
};

export function maneuverArrow(type: number | null | undefined): string {
  return (type !== null && type !== undefined && ARROWS[type]) || '↑';
}
