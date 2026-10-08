import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { fetchNearby, searchPlaces } from "../lib/placesApi";
import { deriveViewState } from "../lib/placesState";
import { useOnline } from "./useOnline";

const LIMIT = 50; // máximo del backend
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Lugares cercanos a `origin`, o los que coinciden con `query` (≥ 2 letras).
 * Cancela la petición anterior al cambiar los parámetros (mover el mapa dispara varias).
 *
 * Devuelve `viewState` ya resuelto (loading | offline | error | empty | success).
 */
export function usePlaces({ origin, radius, category, query }) {
  const { t } = useLanguage();
  const online = useOnline();
  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const [state, setState] = useState({ places: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));

    const isSearch = debouncedQuery.length >= MIN_QUERY_LENGTH;
    const request = isSearch
      ? searchPlaces({ q: debouncedQuery, ...origin, category, limit: LIMIT }, controller.signal)
      : fetchNearby({ ...origin, radius, category, limit: LIMIT }, controller.signal);

    request
      .then((places) => setState({ places, loading: false, error: null }))
      .catch((error) => {
        if (axios.isCancel(error)) return; // lo reemplazó otra consulta más reciente
        setState({ places: [], loading: false, error: getErrorMessage(error, t) });
      });

    return () => controller.abort();
    // `t` cambia de identidad al cambiar de idioma; no debe relanzar la consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.lat, origin.lng, radius, category, debouncedQuery, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    places: state.places,
    loading: state.loading,
    error: state.error,
    isSearch: debouncedQuery.length >= MIN_QUERY_LENGTH,
    reload,
    setPlaces: (updater) => setState((current) => ({ ...current, places: updater(current.places) })),
    viewState: deriveViewState({
      loading: state.loading,
      error: state.error,
      offline: !online,
      count: state.places.length,
    }),
  };
}
