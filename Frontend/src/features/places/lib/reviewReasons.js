// Motivos para reportar la reseña de otra persona. Son los de `REASONS` en
// `backend/app/domain/reports/kinds.py` (ADR-032/ADR-038); el texto visible vive en
// `shared/i18n` bajo `places.reviews.report.reasons.<valor>`.
//
// Si el backend añade un motivo, hay que sumarlo aquí (y en los dos locales).

export const REVIEW_REPORT_REASONS = [
  "child_safety",
  "spam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "self_harm",
  "illegal",
  "impersonation",
  "other",
];
