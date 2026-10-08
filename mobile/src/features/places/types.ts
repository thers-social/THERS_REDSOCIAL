/** Tipos de THERS Places en la app. Contrato: `API_CONTRACT.md` §4.23 y §4.24 (ADR-040). */

export type PlaceCategory = { id: string; slug: string; name: string };

/** Resumen (lista, `nearby`, búsqueda). `distance_meters` solo con un punto de origen. */
export type PlaceSummary = {
  id: string;
  name: string;
  slug: string;
  category: PlaceCategory;
  latitude: number;
  longitude: number;
  verification_status: string;
  address: string | null;
  /** Siempre `null` hasta que haya fotos de lugares (fase 4). */
  cover_image_url: string | null;
  is_saved: boolean;
  distance_meters?: number;
};

export type PlaceDetail = PlaceSummary & {
  description: string | null;
  municipality: string | null;
  department: string | null;
  phone: string | null;
  website: string | null;
  source: string;
  coordinate_source: string;
  last_verified_at: string | null;
};

export type LatLng = { lat: number; lng: number };

/** Estados de la vista; se resuelven en `viewState.ts`. */
export type ViewState = 'loading' | 'offline' | 'error' | 'empty' | 'success';

/** Estado del permiso de ubicación. Rechazarlo no desactiva nada. */
export type LocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'timeout';
