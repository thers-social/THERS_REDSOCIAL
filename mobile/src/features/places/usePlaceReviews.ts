import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@shared/lib/api';

import { deleteReview, fetchReviews, writeReview } from './api';
import type { PlaceReview, ReviewSummary } from './types';

export type ReviewsStatus = 'loading' | 'ready' | 'error';

/**
 * Reseñas de un lugar (ADR-040 fase 4a). Escribir y borrar recargan la lista: el promedio
 * lo calcula el servidor, la app nunca lo recalcula (así no se desincroniza).
 */
export function usePlaceReviews(placeId: string | undefined) {
  const [state, setState] = useState<{
    status: ReviewsStatus;
    reviews: PlaceReview[];
    summary: ReviewSummary;
    error: string | null;
  }>({ status: 'loading', reviews: [], summary: { average: null, count: 0 }, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!placeId) return undefined;
    const controller = new AbortController();
    setState((current) => ({ ...current, status: 'loading', error: null }));

    fetchReviews(placeId, controller.signal)
      .then((data) =>
        setState({ status: 'ready', reviews: data.reviews, summary: data.summary, error: null }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          status: 'error',
          error: error instanceof ApiError ? error.message : 'No pudimos cargar las reseñas.',
        }));
      });

    return () => controller.abort();
  }, [placeId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const save = useCallback(
    async (values: { rating: number; body: string | null }) => {
      if (!placeId) return;
      await writeReview(placeId, values);
      reload();
    },
    [placeId, reload],
  );

  const remove = useCallback(async () => {
    if (!placeId) return;
    await deleteReview(placeId);
    reload();
  }, [placeId, reload]);

  return {
    ...state,
    mine: state.reviews.find((review) => review.is_mine) ?? null,
    reload,
    save,
    remove,
  };
}
