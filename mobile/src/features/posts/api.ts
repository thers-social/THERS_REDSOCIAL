/**
 * Llamadas HTTP de publicaciones, me gusta, comentarios y seguidos. Cada función
 * es una sola petición del contrato (`API_CONTRACT.md` §4.3 a §4.6); la lógica de
 * estado vive en `PostsContext`, no aquí.
 */

import { request } from '@shared/lib/api';

import type { FollowStatus, Post, PostComment } from './types';

export async function fetchPosts(signal?: AbortSignal): Promise<Post[]> {
  const { posts } = await request<{ posts: Post[] }>('/posts', { authenticated: true, signal });
  return posts;
}

export async function createPost(
  content: string,
  isSensitive: boolean,
  placeId?: string,
): Promise<Post> {
  const { post } = await request<{ post: Post }>('/posts', {
    method: 'POST',
    authenticated: true,
    body: { content, is_sensitive: isSensitive, ...(placeId ? { place_id: placeId } : {}) },
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

export type SuggestedUser = { id: string; name: string; username: string; is_private: boolean };

export async function fetchSuggestions(signal?: AbortSignal): Promise<SuggestedUser[]> {
  const { suggestions } = await request<{ suggestions: SuggestedUser[] }>('/users/suggestions', {
    authenticated: true,
    signal,
  });
  return suggestions;
}
