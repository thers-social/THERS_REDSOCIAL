import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@shared/lib/api';

import { fetchPlace } from './api';
import type { PlaceDetail } from './types';

export type DetailStatus = 'loading' | 'ready' | 'not_found' | 'error';

/**
 * Ficha de un lugar. Un lugar inexistente, inactivo o no público da 404 idéntico: se muestra
 * "no encontrado" (el servidor no revela cuál de los tres casos es).
 */
export function usePlaceDetail(placeId: string | undefined) {
  const [state, setState] = useState<{
    status: DetailStatus;
    place: PlaceDetail | null;
    error: string | null;
  }>({ status: 'loading', place: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!placeId) return undefined;
    const controller = new AbortController();
    setState({ status: 'loading', place: null, error: null });

    fetchPlace(placeId, controller.signal)
      .then((place) => setState({ status: 'ready', place, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: 'not_found', place: null, error: null });
        } else {
          setState({
            status: 'error',
            place: null,
            error: error instanceof Error ? error.message : 'No pudimos cargar este lugar.',
          });
        }
      });

    return () => controller.abort();
  }, [placeId, attempt]);

  const setSaved = useCallback(
    (saved: boolean) =>
      setState((current) =>
        current.place ? { ...current, place: { ...current.place, is_saved: saved } } : current,
      ),
    [],
  );

  return { ...state, setSaved, reload: () => setAttempt((n) => n + 1) };
}
