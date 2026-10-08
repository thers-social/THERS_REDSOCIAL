/**
 * Cliente de THERS Places (contrato: `API_CONTRACT.md` §4.23 y §4.24, ADR-040).
 *
 * Todas las llamadas van autenticadas: la app solo muestra estas pantallas con sesión y así
 * el servidor marca `is_saved`. Las coordenadas se redondean a 3 decimales aquí, ANTES de
 * salir (ADR-040 §4.4).
 */

import { request } from '@shared/lib/api';

import { roundPoint } from './coordinates';
import type { ReportReason } from './placeReasons';
import type { LatLng, PlaceCategory, PlaceDetail, PlaceSummary } from './types';

type Query = Record<string, string | number | undefined>;

function withQuery(path: string, query: Query): string {
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

export async function fetchCategories(signal?: AbortSignal): Promise<PlaceCategory[]> {
  const { categories } = await request<{ categories: PlaceCategory[] }>('/places/categories', {
    authenticated: true,
    signal,
  });
  return categories;
}

export async function fetchNearby(
  params: { origin: LatLng; radius: number; category?: string; limit: number },
  signal?: AbortSignal,
): Promise<PlaceSummary[]> {
  const point = roundPoint(params.origin);
  const { places } = await request<{ places: PlaceSummary[] }>(
    withQuery('/places/nearby', {
      lat: point.lat,
      lng: point.lng,
      radius: Math.round(params.radius),
      category: params.category,
      limit: params.limit,
    }),
    { authenticated: true, signal },
  );
  return places;
}

export async function searchPlaces(
  params: { q: string; origin?: LatLng; category?: string; limit: number },
  signal?: AbortSignal,
): Promise<PlaceSummary[]> {
  const point = params.origin ? roundPoint(params.origin) : undefined;
  const { places } = await request<{ places: PlaceSummary[] }>(
    withQuery('/places/search', {
      q: params.q,
      lat: point?.lat,
      lng: point?.lng,
      category: params.category,
      limit: params.limit,
    }),
    { authenticated: true, signal },
  );
  return places;
}

export async function fetchPlace(id: string, signal?: AbortSignal): Promise<PlaceDetail> {
  const { place } = await request<{ place: PlaceDetail }>(`/places/${id}`, {
    authenticated: true,
    signal,
  });
  return place;
}

export async function savePlace(id: string): Promise<boolean> {
  const { saved } = await request<{ saved: boolean }>(`/places/${id}/save`, {
    method: 'POST',
    authenticated: true,
  });
  return saved;
}

export async function unsavePlace(id: string): Promise<boolean> {
  const { saved } = await request<{ saved: boolean }>(`/places/${id}/save`, {
    method: 'DELETE',
    authenticated: true,
  });
  return saved;
}

export function reportPlace(
  id: string,
  report: { reason: ReportReason; details?: string },
): Promise<unknown> {
  return request(`/places/${id}/report`, {
    method: 'POST',
    authenticated: true,
    body: report,
  });
}
