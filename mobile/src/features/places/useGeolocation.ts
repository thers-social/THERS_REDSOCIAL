import * as Location from 'expo-location';
import { useCallback, useState } from 'react';

import { roundPoint } from './coordinates';
import type { LatLng, LocationStatus } from './types';

/**
 * Ubicación actual de la persona, SOLO cuando ella la pide (ADR-040 §6).
 *
 * - Nunca se pide al abrir la pantalla: `request()` se llama desde un botón.
 * - Una sola lectura (`getCurrentPositionAsync`), sin seguimiento ni servicio en segundo
 *   plano: no se rastrea.
 * - El punto se redondea a 3 decimales (~110 m) y vive solo en memoria: no se guarda en
 *   disco, ni en el estado global, ni se envía a ningún sitio que no sea la consulta.
 * - Precisión equilibrada (no GPS fino): para "qué hay cerca" sobra.
 *
 * Rechazar el permiso no desactiva nada: la pantalla sigue funcionando por búsqueda y mapa.
 */
const TIMEOUT_MS = 10000;

export function useGeolocation() {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [point, setPoint] = useState<LatLng | null>(null);

  const request = useCallback(async () => {
    setStatus('requesting');
    try {
      if (!(await Location.hasServicesEnabledAsync())) {
        setStatus('unavailable');
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setStatus('denied');
        return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
      ]);
      if (!position) {
        setStatus('timeout');
        return;
      }
      setPoint(roundPoint({ lat: position.coords.latitude, lng: position.coords.longitude }));
      setStatus('granted');
    } catch {
      setStatus('unavailable');
    }
  }, []);

  return { status, point, request };
}
