/**
 * Notificaciones dentro de la app (`API_CONTRACT.md` §4.7). NO son notificaciones
 * push: son filas del servidor que se consultan; las push son una fase posterior
 * y no sustituyen a estas.
 */

import { request } from '@shared/lib/api';

import { describePlaceNotice } from './describe';

export type NotificationType =
  | 'like'
  | 'comment'
  | 'follow'
  | 'follow_request'
  | 'follow_accepted'
  | 'mention'
  // ADR-040 fase 12: avisos de Places (texto y destino en `describe.ts`).
  | 'place_reservation_new'
  | 'place_reservation_decided'
  | 'place_reservation_cancelled'
  | 'place_quote_new'
  | 'place_quote_decided'
  | 'place_plan_invite'
  | 'place_claim_decided'
  | 'place_review_reply'
  | string;

export type AppNotification = {
  id: string;
  type: NotificationType;
  /** Nulo solo en `place_claim_decided`: no se dice qué cuenta de moderación decidió. */
  actor: { id: string; username: string; name: string; avatar_url: string | null } | null;
  post_id: string | null;
  /** Solo en los avisos de Places. */
  place: { id: string; name: string } | null;
  object_id: string | null;
  detail: string | null;
  read: boolean;
  created_at: string;
};

export async function fetchNotifications(signal?: AbortSignal): Promise<AppNotification[]> {
  const { notifications } = await request<{ notifications: AppNotification[] }>('/notifications', {
    authenticated: true,
    signal,
  });
  return notifications;
}

export function markNotificationRead(id: string): Promise<unknown> {
  return request(`/notifications/${id}/read`, { method: 'PATCH', authenticated: true });
}

/** Texto de la notificación, según su tipo. Un tipo desconocido no rompe la lista. */
export function describeNotification(type: NotificationType, detail: string | null = null): string {
  const placeText = describePlaceNotice({ type, detail, place: null });
  if (placeText) return placeText;
  switch (type) {
    case 'like':
      return 'le dio me gusta a tu publicación';
    case 'comment':
      return 'comentó tu publicación';
    case 'follow':
      return 'empezó a seguirte';
    case 'follow_request':
      return 'quiere seguirte';
    case 'follow_accepted':
      return 'aceptó tu solicitud';
    case 'mention':
      return 'te mencionó';
    default:
      return 'tiene novedades para ti';
  }
}
