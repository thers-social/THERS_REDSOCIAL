// Textos de la página de moderación (ADR-032-content-reports-and-moderation.md, fase 3).
// Es una herramienta interna del equipo: está en español y no pasa por `shared/i18n`,
// que cubre solo lo que ve la comunidad.

// Los motivos son los de `backend/app/domain/reports/kinds.py`. Si el backend añade uno,
// `tests/moderation.test.mjs` no lo sabe: al añadirlo hay que sumarlo aquí también (un
// motivo desconocido se muestra tal cual, sin romper la página).
export const REASON_LABELS = {
  spam: "Spam",
  harassment: "Acoso",
  hate: "Odio",
  sexual: "Contenido sexual",
  violence: "Violencia",
  self_harm: "Autolesión",
  illegal: "Contenido ilegal",
  impersonation: "Suplantación",
  other: "Otro",
  child_safety: "Explotación o abuso de menores",
};

export const TARGET_LABELS = {
  post: "Publicación",
  comment: "Comentario",
  message: "Mensaje",
  user: "Cuenta",
  review: "Reseña de lugar",
};

export const STATUS_TABS = [
  { value: "open", label: "Abiertos" },
  { value: "actioned", label: "Con acción" },
  { value: "dismissed", label: "Descartados" },
];

export const ACTIONS = {
  dismiss: {
    title: "Descartar reporte",
    description: "El reporte se cierra sin tocar el contenido ni la cuenta.",
    confirmLabel: "Descartar",
    success: "Reporte descartado",
    destructive: false,
  },
  remove_content: {
    title: "Retirar contenido",
    description:
      "El contenido se borra de forma definitiva y también se cierran los demás reportes abiertos sobre él.",
    confirmLabel: "Retirar contenido",
    success: "Contenido retirado",
    destructive: true,
  },
  suspend_user: {
    title: "Suspender cuenta",
    description:
      "La persona no podrá iniciar sesión y todas sus sesiones abiertas se cierran de inmediato.",
    confirmLabel: "Suspender cuenta",
    success: "Cuenta suspendida",
    destructive: true,
  },
};

export const MAX_TEXT_LENGTH = 500;

export const DEFAULT_SUSPENSION_REASON =
  "Tu cuenta fue suspendida por incumplir las normas de la comunidad.";

export function reasonLabel(reason) {
  return REASON_LABELS[reason] || reason;
}

// Los errores propios de moderación (400, 403, 404, 409) traen un mensaje pensado para
// quien modera; `getErrorMessage` los reemplazaría por uno genérico.
export function moderationErrorMessage(error, fallback) {
  const status = error?.response?.status;
  const msg = error?.response?.data?.msg;
  if (msg && [400, 403, 404, 409].includes(status)) return msg;
  return fallback;
}
