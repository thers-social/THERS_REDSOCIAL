/**
 * Ajustes que el servidor aplica de verdad (no preferencias locales):
 * privacidad (`ADR-022`/`ADR-023`/`ADR-024`), solicitudes de seguimiento
 * (`ADR-022`), palabras silenciadas (`ADR-024`), sesiones (`ADR-025`), edición del
 * perfil (`ADR-003`/`ADR-015`).
 */

import { request } from '@shared/lib/api';
import { appendMedia, MEDIA_UPLOAD_TIMEOUT_MS } from '@shared/media/mediaForm';
import type { PickedMedia } from '@shared/media/mediaRules';
import type { User } from '@features/auth/types';

// --- Privacidad -------------------------------------------------------------------

export type Audience = 'everyone' | 'followers' | 'nobody';

export type PrivacySettings = {
  is_private: boolean;
  pending_follow_requests_count: number;
  who_can_mention: Audience;
  who_can_message: Audience;
  hide_offensive_comments: boolean;
  show_activity_status: boolean;
  hide_sensitive_content: boolean;
  last_seen_at: string | null;
};

export type PrivacyPatch = Partial<
  Pick<
    PrivacySettings,
    | 'is_private'
    | 'who_can_mention'
    | 'who_can_message'
    | 'hide_offensive_comments'
    | 'show_activity_status'
    | 'hide_sensitive_content'
  >
>;

export async function fetchPrivacy(signal?: AbortSignal): Promise<PrivacySettings> {
  const { privacy } = await request<{ privacy: PrivacySettings }>('/users/me/privacy', {
    authenticated: true,
    signal,
  });
  return privacy;
}

export async function patchPrivacy(patch: PrivacyPatch): Promise<PrivacySettings> {
  const { privacy } = await request<{ privacy: PrivacySettings }>('/users/me/privacy', {
    method: 'PATCH',
    authenticated: true,
    body: patch,
  });
  return privacy;
}

// --- Solicitudes de seguimiento -------------------------------------------------

export type FollowRequest = {
  user: { id: string; username: string; name: string; is_private: boolean };
  requested_at: string;
};

export async function fetchFollowRequests(signal?: AbortSignal): Promise<FollowRequest[]> {
  const { follow_requests } = await request<{ follow_requests: FollowRequest[] }>(
    '/follow-requests',
    { authenticated: true, signal },
  );
  return follow_requests;
}

export function acceptFollowRequest(userId: string): Promise<unknown> {
  return request(`/follow-requests/${userId}/accept`, { method: 'POST', authenticated: true });
}

export function rejectFollowRequest(userId: string): Promise<unknown> {
  return request(`/follow-requests/${userId}`, { method: 'DELETE', authenticated: true });
}

// --- Palabras silenciadas --------------------------------------------------------

export async function fetchMutedKeywords(signal?: AbortSignal): Promise<string[]> {
  const { muted_keywords } = await request<{ muted_keywords: string[] }>(
    '/users/me/muted-keywords',
    { authenticated: true, signal },
  );
  return muted_keywords;
}

export function addMutedKeyword(keyword: string): Promise<unknown> {
  return request('/users/me/muted-keywords', {
    method: 'POST',
    authenticated: true,
    body: { keyword },
  });
}

export function removeMutedKeyword(keyword: string): Promise<unknown> {
  return request('/users/me/muted-keywords', {
    method: 'DELETE',
    authenticated: true,
    body: { keyword },
  });
}

// --- Sesiones ----------------------------------------------------------------------

export type ActiveSession = {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_used_at: string | null;
  is_current: boolean;
};

export async function fetchSessions(signal?: AbortSignal): Promise<ActiveSession[]> {
  const { sessions } = await request<{ sessions: ActiveSession[] }>('/sessions', {
    authenticated: true,
    signal,
  });
  return sessions;
}

export function closeSession(sessionId: string): Promise<unknown> {
  return request(`/sessions/${sessionId}`, { method: 'DELETE', authenticated: true });
}

/** Cierra todas las sesiones menos la actual. */
export function closeOtherSessions(): Promise<unknown> {
  return request('/sessions', { method: 'DELETE', authenticated: true });
}

// --- Perfil -------------------------------------------------------------------------

export type ProfilePatch = Partial<Pick<User, 'name' | 'bio' | 'location' | 'website'>>;

/**
 * Foto de perfil (`ADR-015`): `POST /api/users/me/avatar` con el archivo en el campo `file`. El servidor
 * la decodifica por su contenido, la reduce y la guarda sin metadatos; devuelve la cuenta actualizada.
 */
export async function uploadAvatar(media: PickedMedia): Promise<User> {
  const form = new FormData();
  appendMedia(form, 'file', media);
  const { user } = await request<{ user: User }>('/users/me/avatar', {
    method: 'POST',
    authenticated: true,
    body: form,
    timeoutMs: MEDIA_UPLOAD_TIMEOUT_MS,
  });
  return user;
}

export async function removeAvatar(): Promise<User> {
  const { user } = await request<{ user: User }>('/users/me/avatar', {
    method: 'DELETE',
    authenticated: true,
  });
  return user;
}

export async function patchProfile(patch: ProfilePatch): Promise<User> {
  const { user } = await request<{ user: User }>('/users/me', {
    method: 'PATCH',
    authenticated: true,
    body: patch,
  });
  return user;
}
