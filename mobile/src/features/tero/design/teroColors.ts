/**
 * Paleta propia de Tero: cyan, aqua, azul y lavanda con rostro oscuro
 * (`docs/tero/TERO_CLAUDE_PROMPTS.md`, prompt 1), autorizada por el propietario
 * del proyecto el 2026-10-08.
 *
 * Es SOLO de la mascota. No amplía ni reemplaza `@shared/design/tokens`: el
 * resto de la interfaz de Tero (fondos, textos, bordes) usa los tokens de THERS
 * para que se vea como parte de la app y siga el tema claro/oscuro.
 *
 * Los documentos de Tero nombran los colores pero no fijan valores hex. Estos son
 * los de la escala estándar de Tailwind para cada tono; si el diseño original
 * trae otros valores, se reemplazan acá y en ningún otro lugar.
 */
export const teroColors = {
  cyan: '#22d3ee',
  aqua: '#2dd4bf',
  blue: '#3b82f6',
  lavender: '#c4b5fd',
  /** Rostro oscuro: igual en tema claro y oscuro, es parte del personaje. */
  face: '#0b1220',
  eye: '#e0f2fe',
  cheek: '#f0abfc',
} as const;
