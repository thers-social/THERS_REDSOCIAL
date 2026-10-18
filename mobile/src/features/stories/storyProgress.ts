/**
 * Lógica pura del visor de historias (sin React Native): a qué historia abrir y cómo avanzar o
 * retroceder. Misma lógica que la web (`Frontend/src/features/feed/lib/storyProgress.js`),
 * probada en `tests/storyProgress.test.mjs`.
 */

/** Duración de cada historia en pantalla. */
export const STORY_DURATION_MS = 5000;

export type Position = { authorIndex: number; storyIndex: number };

/** La primera historia sin ver, o la primera si ya viste todas (volver a verlas desde el inicio). */
export function firstUnseenIndex(stories: { seen_by_me?: boolean }[]): number {
  const index = stories.findIndex((story) => !story.seen_by_me);
  return index === -1 ? 0 : index;
}

/** Siguiente posición, o `null` si ya no queda nada que mostrar (cerrar). `counts[i]` = historias de la persona `i`. */
export function nextPosition(position: Position, counts: number[]): Position | null {
  const { authorIndex, storyIndex } = position;
  if (storyIndex + 1 < counts[authorIndex]) return { authorIndex, storyIndex: storyIndex + 1 };
  if (authorIndex + 1 < counts.length) return { authorIndex: authorIndex + 1, storyIndex: 0 };
  return null;
}

/** Posición anterior; al llegar al principio se queda en la primera historia. */
export function previousPosition(position: Position, counts: number[]): Position {
  const { authorIndex, storyIndex } = position;
  if (storyIndex > 0) return { authorIndex, storyIndex: storyIndex - 1 };
  if (authorIndex > 0) {
    return { authorIndex: authorIndex - 1, storyIndex: Math.max(0, counts[authorIndex - 1] - 1) };
  }
  return { authorIndex: 0, storyIndex: 0 };
}

/** Fracción (0–1) de la barra de la historia `i` mientras se muestra la `current`. */
export function barFill(i: number, current: number, elapsedMs: number, durationMs = STORY_DURATION_MS): number {
  if (i < current) return 1;
  if (i > current) return 0;
  return Math.max(0, Math.min(1, elapsedMs / durationMs));
}
