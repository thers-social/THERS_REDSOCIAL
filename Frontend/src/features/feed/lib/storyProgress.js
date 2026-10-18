// Lógica pura del visor de historias (sin React): avanzar, retroceder y a qué historia abrir.
// Probada en `tests/storyProgress.test.mjs`.

/** Duración de cada historia en pantalla. */
export const STORY_DURATION_MS = 5000;

/**
 * Posición inicial al abrir las historias de una persona: la primera que todavía no viste, o la
 * primera si ya las viste todas (volver a verlas desde el principio).
 */
export function firstUnseenIndex(stories) {
  const index = stories.findIndex((story) => !story.seen_by_me);
  return index === -1 ? 0 : index;
}

/**
 * Siguiente posición dentro de la lista de personas de la tira.
 * `{authorIndex, storyIndex}` o `null` si ya no queda nada que mostrar (cerrar).
 * `counts[i]` es cuántas historias tiene la persona `i`.
 */
export function nextPosition({ authorIndex, storyIndex }, counts) {
  if (storyIndex + 1 < counts[authorIndex]) return { authorIndex, storyIndex: storyIndex + 1 };
  if (authorIndex + 1 < counts.length) return { authorIndex: authorIndex + 1, storyIndex: 0 };
  return null;
}

/** Posición anterior; al llegar al principio se queda en la primera historia. */
export function previousPosition({ authorIndex, storyIndex }, counts) {
  if (storyIndex > 0) return { authorIndex, storyIndex: storyIndex - 1 };
  if (authorIndex > 0) {
    return { authorIndex: authorIndex - 1, storyIndex: Math.max(0, counts[authorIndex - 1] - 1) };
  }
  return { authorIndex: 0, storyIndex: 0 };
}

/** Fracción (0–1) de la barra de la historia `i` mientras se muestra la `current`. */
export function barFill(i, current, elapsedMs, durationMs = STORY_DURATION_MS) {
  if (i < current) return 1;
  if (i > current) return 0;
  return Math.max(0, Math.min(1, elapsedMs / durationMs));
}
