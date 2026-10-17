import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { deleteReview, fetchReviews, writeReview } from "../lib/placesApi";

/**
 * Reseñas de un lugar (ADR-040 fase 4a). `status`: loading | ready | error.
 * Escribir y borrar recargan la lista: el promedio lo calcula el servidor, el cliente no
 * lo recalcula (así nunca se desincroniza).
 */
export function usePlaceReviews(placeId) {
  const { t } = useLanguage();
  const [state, setState] = useState({
    status: "loading",
    reviews: [],
    summary: { average: null, count: 0 },
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, status: "loading", error: null }));
    fetchReviews(placeId, controller.signal)
      .then((data) =>
        setState({ status: "ready", reviews: data.reviews, summary: data.summary, error: null })
      )
      .catch((error) => {
        if (axios.isCancel(error)) return;
        setState((current) => ({ ...current, status: "error", error: getErrorMessage(error, t) }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const save = useCallback(
    async ({ rating, body }) => {
      await writeReview(placeId, { rating, body });
      reload();
    },
    [placeId, reload]
  );

  const remove = useCallback(async () => {
    await deleteReview(placeId);
    reload();
  }, [placeId, reload]);

  return { ...state, mine: state.reviews.find((review) => review.is_mine) ?? null, reload, save, remove };
}
