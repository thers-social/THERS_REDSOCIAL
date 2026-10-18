/**
 * Llamadas HTTP de Reels (`API_CONTRACT.md` §4.40). Una función por petición; el estado vive en la
 * pantalla.
 */

import { request } from '@shared/lib/api';

import type { ReelFeed, ReelVideo, UploadReservation } from './types';

export function fetchFeed(offset = 0, signal?: AbortSignal): Promise<ReelFeed> {
  return request<ReelFeed>(`/videos?limit=10&offset=${offset}`, { authenticated: true, signal });
}

export async function fetchMine(signal?: AbortSignal): Promise<ReelVideo[]> {
  const { videos } = await request<{ videos: ReelVideo[] }>('/videos/mine', { authenticated: true, signal });
  return videos;
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
 */
export async function uploadToMux(uploadUrl: string, fileUri: string): Promise<void> {
  const file = await (await fetch(fileUri)).blob();
  const response = await fetch(uploadUrl, { method: 'PUT', body: file });
  if (!response.ok) throw new Error('upload_failed');
}

export async function deleteVideo(id: string): Promise<void> {
  await request(`/videos/${id}`, { method: 'DELETE', authenticated: true });
}
