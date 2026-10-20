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
 * - `point` se redondea a 3 decimales (~110 m) y es el ÚNICO que sale a la consulta
 *   (ADR-040 §4.4, D2). `exact` es la lectura sin redondear y se queda en el teléfono, solo
 *   para dibujar "estás aquí" y centrar el mapa. Ambos viven solo en memoria: no se guardan
 *   en disco ni en el estado global.
 * - Lectura por GPS (`High`), no la equilibrada que se apoyaba en antenas y wifi y podía
 *   quedar a cientos de metros o a kilómetros de la persona (2026-10-20).
 *
 * Rechazar el permiso no desactiva nada: la pantalla sigue funcionando por búsqueda y mapa.
 */
const TIMEOUT_MS = 20000;

export function useGeolocation() {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [point, setPoint] = useState<LatLng | null>(null);
  const [exact, setExact] = useState<LatLng | null>(null);

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
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
      ]);
      if (!position) {
        setStatus('timeout');
        return;
      }
      const reading = { lat: position.coords.latitude, lng: position.coords.longitude };
      setExact(reading);
      setPoint(roundPoint(reading));
      setStatus('granted');
    } catch {
      setStatus('unavailable');
    }
  }, []);

  return { status, point, exact, request };
}
