/**
 * Motivos para reportar datos incorrectos de un lugar. Son los de
 * `backend/app/domain/places/kinds.py` (REPORT_REASONS). Si el backend añade uno, hay que
 * sumarlo aquí (un motivo desconocido lo rechaza el servidor con 400).
 */

export const REPORT_REASONS = [
  { value: 'wrong_location', label: 'Ubicación incorrecta' },
  { value: 'wrong_hours', label: 'Horario incorrecto' },
  { value: 'wrong_phone', label: 'Teléfono incorrecto' },
  { value: 'closed', label: 'El negocio cerró' },
  { value: 'duplicate', label: 'Lugar duplicado' },
  { value: 'wrong_name', label: 'Nombre incorrecto' },
  { value: 'inappropriate', label: 'Contenido inapropiado' },
  { value: 'other', label: 'Otro' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

/** Con este motivo el servidor exige un detalle. */
export const REASON_NEEDS_DETAILS: ReportReason = 'other';

export const MAX_REPORT_DETAILS = 500;
