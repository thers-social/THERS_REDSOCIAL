import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@shared/lib/api';

import { fetchNearby, searchPlaces } from './api';
import type { LatLng, PlaceSummary, ViewState } from './types';
import { deriveViewState } from './viewState';

const LIMIT = 50; // máximo del backend
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

type State = { places: PlaceSummary[]; loading: boolean; error: string | null; offline: boolean };

/**
 * Lugares cercanos a `origin`, o los que coinciden con `query` (≥ 2 letras). Cancela la
 * petición anterior al cambiar los parámetros (mover el mapa dispara varias).
 *
 * Sin red (`ApiError.isNetworkError`) se distingue de un error del servidor: son estados
 * distintos para la persona (revisar la conexión frente a reintentar más tarde).
 */
export function usePlaces(params: {
  origin: LatLng;
  radius: number;
  category: string;
  query: string;
}) {
  const { origin, radius, category, query } = params;
  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const isSearch = debouncedQuery.length >= MIN_QUERY_LENGTH;

  const [state, setState] = useState<State>({
    places: [],
    loading: true,
    error: null,
    offline: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null, offline: false }));

    const run = isSearch
      ? searchPlaces(
          { q: debouncedQuery, origin, category: category || undefined, limit: LIMIT },
          controller.signal,
        )
      : fetchNearby(
          { origin, radius, category: category || undefined, limit: LIMIT },
          controller.signal,
        );

    run
      .then((places) => setState({ places, loading: false, error: null, offline: false }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return; // lo reemplazó otra consulta más reciente
        setState({
          places: [],
          loading: false,
          error: error instanceof Error ? error.message : 'No pudimos cargar los lugares.',
          offline: error instanceof ApiError && error.isNetworkError,
        });
      });

    return () => controller.abort();
    // `origin` se compara por valor (lat/lng), no por identidad de objeto.
  }, [origin.lat, origin.lng, radius, category, debouncedQuery, isSearch, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const setPlaces = useCallback(
    (update: (places: PlaceSummary[]) => PlaceSummary[]) =>
      setState((current) => ({ ...current, places: update(current.places) })),
    [],
  );

  const viewState: ViewState = deriveViewState({
    loading: state.loading,
    error: state.error,
    offline: state.offline,
    count: state.places.length,
  });

  return { places: state.places, error: state.error, isSearch, viewState, reload, setPlaces };
}
