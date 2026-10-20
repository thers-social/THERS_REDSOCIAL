// Lógica pura del carrusel de fotos de una publicación (ADR-039, 2026-10-20). Sin React ni DOM: se
// prueba con `node --test`.

/** Proporción más vertical y más panorámica que admite el marco del carrusel (ancho / alto). */
export const MIN_ASPECT = 4 / 5;
export const MAX_ASPECT = 16 / 9;

/**
 * Proporción del marco: la de la PRIMERA foto, limitada a [MIN_ASPECT, MAX_ASPECT]. Todas las fotos
 * comparten el mismo marco (como en Instagram), así que el carrusel no cambia de alto al deslizar y el
 * feed no salta.
 */
export function frameAspect(images) {
  const first = images?.[0];
  if (!first || !first.width || !first.height) return 1;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, first.width / first.height));
}

/** Qué foto está a la vista según el desplazamiento horizontal. */
export function currentIndex(scrollLeft, slideWidth, count) {
  if (!slideWidth || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / slideWidth)));
}

/** Índice al que lleva una flecha o tecla (`delta` ±1), sin salirse de [0, count - 1]. */
export function stepIndex(index, delta, count) {
  return Math.min(count - 1, Math.max(0, index + delta));
}
