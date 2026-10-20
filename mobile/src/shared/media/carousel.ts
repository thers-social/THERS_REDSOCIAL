/**
 * Lógica PURA del carrusel de fotos de una publicación (ADR-039), sin React ni módulos nativos para
 * poder probarla aislada (`tests/media.test.mjs`).
 */

type Dimensions = { width: number; height: number };

/** Foto que está a la vista según el desplazamiento horizontal del carrusel. */
export function pageIndex(offsetX: number, pageWidth: number, count: number): number {
  if (!pageWidth || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offsetX / pageWidth)));
}

/**
 * Proporción (ancho / alto) del marco: la de la PRIMERA foto, entre 4:5 y 16:9. Todas las fotos
 * comparten marco, así que el carrusel no cambia de alto al deslizar y la lista no salta.
 */
export function frameAspect(first: Dimensions | undefined): number {
  if (!first || !first.width || !first.height) return 1;
  return Math.min(16 / 9, Math.max(4 / 5, first.width / first.height));
}
