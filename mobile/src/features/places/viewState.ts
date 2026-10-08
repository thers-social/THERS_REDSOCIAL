/**
 * Estado de la vista de THERS Places (ADR-040, encargo §25). Módulo PURO, probado con
 * `node --test`.
 *
 * Toda pantalla de lugares se resuelve en exactamente UNO de estos estados, nunca en
 * una pantalla rota porque la API no respondió:
 *
 *   loading  consulta en curso y todavía no hay resultados que mostrar
 *   offline  no se pudo alcanzar el servidor (sin red); distinto de un error del servidor
 *   error    el servidor respondió con un error
 *   empty    la consulta salió bien pero no hay lugares
 *   success  hay lugares
 *
 * `location_denied` NO es un estado de la vista: la lista sigue funcionando sin GPS
 * (buscar, mover el mapa), así que se informa aparte con `locationNotice`.
 */

import type { LocationStatus, ViewState } from './types';

export function deriveViewState(input: {
  loading: boolean;
  error: string | null;
  offline: boolean;
  count: number;
}): ViewState {
  // Con resultados ya cargados se siguen mostrando mientras se refresca: un parpadeo a
  // "cargando" en cada movimiento del mapa sería peor que datos ligeramente viejos.
  if (input.count > 0) return 'success';
  if (input.offline) return 'offline';
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  return 'empty';
}

export type LocationNotice = 'location_denied' | 'location_unavailable' | 'location_timeout';

/** Aviso sobre la ubicación, o `null` si no hace falta ninguno. */
export function locationNotice(status: LocationStatus): LocationNotice | null {
  if (status === 'denied') return 'location_denied';
  if (status === 'unavailable') return 'location_unavailable';
  if (status === 'timeout') return 'location_timeout';
  return null;
}

export const LOCATION_NOTICE_TEXT: Record<LocationNotice, string> = {
  location_denied:
    'No tenemos permiso para usar tu ubicación. Podés seguir buscando por nombre o moviendo el mapa.',
  location_unavailable:
    'No pudimos obtener tu ubicación. Podés seguir buscando por nombre o moviendo el mapa.',
  location_timeout: 'Tu ubicación tardó demasiado en responder. Intentá de nuevo o mové el mapa.',
};
