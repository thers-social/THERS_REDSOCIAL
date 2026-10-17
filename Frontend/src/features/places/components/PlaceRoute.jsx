import { useEffect, useRef, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { useAuth } from "@features/auth/context/AuthContext";
import { useGeolocation } from "../hooks/useGeolocation";
import { formatDistance } from "../lib/coordinates";
import { fetchRoute } from "../lib/placesApi";
import { trackPlaceVisit } from "../lib/placeVisits";
import { locationNotice } from "../lib/placesState";
import { ROUTE_PROFILES, focusableSteps, formatDuration } from "../lib/routeFormat";

/**
 * «Cómo llegar» (ADR-040 fase 13). La ubicación se pide SOLO al pulsar el botón y se envía,
 * redondeada, a nuestro servidor, que pide la ruta a OpenRouteService; no se guarda. La línea
 * se dibuja en el mapa de la página (`onRouteChange`). Se oculta si el servidor no tiene
 * proveedor de rutas o si no hay sesión.
 */
export default function PlaceRoute({ place, onRouteChange, onStepFocus }) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const geo = useGeolocation();
  const [profile, setProfile] = useState("walk");
  const [route, setRoute] = useState(null);
  const [state, setState] = useState({ status: "idle", error: null });
  const latest = useRef({ profile, onRouteChange });
  latest.current = { profile, onRouteChange };

  async function load(point, nextProfile) {
    setState({ status: "loading", error: null });
    try {
      const result = await fetchRoute(place.id, point, nextProfile, language === "en" ? "en" : "es");
      setRoute(result);
      setState({ status: "ready", error: null });
      latest.current.onRouteChange?.({ route: result, origin: point });
    } catch (error) {
      setRoute(null);
      latest.current.onRouteChange?.(null);
      setState({ status: "error", error: getErrorMessage(error, t) });
    }
  }

  // Cuando llega el punto de la persona se pide la ruta con el perfil elegido en ese momento.
  useEffect(() => {
    if (geo.point) load(geo.point, latest.current.profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.point]);

  // Al salir de la ficha o cambiar de lugar, la línea desaparece del mapa.
  useEffect(() => () => latest.current.onRouteChange?.(null), [place.id]);

  if (!user || !place.routing_available) return null;

  const notice = locationNotice(geo.status);
  const loading = state.status === "loading" || geo.status === "requesting";

  return (
    <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-route-title">
      <h3 id="place-route-title" className="text-base font-semibold text-ink dark:text-ink-dark">
        {t("places.route.title")}
      </h3>

      {!route && <p className="mt-2 text-xs text-muted dark:text-muted-dark">{t("places.route.privacy")}</p>}

      <div className="mt-3 flex gap-2" role="group" aria-label={t("places.route.profile")}>
        {ROUTE_PROFILES.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === profile}
            onClick={() => {
              setProfile(p);
              if (geo.point) load(geo.point, p);
            }}
            className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              p === profile
                ? "border-transparent bg-th-brand text-th-on-brand"
                : "border-line text-ink dark:border-line-dark dark:text-ink-dark"
            }`}
          >
            {t(`places.route.profiles.${p}`)}
          </button>
        ))}
      </div>

      {notice && (
        <p role="status" className="mt-2 text-xs text-muted dark:text-muted-dark">
          {t(`places.location.${notice}`)}
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-th-danger-fg">
          {state.error}
        </p>
      )}

      {!route ? (
        <button
          type="button"
          onClick={() => {
            trackPlaceVisit(place.id, "directions");
            geo.request();
          }}
          disabled={loading}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50 dark:border-line-dark dark:text-ink-dark"
        >
          {loading && <Spinner />}
          {t("places.route.start")}
        </button>
      ) : (
        <div className="mt-3" role="status">
          <p className="text-lg font-semibold text-ink dark:text-ink-dark">
            {formatDuration(route.duration_s, t)}{" "}
            <span className="text-sm font-normal text-muted dark:text-muted-dark">{formatDistance(route.distance_m)}</span>
          </p>
          <p className="mt-1 text-xs text-muted dark:text-muted-dark">{t("places.route.attribution")}</p>

          <h4 className="mt-4 text-sm font-semibold text-ink dark:text-ink-dark">{t("places.route.steps")}</h4>
          {focusableSteps(route.steps).length === 0 ? (
            <p className="mt-1 text-xs text-muted dark:text-muted-dark">{t("places.route.noSteps")}</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted dark:text-muted-dark">{t("places.route.stepsHint")}</p>
              <ol className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line dark:divide-line-dark dark:border-line-dark">
                {focusableSteps(route.steps).map((step, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => onStepFocus?.(step.at)}
                      className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-line/40 dark:hover:bg-line-dark/40"
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-th-brand text-xs font-semibold text-th-on-brand">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink dark:text-ink-dark">{step.instruction}</span>
                        <span className="block text-xs text-muted dark:text-muted-dark">
                          {step.street ?? t("places.route.noStreet")} · {formatDistance(step.distance_m)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
