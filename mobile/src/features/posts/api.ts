/**
 * Llamadas HTTP de publicaciones, me gusta, comentarios y seguidos. Cada función
 * es una sola petición del contrato (`API_CONTRACT.md` §4.3 a §4.6); la lógica de
 * estado vive en `PostsContext`, no aquí.
 */

import { request } from '@shared/lib/api';
import { appendMedia, MEDIA_UPLOAD_TIMEOUT_MS } from '@shared/media/mediaForm';
import type { PickedMedia } from '@shared/media/mediaRules';

import type { FollowStatus, Post, PostComment } from './types';

export async function fetchPosts(signal?: AbortSignal): Promise<Post[]> {
  const { posts } = await request<{ posts: Post[] }>('/posts', { authenticated: true, signal });
  return posts;
}

/**
 * Publica. Sin archivos manda JSON, como siempre; con fotos (campo `images`, hasta 4) o con un video
 * (campo `video`, `ADR-046`) manda `multipart/form-data`. El texto puede ir vacío si hay archivos.
 */
export async function createPost(
  content: string,
  isSensitive: boolean,
  placeId?: string,
  media: PickedMedia[] = [],
  audience: 'everyone' | 'close_friends' = 'everyone',
): Promise<Post> {
  if (media.length === 0) {
    const { post } = await request<{ post: Post }>('/posts', {
      method: 'POST',
      authenticated: true,
      body: {
        content,
        is_sensitive: isSensitive,
        ...(placeId ? { place_id: placeId } : {}),
        // Solo se envía si no es la de siempre: el servidor trata la ausencia como `everyone`.
        ...(audience !== 'everyone' ? { audience } : {}),
      },
    });
    return post;
  }
  const form = new FormData();
  form.append('content', content);
  form.append('is_sensitive', String(isSensitive));
  if (placeId) form.append('place_id', placeId);
  if (audience !== 'everyone') form.append('audience', audience);
  for (const item of media) appendMedia(form, item.kind === 'video' ? 'video' : 'images', item);
  const { post } = await request<{ post: Post }>('/posts', {
    method: 'POST',
    authenticated: true,
    body: form,
    timeoutMs: MEDIA_UPLOAD_TIMEOUT_MS,
  });
  return post;
}

export async function updatePost(postId: string, content: string): Promise<Post> {
  const { post } = await request<{ post: Post }>(`/posts/${postId}`, {
    method: 'PATCH',
    authenticated: true,
    body: { content },
  });
  return post;
}

export async function deletePost(postId: string): Promise<void> {
  await request(`/posts/${postId}`, { method: 'DELETE', authenticated: true });
}

/** Guardar (`ADR-047`): privado e idempotente; el servidor devuelve el estado final. */
export async function setPostSaved(postId: string, saved: boolean): Promise<boolean> {
  const result = await request<{ saved: boolean }>(`/posts/${postId}/save`, {
    method: saved ? 'POST' : 'DELETE',
    authenticated: true,
  });
  return result.saved;
}

/** Las publicaciones guardadas, la última guardada primero. */
export async function fetchSavedPosts(signal?: AbortSignal): Promise<Post[]> {
  const { posts } = await request<{ posts: Post[] }>('/posts/saved', { authenticated: true, signal });
  return posts;
}

export type LikeResult = { likes_count: number; liked_by_me: boolean };

export function likePost(postId: string): Promise<LikeResult> {
  return request<LikeResult>(`/posts/${postId}/like`, { method: 'POST', authenticated: true });
}

export function unlikePost(postId: string): Promise<LikeResult> {
  return request<LikeResult>(`/posts/${postId}/like`, { method: 'DELETE', authenticated: true });
}

export async function fetchComments(postId: string, signal?: AbortSignal): Promise<PostComment[]> {
  const { comments } = await request<{ comments: PostComment[] }>(`/posts/${postId}/comments`, {
    authenticated: true,
    signal,
  });
  return comments;
}

export async function createComment(postId: string, content: string): Promise<PostComment> {
  const { comment } = await request<{ comment: PostComment }>(`/posts/${postId}/comments`, {
    method: 'POST',
    authenticated: true,
    body: { content },
  });
  return comment;
}

export async function updateComment(commentId: string, content: string): Promise<PostComment> {
  const { comment } = await request<{ comment: PostComment }>(`/comments/${commentId}`, {
    method: 'PATCH',
    authenticated: true,
    body: { content },
  });
  return comment;
}

export async function deleteComment(commentId: string): Promise<void> {
  await request(`/comments/${commentId}`, { method: 'DELETE', authenticated: true });
}

export type FollowResult = { following: boolean; follow_status: FollowStatus };

export function followUser(userId: string): Promise<FollowResult> {
  return request<FollowResult>(`/users/${userId}/follow`, { method: 'POST', authenticated: true });
}

export function unfollowUser(userId: string): Promise<FollowResult> {
  return request<FollowResult>(`/users/${userId}/follow`, { method: 'DELETE', authenticated: true });
}

export type SuggestedUser = {
  id: string;
  name: string;
  username: string;
  is_private: boolean;
  avatar_url?: string | null;
};

export async function fetchSuggestions(signal?: AbortSignal, limit?: number): Promise<SuggestedUser[]> {
  const { suggestions } = await request<{ suggestions: SuggestedUser[] }>(`/users/suggestions${limit ? `?limit=${limit}` : ''}`, {
    authenticated: true,
    signal,
  });
  return suggestions;
}
