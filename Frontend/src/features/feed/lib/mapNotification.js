// Traduce la forma cruda que devuelve GET /api/notifications
// (ADR-008-notifications-minimal-model.md) a la forma que Notifications.jsx
// ya sabe renderizar (heredada de mockNotifications) -- así ese componente
// no necesita reescribirse, solo dejar de recibir datos inventados.
//
// `photo`: `actor.avatar_url` (ADR-015-profile-media.md); sin foto, Avatar.jsx
// renderiza iniciales.
import { formatRelativeTime } from "./formatRelativeTime";

const DETAIL_BY_TYPE = {
  like: "reaccionó a tu Cápsula",
  comment: "comentó tu Cápsula",
  follow: "comenzó a seguirte",
  // ADR-022-private-accounts.md
  follow_request: "quiere seguirte",
  follow_accepted: "aceptó tu solicitud",
  // ADR-023-mentions.md
  mention: "te mencionó",
};

// ADR-040 fase 12: avisos de Places. El servidor manda tipo, lugar, objeto y estado; todo el
// texto sale de aquí. Un estado desconocido cae en un texto genérico, nunca rompe la lista.
const PLACE_DETAIL = {
  place_reservation_new: () => "tiene una nueva solicitud de reserva",
  place_reservation_cancelled: () => "tiene una reserva cancelada por el cliente",
  place_reservation_decided: (d) =>
    ({ confirmed: "confirmó tu reserva", declined: "rechazó tu reserva" })[d] || "actualizó tu reserva",
  place_quote_new: () => "tiene una nueva solicitud de cotización",
  place_quote_decided: (d) =>
    ({ accepted: "aceptó tu cotización", rejected: "rechazó tu cotización" })[d] || "respondió tu cotización",
  place_plan_invite: () => "te invitó a un plan",
  place_claim_decided: (d) =>
    ({ approved: "aprobó tu reclamo: ya puedes administrar el negocio", rejected: "rechazó tu reclamo" })[d] ||
    "respondió a tu reclamo",
  place_review_reply: () => "respondió a tu reseña",
};

export const isPlaceNotice = (type) => Object.prototype.hasOwnProperty.call(PLACE_DETAIL, type);

// "Importante" en el sentido que Notifications.jsx ya usaba para
// mockNotifications (una sección separada, más destacada) -- los eventos de
// relación y las menciones directas ameritan esa jerarquía; like/comment van a
// "Actividad reciente". `follow_request` entra porque pide una acción (hay que
// aprobarla o rechazarla, en Configuración › Privacidad), no solo informa.
// Puramente una regla de presentación del Frontend, no una columna del backend
// (ADR-008 §Modelo de datos no incluye ningún campo de prioridad).
const IMPORTANT_TYPES = new Set([
  "follow",
  "follow_request",
  "follow_accepted",
  "mention",
  // Piden atención o resuelven algo que la persona esperaba.
  "place_reservation_new",
  "place_quote_new",
  "place_reservation_decided",
  "place_quote_decided",
  "place_claim_decided",
]);

export function mapNotification(raw) {
  const placeNotice = isPlaceNotice(raw.type);
  return {
    id: raw.id,
    type: raw.type,
    // En los avisos de Places el protagonista es el lugar (y `actor` puede ser nulo).
    actor: placeNotice ? raw.place?.name ?? "Un lugar" : raw.actor?.name ?? "THERS",
    photo: placeNotice ? null : raw.actor?.avatar_url ?? null,
    detail: placeNotice ? PLACE_DETAIL[raw.type](raw.detail) : DETAIL_BY_TYPE[raw.type] || "",
    time: formatRelativeTime(raw.created_at),
    important: IMPORTANT_TYPES.has(raw.type),
    read: raw.read,
  };
}
