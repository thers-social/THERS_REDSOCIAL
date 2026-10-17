// Formato de las rutas hacia un lugar (ADR-040 fase 13). Funciones puras, sin React.

export const ROUTE_PROFILES = ["walk", "bike", "car"];

/**
 * «45 s», «12 min», «1 h», «1 h 5 min». `t` es la función de traducción; un valor inválido da "".
 */
export function formatDuration(seconds, t) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return t("places.route.dur.seconds", { n: Math.max(1, Math.round(seconds)) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("places.route.dur.minutes", { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? t("places.route.dur.hours", { h }) : t("places.route.dur.hoursMinutes", { h, m });
}

/** `[oeste, sur, este, norte]` que contiene la línea y los puntos extra; `null` si no hay puntos. */
export function boundsOf(line, extra = []) {
  const points = [...line, ...extra.filter(Boolean)];
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

/** Pasos con punto válido `[lng, lat]`: lo que el mapa puede enfocar. */
export function focusableSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.filter(
    (step) =>
      step &&
      typeof step.instruction === "string" &&
      Array.isArray(step.at) &&
      step.at.length === 2 &&
      step.at.every((n) => Number.isFinite(n))
  );
}
