// El idioma de las fechas lo fija el proveedor de idiomas (`@shared/i18n`) con `setTimeLanguage`. Es una
// variable de módulo (y no un parámetro) para que las 15 pantallas que ya llaman a estas funciones
// cambien de idioma sin tocarlas. Este archivo no importa nada: `node --test` lo carga tal cual.
type TimeLanguage = 'es' | 'en';
let language: TimeLanguage = 'es';

export function setTimeLanguage(next: TimeLanguage) {
  language = next;
}

/**
 * "hace 5 min", "ayer", "12 oct" (o "5 min ago", "yesterday", "Oct 12"). Pensado para listas: corto y sin
 * dependencias. `now` se inyecta para poder probar la función con una fecha fija.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const time = then.getTime();
  if (Number.isNaN(time)) return '';
  const en = language === 'en';

  const seconds = Math.max(0, Math.floor((now.getTime() - time) / 1000));
  if (seconds < 45) return en ? 'now' : 'ahora';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return en ? `${Math.max(1, minutes)} min ago` : `hace ${Math.max(1, minutes)} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return en ? `${hours} h ago` : `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return en ? 'yesterday' : 'ayer';
  if (days < 7) return en ? `${days} d ago` : `hace ${days} d`;

  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Hora corta de un mensaje: "14:05". */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
}
