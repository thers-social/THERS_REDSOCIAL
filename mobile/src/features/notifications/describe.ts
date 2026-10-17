// Texto y destino de los avisos de THERS Places (ADR-040 fase 12). Funciones puras, sin React:
// el servidor solo manda tipo, lugar, objeto y estado; todo el texto sale de aquí. Un tipo o un
// estado desconocido nunca rompe la lista.

export type PlaceNoticeFields = {
  type: string;
  detail: string | null;
  place: { id: string; name: string } | null;
};

const RESERVATION_STATE: Record<string, string> = {
  confirmed: 'confirmó tu reserva',
  declined: 'rechazó tu reserva',
};
const QUOTE_STATE: Record<string, string> = {
  accepted: 'aceptó tu cotización',
  rejected: 'rechazó tu cotización',
};
const CLAIM_STATE: Record<string, string> = {
  approved: 'aprobó tu reclamo: ya puedes administrar el negocio',
  rejected: 'rechazó tu reclamo',
};

/** `null` si no es un aviso de Places. */
export function describePlaceNotice({ type, detail }: PlaceNoticeFields): string | null {
  switch (type) {
    case 'place_reservation_new':
      return 'tiene una nueva solicitud de reserva';
    case 'place_reservation_cancelled':
      return 'tiene una reserva cancelada por el cliente';
    case 'place_reservation_decided':
      return (detail && RESERVATION_STATE[detail]) || 'actualizó tu reserva';
    case 'place_quote_new':
      return 'tiene una nueva solicitud de cotización';
    case 'place_quote_decided':
      return (detail && QUOTE_STATE[detail]) || 'respondió tu cotización';
    case 'place_plan_invite':
      return 'te invitó a un plan';
    case 'place_claim_decided':
      return (detail && CLAIM_STATE[detail]) || 'respondió a tu reclamo';
    case 'place_review_reply':
      return 'respondió a tu reseña';
    default:
      return null;
  }
}

/** Avisos que le llegan a quien GESTIONA el lugar: abren su panel y no la ficha pública. */
const MANAGER_TYPES = new Set([
  'place_reservation_new',
  'place_reservation_cancelled',
  'place_quote_new',
]);

export type NoticeTarget =
  | { pathname: '/places/manage/[id]'; params: { id: string } }
  | { pathname: '/places/[id]'; params: { id: string } }
  | null;

export function placeNoticeTarget({ type, place }: Pick<PlaceNoticeFields, 'type' | 'place'>): NoticeTarget {
  if (!place || !type.startsWith('place_')) return null;
  // Un reclamo aprobado ya habilita el panel; el rechazado lleva a la ficha pública.
  return MANAGER_TYPES.has(type)
    ? { pathname: '/places/manage/[id]', params: { id: place.id } }
    : { pathname: '/places/[id]', params: { id: place.id } };
}
