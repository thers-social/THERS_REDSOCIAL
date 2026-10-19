/**
 * A dónde lleva tocar una notificación push (`ADR-053`). Función pura: recibe el `data` que mandó el
 * servidor y devuelve la ruta de la app. Los identificadores vienen de fuera de la app, así que solo se
 * aceptan si tienen forma de UUID; cualquier otra cosa lleva a la lista de avisos.
 */

import type { Href } from 'expo-router';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/** Avisos que le llegan a quien GESTIONA el lugar: abren su panel y no la ficha pública. */
const MANAGER_PLACE_TYPES = new Set([
  'place_reservation_new',
  'place_reservation_cancelled',
  'place_quote_new',
]);

export function routeForNotification(data: Record<string, unknown> | null | undefined): Href {
  const payload = data ?? {};
  switch (payload.type) {
    case 'message': {
      const userId = id(payload.sender_id);
      if (userId) return { pathname: '/chat/[userId]', params: { userId } };
      break;
    }
    case 'group_message': {
      const groupId = id(payload.group_id);
      if (groupId) return { pathname: '/group/[groupId]', params: { groupId } };
      break;
    }
    case 'follow':
    case 'follow_accepted': {
      const userId = id(payload.actor_id);
      if (userId) return { pathname: '/user/[userId]', params: { userId } };
      break;
    }
    case 'follow_request':
      return '/settings/follow-requests';
    case 'like':
    case 'comment':
    case 'mention': {
      const postId = id(payload.post_id);
      if (postId) return { pathname: '/post/[id]', params: { id: postId } };
      break;
    }
  }
  if (typeof payload.type === 'string' && payload.type.startsWith('place_')) {
    // Avisos de THERS Places (reservas, cotizaciones, planes, reclamos, reseñas): el lugar, no la lista.
    const placeId = id(payload.place_id);
    if (placeId) {
      return MANAGER_PLACE_TYPES.has(payload.type)
        ? { pathname: '/places/manage/[id]', params: { id: placeId } }
        : { pathname: '/places/[id]', params: { id: placeId } };
    }
  }
  return '/notifications';
}
