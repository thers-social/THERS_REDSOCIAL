// Motivos para reportar datos incorrectos de un lugar. Son los de
// `backend/app/domain/places/kinds.py` (REPORT_REASONS); el texto visible vive en
// `shared/i18n` bajo `places.report.reasons.<valor>`.
//
// Si el backend añade un motivo, hay que sumarlo aquí (y en los dos locales).

export const REPORT_REASONS = [
  "wrong_location",
  "wrong_hours",
  "wrong_phone",
  "closed",
  "duplicate",
  "wrong_name",
  "inappropriate",
  "other",
];

// Con este motivo el backend exige un detalle (`details`).
export const REASON_NEEDS_DETAILS = "other";

export const MAX_REPORT_DETAILS = 500;
