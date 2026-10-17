// Filtro de fecha del buscador. Lógica pura, probada en `tests/searchDate.test.mjs`.
// Usa `created_at`, que viaja con cada publicación real: no necesita endpoint nuevo.

const HOUR = 60 * 60 * 1000;

/** `windowMs: null` = sin límite. */
export const DATE_RANGES = [
  { id: "any", label: "Cualquier fecha", windowMs: null },
  { id: "day", label: "Últimas 24 horas", windowMs: 24 * HOUR },
  { id: "week", label: "Última semana", windowMs: 7 * 24 * HOUR },
  { id: "month", label: "Último mes", windowMs: 30 * 24 * HOUR },
];

export function isDateRange(id) {
  return DATE_RANGES.some((range) => range.id === id);
}

/** `true` si `createdAt` cae dentro del rango. Una fecha inválida solo pasa con «any». */
export function withinDateRange(createdAt, rangeId, now = Date.now()) {
  const range = DATE_RANGES.find((item) => item.id === rangeId);
  if (!range || range.windowMs === null) return true;
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return false;
  return now - time <= range.windowMs && time <= now + HOUR;
}
