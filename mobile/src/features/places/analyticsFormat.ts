// Formato de las estadísticas del panel de negocio (ADR-040 §31). Funciones puras, sin React.

export type AnalyticsMetric = 'views' | 'reservations' | 'quotes' | 'reviews' | 'posts' | 'saves' | 'plans';

export const METRIC_ORDER: AnalyticsMetric[] = ['views', 'reservations', 'quotes', 'reviews', 'posts', 'saves', 'plans'];

export const METRIC_LABEL: Record<AnalyticsMetric, string> = {
  views: 'Visitas',
  reservations: 'Reservas',
  quotes: 'Cotizaciones',
  reviews: 'Reseñas',
  posts: 'Publicaciones',
  saves: 'Guardados',
  plans: 'Planes',
};

// El servidor oculta las visitas bajo la clave `visits`, pero la serie las llama `views`.
const HIDDEN_KEY: Partial<Record<AnalyticsMetric, string>> = { views: 'visits' };

/** `true` si el servidor ocultó esa métrica por pocos datos. */
export function isHidden(hidden: readonly string[] | undefined, metric: AnalyticsMetric): boolean {
  return Array.isArray(hidden) && hidden.includes(HIDDEN_KEY[metric] ?? metric);
}

export const PERIODS = [7, 30, 90] as const;

export type SeriesPoint = { date: string } & Record<AnalyticsMetric, number | null>;

/** «+50 %», «−20 %», «Igual». Sin dato (periodo anterior en 0 o cifra oculta) da cadena vacía. */
export function formatChange(percent: number | null | undefined): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return '';
  if (percent === 0) return 'Igual';
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent)} %`;
}

/** Color semántico de la variación: sube, baja o neutro. */
export function changeTone(percent: number | null | undefined): 'up' | 'down' | 'flat' {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent === 0) return 'flat';
  return percent > 0 ? 'up' : 'down';
}

/** «10/10» a partir de «2026-10-10». Una fecha mal formada se devuelve tal cual. */
export function shortDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}` : date;
}

export type Bar = { date: string; value: number; heightPercent: number };

/**
 * Barras de una métrica. `[]` si la métrica está oculta por pocos datos (valores `null`). La barra
 * más alta ocupa el 100 %; un valor mayor que cero nunca baja de 4 % para que se vea.
 */
export function chartBars(series: SeriesPoint[], metric: AnalyticsMetric): Bar[] {
  if (series.length === 0 || series.every((point) => point[metric] === null)) return [];
  const values = series.map((point) => point[metric] ?? 0);
  const peak = Math.max(...values, 0);
  return series.map((point, index) => ({
    date: point.date,
    value: values[index],
    heightPercent: peak === 0 ? 0 : values[index] === 0 ? 0 : Math.max(4, Math.round((values[index] * 100) / peak)),
  }));
}

export function seriesTotal(series: SeriesPoint[], metric: AnalyticsMetric): number | null {
  if (series.length === 0 || series.every((point) => point[metric] === null)) return null;
  return series.reduce((sum, point) => sum + (point[metric] ?? 0), 0);
}

/** Etiquetas del eje: la primera, la del medio y la última fecha. */
export function axisLabels(series: SeriesPoint[]): string[] {
  if (series.length === 0) return [];
  if (series.length < 3) return series.map((point) => shortDay(point.date));
  const middle = series[Math.floor(series.length / 2)];
  return [shortDay(series[0].date), shortDay(middle.date), shortDay(series[series.length - 1].date)];
}

/** Explica por qué una métrica no se muestra. */
export function hiddenNote(minCount: number): string {
  return `Se muestra solo con ${minCount} o más en el periodo, para no poder deducir quién fue.`;
}
