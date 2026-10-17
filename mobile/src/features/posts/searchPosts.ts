/**
 * Búsqueda sobre las publicaciones YA cargadas, igual que la web: el backend no
 * tiene endpoint de búsqueda (`GET /api/posts` devuelve las 50 más recientes), así
 * que se filtra en el cliente y la interfaz lo dice. Lógica pura, probada en
 * `tests/searchPosts.test.mjs`.
 */

import type { Post } from './types';

/** Minúsculas y sin tildes: «jose» encuentra «José». */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export type SearchSort = 'recent' | 'likes';

/** Filtro de fecha sobre `created_at`, que viaja con cada publicación real. */
export type SearchDate = 'any' | 'day' | 'week' | 'month';

const HOUR = 60 * 60 * 1000;
const DATE_WINDOWS: Record<SearchDate, number | null> = {
  any: null,
  day: 24 * HOUR,
  week: 7 * 24 * HOUR,
  month: 30 * 24 * HOUR,
};

export const SEARCH_DATES: { id: SearchDate; label: string }[] = [
  { id: 'any', label: 'Cualquier fecha' },
  { id: 'day', label: '24 horas' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
];

/** Una fecha inválida o claramente futura no pasa un filtro con ventana. */
export function withinDate(createdAt: string, range: SearchDate, now: number = Date.now()): boolean {
  const window = DATE_WINDOWS[range];
  if (window === null || window === undefined) return true;
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return false;
  return now - time <= window && time <= now + HOUR;
}

/**
 * Publicaciones cuyo texto, nombre de autor o @usuario contienen TODAS las
 * palabras de la consulta (en cualquier orden). Una consulta vacía no devuelve
 * nada: «todavía no buscaste» es distinto de «sin resultados».
 */
export function searchPosts(
  posts: Post[],
  query: string,
  sort: SearchSort = 'recent',
  date: SearchDate = 'any',
  now: number = Date.now(),
): Post[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const matches = posts.filter((post) => {
    if (!withinDate(post.created_at, date, now)) return false;
    const haystack = normalize(`${post.content} ${post.author.name} ${post.author.username}`);
    return words.every((word) => haystack.includes(word));
  });

  return [...matches].sort((a, b) => {
    if (sort === 'likes' && b.likes_count !== a.likes_count) return b.likes_count - a.likes_count;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}
