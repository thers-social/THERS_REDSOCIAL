// Formato de las estadísticas del panel de negocio (ADR-040 §31). Funciones puras, sin React.

export const ANALYTICS_METRICS = ["views", "reservations", "quotes", "reviews", "posts", "saves", "plans"];

// El servidor oculta las visitas bajo la clave `visits`, pero la serie las llama `views`.
const HIDDEN_KEY = { views: "visits" };

/** `true` si el servidor ocultó esa métrica por pocos datos. */
export function isHidden(hidden, metric) {
  return Array.isArray(hidden) && hidden.includes(HIDDEN_KEY[metric] ?? metric);
}
export const ANALYTICS_PERIODS = [7, 30, 90];

/** «+50 %», «−20 %», o `null` si no hay dato (el periodo anterior fue 0 o la cifra está oculta). */
export function changeLabel(percent) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return null;
  if (percent === 0) return { sign: "flat", text: "0 %" };
  return { sign: percent > 0 ? "up" : "down", text: `${percent > 0 ? "+" : "−"}${Math.abs(percent)} %` };
}

/** «10/10» a partir de «2026-10-10». Una fecha mal formada se devuelve tal cual. */
export function shortDay(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  return match ? `${match[3]}/${match[2]}` : String(date);
}

/**
 * Barras de una métrica: `[]` si está oculta por pocos datos (valores `null`). La más alta ocupa
 * el 100 %; un valor mayor que cero nunca baja de 4 % para que se vea.
 */
export function chartBars(series, metric) {
  if (!Array.isArray(series) || series.length === 0 || series.every((point) => point[metric] === null)) return [];
  const values = series.map((point) => point[metric] ?? 0);
  const peak = Math.max(...values, 0);
  return series.map((point, index) => ({
    date: point.date,
    value: values[index],
    heightPercent: peak === 0 || values[index] === 0 ? 0 : Math.max(4, Math.round((values[index] * 100) / peak)),
  }));
}

/** Primera, del medio y última fecha del eje. */
export function axisLabels(series) {
  if (!Array.isArray(series) || series.length === 0) return [];
  if (series.length < 3) return series.map((point) => shortDay(point.date));
  return [shortDay(series[0].date), shortDay(series[Math.floor(series.length / 2)].date), shortDay(series[series.length - 1].date)];
}
