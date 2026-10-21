/**
 * Llamadas HTTP de Reels (`API_CONTRACT.md` §4.40). Una función por petición; el estado vive en la
 * pantalla.
 */

import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';

import { request } from '@shared/lib/api';

import type { ReelComment, ReelFeed, ReelVideo, UploadReservation } from './types';

export function fetchFeed(offset = 0, signal?: AbortSignal): Promise<ReelFeed> {
  return request<ReelFeed>(`/videos?limit=10&offset=${offset}`, { authenticated: true, signal });
}

/** Los Reels que guardó la persona (ADR-055). Mismo formato que el feed. */
export function fetchSaved(offset = 0, signal?: AbortSignal): Promise<ReelFeed> {
  return request<ReelFeed>(`/videos/saved?limit=10&offset=${offset}`, { authenticated: true, signal });
}

export async function fetchMine(signal?: AbortSignal): Promise<ReelVideo[]> {
  const { videos } = await request<{ videos: ReelVideo[] }>('/videos/mine', { authenticated: true, signal });
  return videos;
}

/** Un Reel, con su token de reproducción nuevo (el HLS firmado dura 1 hora). */
export async function fetchVideo(id: string, signal?: AbortSignal): Promise<ReelVideo> {
  const { video } = await request<{ video: ReelVideo }>(`/videos/${id}`, { authenticated: true, signal });
  return video;
}

/** Reserva una subida directa a Mux. La clave idempotente viaja en el cuerpo. */
export async function reserveUpload(caption: string, idempotencyKey: string): Promise<UploadReservation> {
  const body: Record<string, string> = { idempotency_key: idempotencyKey };
  if (caption.trim()) body.caption = caption.trim();
  const { video } = await request<{ video: UploadReservation }>('/videos/uploads', {
    method: 'POST',
    body,
    authenticated: true,
  });
  return video;
}

/**
 * Sube el archivo DIRECTO a Mux (no pasa por Flask). La URL es de un solo uso y no lleva
 * credenciales de THERS, por eso aquí NO se manda el JWT.
 *
 * Se manda con `uploadAsync` (el sistema lee el archivo desde el disco y lo envía por partes): cargar
 * un video de decenas de MB como `Blob` en memoria falla o va muy lento en teléfonos modestos.
 */
export async function uploadToMux(uploadUrl: string, fileUri: string): Promise<void> {
  const result = await uploadAsync(uploadUrl, fileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
  });
  if (result.status < 200 || result.status >= 300) throw new Error('upload_failed');
}

export async function deleteVideo(id: string): Promise<void> {
  await request(`/videos/${id}`, { method: 'DELETE', authenticated: true });
}

// --- Interacciones (ADR-055) ---------------------------------------------------------------------

export function setLike(id: string, liked: boolean): Promise<{ liked: boolean; likes_count: number }> {
  return request(`/videos/${id}/like`, { method: liked ? 'POST' : 'DELETE', authenticated: true });
}

export function setSave(id: string, saved: boolean): Promise<{ saved: boolean }> {
  return request(`/videos/${id}/save`, { method: saved ? 'POST' : 'DELETE', authenticated: true });
}

export async function fetchComments(
  id: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<{ comments: ReelComment[]; has_more: boolean }> {
  return request(`/videos/${id}/comments?limit=20&offset=${offset}`, { authenticated: true, signal });
}

export async function postComment(id: string, content: string): Promise<ReelComment> {
  const { comment } = await request<{ comment: ReelComment }>(`/videos/${id}/comments`, {
    method: 'POST',
    body: { content },
    authenticated: true,
  });
  return comment;
}

export async function deleteComment(videoId: string, commentId: string): Promise<void> {
  await request(`/videos/${videoId}/comments/${commentId}`, { method: 'DELETE', authenticated: true });
}
