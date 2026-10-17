/**
 * Fecha y hora de un plan (ADR-040 fase 5). Módulo PURO, probado con `node --test`.
 *
 * La app no lleva un selector de fecha nativo (añadirlo exigiría una build nativa nueva), así
 * que la persona escribe `AAAA-MM-DD` y `HH:MM` en su hora LOCAL. El servidor exige una hora
 * con zona horaria, así que aquí se convierte a ISO-8601 en UTC.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** `Date` local de `dateText` + `timeText`, o `null` si no es una fecha real (p. ej. 2026-02-30). */
export function parseLocalDateTime(dateText: string, timeText: string): Date | null {
  const date = DATE_RE.exec(dateText.trim());
  const time = TIME_RE.exec(timeText.trim());
  if (!date || !time) return null;
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const [hour, minute] = [Number(time[1]), Number(time[2])];
  if (hour > 23 || minute > 59) return null;
  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  // `new Date` corrige en silencio un 30 de febrero al 2 de marzo: se rechaza.
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return null;
  }
  return result;
}

/** ISO-8601 en UTC a futuro, o `null` si falta, es inválida o ya pasó. */
export function planStartsAt(dateText: string, timeText: string, now: Date = new Date()): string | null {
  const parsed = parseLocalDateTime(dateText, timeText);
  if (!parsed || parsed.getTime() <= now.getTime()) return null;
  return parsed.toISOString();
}

/** «sáb 11 oct · 15:30» en la hora local. */
export function formatPlanDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}
