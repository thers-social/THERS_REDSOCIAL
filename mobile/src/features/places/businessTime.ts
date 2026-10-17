/**
 * Utilidades PURAS del negocio y de las reservas (ADR-040 fases 8 a 10). Se prueban con
 * `node --test` (`tests/business.test.mjs`); el servidor valida de nuevo todo lo de aquí.
 */

import type { HourInterval } from './types';

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const HOUR_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Minutos desde medianoche de `HH:MM` en cuartos de hora exactos, o `null`. */
export function quarterMinutes(text: string): number | null {
  const match = HOUR_RE.exec(text.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes % 15 === 0 ? minutes : null;
}

export function padHour(text: string): string {
  const match = HOUR_RE.exec(text.trim());
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : text.trim();
}

/**
 * Mensaje de error de los tramos de UN día, o `null` si son válidos. Mismas reglas que el
 * servidor: hasta 3 tramos, cuartos de hora, cierre posterior a apertura, sin solaparse y el
 * último cierre posible es 23:45.
 */
export function intervalsError(intervals: HourInterval[]): string | null {
  if (intervals.length > 3) return 'Máximo 3 tramos por día.';
  const parsed: [number, number][] = [];
  for (const interval of intervals) {
    const opens = quarterMinutes(interval.opens);
    const closes = quarterMinutes(interval.closes);
    if (opens === null || closes === null) {
      return 'Usá horas HH:MM en cuartos de hora (por ejemplo 08:00 o 17:45).';
    }
    if (closes <= opens) return 'La hora de cierre debe ser posterior a la de apertura.';
    if (closes > 23 * 60 + 45) return 'El último cierre posible es 23:45.';
    parsed.push([opens, closes]);
  }
  parsed.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i][0] < parsed[i - 1][1]) return 'Los tramos no pueden solaparse.';
  }
  return null;
}

/** «08:00–12:00 · 14:00–18:00», o «Cerrado» si no hay tramos. */
export function describeIntervals(intervals: HourInterval[]): string {
  if (intervals.length === 0) return 'Cerrado';
  return intervals.map((i) => `${i.opens.slice(0, 5)}–${i.closes.slice(0, 5)}`).join(' · ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `AAAA-MM-DD` de una fecha en hora local. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Los próximos `count` días (hoy incluido) como fecha local; para las fichas de disponibilidad. */
export function nextDays(count: number, now: Date = new Date()): { key: string; label: string }[] {
  const days: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const label =
      i === 0
        ? 'Hoy'
        : i === 1
          ? 'Mañana'
          : day.toLocaleDateString('es', { weekday: 'short', day: 'numeric' });
    days.push({ key: localDateKey(day), label });
  }
  return days;
}

export function isDateKey(text: string): boolean {
  if (!DATE_RE.test(text.trim())) return false;
  const [y, m, d] = text.trim().split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Hora local «15:30» de un instante ISO. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Centavos enteros de un precio escrito como «12», «12.5» o «12,50», o `null` si no es válido.
 * Se hace con texto y enteros, NUNCA con coma flotante (ADR-040 fase 10): 0.1 + 0.2 no es 0.3.
 */
export function parsePriceCents(text: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return cents <= 100_000_000 ? cents : null;
}

/** Cantidad entera 1–10 000 de un campo de texto, o `null`. */
export function parseQuantity(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 1 && value <= 10_000 ? value : null;
}

export const UNIT_LABEL: Record<string, string> = {
  person: 'por persona',
  unit: 'por unidad',
  hour: 'por hora',
};

export const QUOTE_STATUS_LABEL = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
} as const;
