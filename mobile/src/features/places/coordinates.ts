/**
 * Utilidades de coordenadas de THERS Places (ADR-040 §4.4).
 *
 * Módulo PURO (sin React ni React Native) para probarlo con `node --test`.
 *
 * PRIVACIDAD: las coordenadas viajan en la URL de `GET /api/places/nearby` y pueden
 * quedar en los registros de acceso del proxy o de una herramienta de errores
 * (ADR-040 R5). Por eso el cliente las redondea a 3 decimales (~110 m) ANTES de
 * enviarlas: suficiente para "lo que tengo cerca", insuficiente para ubicar a alguien
 * en una casa concreta.
 */

import type { LatLng } from './types';

export const COORD_PRECISION = 3;

// Límites del backend (`domain/places/kinds.py`).
export const MIN_RADIUS_METERS = 500;
export const MAX_RADIUS_METERS = 50000;

const EARTH_RADIUS_METERS = 6371000;

export function roundCoordinate(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

export function roundPoint(point: LatLng): LatLng {
  return { lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) };
}

export function isValidPoint(point: LatLng | null | undefined): point is LatLng {
  return (
    !!point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/** Distancia en metros entre dos puntos (fórmula de haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Radio de búsqueda (metros) que cubre lo visible del mapa: distancia del centro a
 * una esquina, acotada a lo que acepta el backend.
 */
export function radiusFromBounds(center: LatLng, corner: LatLng): number {
  const meters = Math.ceil(haversineMeters(center, corner));
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, meters));
}

/** "820 m", "2,3 km", "12 km". Sin valor, cadena vacía. */
export function formatDistance(meters: number | undefined | null): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}
