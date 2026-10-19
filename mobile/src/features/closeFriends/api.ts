/**
 * Mejores amigos (`ADR-054`, `API_CONTRACT.md` §4.47). La lista es privada: solo quien la hace la ve.
 * Con las historias apagadas en el servidor (`STORIES_ENABLED`) todo responde 404.
 */

import { request } from '@shared/lib/api';

export type CloseFriend = {
  id: string;
  username: string;
  name: string;
  avatar_url: string | null;
  added_at: string;
};

export async function fetchCloseFriends(
  signal?: AbortSignal,
): Promise<{ friends: CloseFriend[]; limit: number }> {
  return request<{ friends: CloseFriend[]; limit: number }>('/close-friends', {
    authenticated: true,
    signal,
  });
}

export async function addCloseFriend(userId: string): Promise<void> {
  await request('/close-friends', { method: 'POST', authenticated: true, body: { user_id: userId } });
}

export async function removeCloseFriend(userId: string): Promise<void> {
  await request(`/close-friends/${userId}`, { method: 'DELETE', authenticated: true });
}
