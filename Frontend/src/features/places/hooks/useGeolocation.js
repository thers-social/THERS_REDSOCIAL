import { useCallback, useState } from "react";
import { roundPoint } from "../lib/coordinates";

/**
 * Ubicación actual de la persona, SOLO cuando ella la pide (ADR-040 §6).
 *
 * - Nunca se pide al abrir la página: `request()` se llama desde un botón.
 * - Una sola lectura (`getCurrentPosition`), sin `watchPosition`: no se rastrea.
 * - El punto se redondea a 3 decimales (~110 m) y vive solo en memoria: no se guarda en
 *   localStorage, ni en el estado global, ni se envía a ningún sitio que no sea la consulta.
 *
 * Estados: idle | requesting | granted | denied | unavailable | timeout.
 * Rechazar el permiso no desactiva nada: la página sigue funcionando por búsqueda y mapa.
 */
const GEO_OPTIONS = { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 };

const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

export function useGeolocation() {
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;
  const [status, setStatus] = useState(supported ? "idle" : "unavailable");
  const [point, setPoint] = useState(null);

  const request = useCallback(() => {
    if (!supported) {
      setStatus("unavailable");
      return;
    }
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint(roundPoint({ lat: position.coords.latitude, lng: position.coords.longitude }));
        setStatus("granted");
      },
      (error) => {
        setStatus(
          error.code === PERMISSION_DENIED ? "denied" : error.code === TIMEOUT ? "timeout" : "unavailable"
        );
      },
      GEO_OPTIONS
    );
  }, [supported]);

  return { status, point, request };
}
