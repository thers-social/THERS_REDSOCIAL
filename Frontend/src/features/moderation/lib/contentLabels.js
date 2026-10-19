// Textos del panel de moderación de CONTENIDO y de las apelaciones (ADR-044 §2.6–§2.7). Es una
// herramienta interna: español, sin `shared/i18n`. Funciones puras para poder probarlas.

export const SECTIONS = [
  { value: "reports", label: "Reportes", adminOnly: false },
  { value: "media", label: "Retenidos", adminOnly: false },
  { value: "appeals", label: "Apelaciones", adminOnly: false },
  { value: "stats", label: "Estadísticas", adminOnly: false },
  { value: "audit", label: "Auditoría", adminOnly: true },
];

export const MEDIA_TABS = [
  { value: "held", label: "Retenidos" },
  { value: "pending", label: "Pendientes" },
  { value: "rejected", label: "Rechazados" },
];

// Tipos de contenido que pasan por la moderación (`?type=` del servidor).
export const CONTENT_KINDS = [
  { value: "media", label: "Imágenes" },
  { value: "story", label: "Historias" },
  { value: "video", label: "Reels" },
];

export const APPEAL_TABS = [
  { value: "open", label: "Abiertas" },
  { value: "upheld", label: "Mantenidas" },
  { value: "overturned", label: "Revertidas" },
];

export const DECISIONS = {
  approved: { label: "Aprobar", success: "Imagen aprobada", tone: "primary" },
  held: { label: "Mantener retenida", success: "Imagen retenida", tone: "neutral" },
  rejected: { label: "Rechazar", success: "Imagen rechazada", tone: "danger" },
};

export const OUTCOMES = {
  upheld: { label: "Mantener la decisión", success: "Apelación rechazada: se mantiene la decisión" },
  overturned: { label: "Revertir y aprobar", success: "Apelación aceptada: la imagen se aprobó" },
};

const REASONS = {
  unclassified: "No se pudo clasificar",
  critical_category: "Señal de seguridad infantil o ilegal",
  severe_signal: "Señal grave",
  open_reports: "Hay reportes abiertos contra la cuenta",
  doubtful_signal: "Señal dudosa",
  new_account: "Cuenta nueva",
  new_account_low_doubt: "Cuenta nueva con señal leve",
};

const CATEGORIES = {
  sexual: "Sexual",
  violence: "Violencia",
  hate: "Odio",
  harassment: "Acoso",
  self_harm: "Autolesión",
  spam: "Spam",
  illegal: "Ilegal",
  child_safety: "Seguridad infantil",
};

const PARENTS = { post: "Publicación", message: "Mensaje", review: "Reseña de lugar", reel: "Reel" };
const PRIORITIES = { critical: "Crítica", high: "Alta", normal: "Normal" };

export const reasonText = (reason) => REASONS[reason] || reason || "—";
export const categoryText = (category) => CATEGORIES[category] || category;
export const parentText = (parent) => PARENTS[parent] || parent;
export const priorityText = (priority) => PRIORITIES[priority] || PRIORITIES.normal;

// Puntajes ordenados de mayor a menor, como porcentaje entero.
export function topScores(scores, limit = 3) {
  return Object.entries(scores || {})
    .filter(([, value]) => typeof value === "number" && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, value]) => ({ category, label: categoryText(category), percent: Math.round(value * 100) }));
}

// El servidor responde 403 con este código cuando la cuenta moderadora no tiene 2FA activa.
export const TWO_FACTOR_CODE = "two_factor_required";

export function isTwoFactorRequired(error) {
  return error?.response?.status === 403 && error?.response?.data?.code === TWO_FACTOR_CODE;
}

export function canSeeSection(section, user) {
  if (!user?.is_moderator) return false;
  return !section.adminOnly || user.moderation_role === "admin";
}

export function hoursLabel(hours) {
  if (hours == null) return "—";
  return hours < 1 ? "menos de 1 h" : `${Math.round(hours)} h`;
}
