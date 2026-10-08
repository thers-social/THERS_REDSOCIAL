import axios from "axios";
import { useEffect, useState } from "react";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { fetchPlace } from "../lib/placesApi";

/**
 * Ficha de un lugar. `status`: idle (sin id) | loading | ready | not_found | error.
 * Un lugar inexistente, inactivo o no público da 404 idéntico: se muestra "no encontrado".
 */
export function usePlaceDetail(placeId) {
  const { t } = useLanguage();
  const [state, setState] = useState({
    status: placeId ? "loading" : "idle",
    place: null,
    error: null,
  });

  useEffect(() => {
    if (!placeId) {
      setState({ status: "idle", place: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", place: null, error: null });

    fetchPlace(placeId, controller.signal)
      .then((place) => setState({ status: "ready", place, error: null }))
      .catch((error) => {
        if (axios.isCancel(error)) return;
        if (error.response?.status === 404) {
          setState({ status: "not_found", place: null, error: null });
        } else {
          setState({ status: "error", place: null, error: getErrorMessage(error, t) });
        }
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId]);

  // Estado DERIVADO: en el render en que cambia `placeId` el efecto todavía no corrió, y `state`
  // aún describe el lugar anterior (o ninguno). Sin esto la ficha se pintaba con `place = null`
  // y fallaba (hallazgo de la prueba en navegador real). Nunca se expone un lugar de otro id.
  const stale = Boolean(placeId) && (state.status === "idle" || (state.place && state.place.id !== placeId));
  const view = stale ? { status: "loading", place: null, error: null } : state;

  return {
    ...view,
    setPlace: (updater) =>
      setState((current) => (current.place ? { ...current, place: updater(current.place) } : current)),
  };
}
