import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Icon from "@shared/components/Icon";
import { useLanguage } from "@shared/i18n";
import CategoryChips from "../components/CategoryChips";
import PlaceCard from "../components/PlaceCard";
import PlaceDetailPanel from "../components/PlaceDetailPanel";
import PlacesMap from "../components/PlacesMap";
import PlacesStateView from "../components/PlacesStateView";
import { useGeolocation } from "../hooks/useGeolocation";
import { usePlaceDetail } from "../hooks/usePlaceDetail";
import { usePlaces } from "../hooks/usePlaces";
import { fetchCategories } from "../lib/placesApi";
import { DEFAULT_CENTER, IS_DEV_MAP_STYLE } from "../lib/mapConfig";
import { locationNotice } from "../lib/placesState";

/**
 * THERS Places (ADR-040, fase 3): mapa + lista + ficha.
 *
 * Escritorio: panel a la izquierda y mapa a la derecha. Móvil: el mapa arriba y el panel abajo.
 * `/places/:placeId` es la ficha de un lugar (se puede compartir y recargar).
 *
 * La ubicación de la persona es OPCIONAL y solo se pide con el botón "Usar mi ubicación"
 * (ADR-040 §6). Sin ella, todo funciona buscando, moviendo el mapa o filtrando.
 */
const DEFAULT_RADIUS = 5000;

export default function Places() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { placeId } = useParams();

  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState(DEFAULT_CENTER);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [pendingViewport, setPendingViewport] = useState(null);
  const [focus, setFocus] = useState(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  const geo = useGeolocation();
  const results = usePlaces({ origin, radius, category, query });
  const detail = usePlaceDetail(placeId);

  // Categorías: el filtro es opcional, si fallan la página sigue funcionando.
  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Cuando la persona comparte su ubicación, la consulta y el mapa se centran en ella.
  useEffect(() => {
    if (!geo.point) return;
    setOrigin(geo.point);
    setRadius(DEFAULT_RADIUS);
    setPendingViewport(null);
    setFocus({ ...geo.point, key: `geo-${geo.point.lat}-${geo.point.lng}` });
  }, [geo.point]);

  // Abrir una ficha por URL: centrar el mapa en ese lugar.
  useEffect(() => {
    if (detail.place) {
      setFocus({ lat: detail.place.latitude, lng: detail.place.longitude, zoom: 15, key: `place-${detail.place.id}` });
    }
  }, [detail.place?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pines: la lista, más el lugar abierto si no está en ella (llegó por URL).
  const mapPlaces = useMemo(() => {
    if (!detail.place || results.places.some((p) => p.id === detail.place.id)) return results.places;
    return [...results.places, detail.place];
  }, [results.places, detail.place]);

  function applySavedChange(id, saved) {
    results.setPlaces((list) => list.map((p) => (p.id === id ? { ...p, is_saved: saved } : p)));
    detail.setPlace((p) => (p.id === id ? { ...p, is_saved: saved } : p));
  }

  function searchHere() {
    if (!pendingViewport) return;
    setOrigin(pendingViewport.center);
    setRadius(pendingViewport.radius);
    setPendingViewport(null);
  }

  const notice = locationNotice(geo.status);
  const showDetail = Boolean(placeId);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4 lg:h-[calc(100dvh-4rem)] lg:flex-row">
      <section
        aria-label={t("places.panel.aria")}
        className="order-2 flex min-h-0 flex-col gap-3 lg:order-1 lg:w-[400px] lg:shrink-0"
      >
        <header>
          <h1 className="text-xl font-semibold text-ink dark:text-ink-dark">{t("places.title")}</h1>
          <p className="text-xs text-muted dark:text-muted-dark">{t("places.subtitle")}</p>
        </header>

        {!showDetail && (
          <>
            <div className="flex gap-2">
              <label className="relative flex-1">
                <span className="sr-only">{t("places.search.aria")}</span>
                <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted dark:text-muted-dark" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("places.search.placeholder")}
                  maxLength={80}
                  className="w-full rounded-full border border-line bg-surface py-2 pl-10 pr-3 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
                />
              </label>
              <button
                type="button"
                onClick={geo.request}
                disabled={geo.status === "requesting"}
                aria-label={t("places.location.use")}
                title={t("places.location.use")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-ink hover:border-brand disabled:opacity-60 dark:border-line-dark dark:text-ink-dark"
              >
                <Icon name={geo.status === "granted" ? "my_location" : "location_searching"} size={20} />
              </button>
            </div>

            <CategoryChips categories={categories} value={category} onChange={setCategory} />

            {notice && (
              <p role="status" className="rounded-xl bg-warning-surface px-3 py-2 text-xs text-warning-fg">
                {t(`places.location.${notice}`)}
              </p>
            )}
          </>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {showDetail ? (
            <PlaceDetailPanel
              status={detail.status}
              place={detail.place}
              error={detail.error}
              onBack={() => navigate("/places")}
              onRetry={() => navigate(0)}
              onSavedChange={(saved) => applySavedChange(placeId, saved)}
            />
          ) : results.viewState === "success" ? (
            <>
              <p className="sr-only" aria-live="polite">
                {t("places.results.count", { count: results.places.length })}
              </p>
              <ul className="space-y-3">
                {results.places.map((place) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    selected={place.id === placeId}
                    onSelect={(id) => navigate(`/places/${id}`)}
                  />
                ))}
              </ul>
            </>
          ) : (
            <PlacesStateView
              state={results.viewState}
              message={results.error}
              isSearch={results.isSearch}
              onRetry={results.reload}
            />
          )}
        </div>
      </section>

      <div className="relative order-1 h-[55vh] min-h-[320px] flex-1 overflow-hidden rounded-[24px] border border-line dark:border-line-dark lg:order-2 lg:h-auto">
        {mapUnavailable ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Icon name="map" size={36} className="text-muted dark:text-muted-dark" />
            <p className="text-sm font-semibold text-ink dark:text-ink-dark">{t("places.map.unavailableTitle")}</p>
            <p className="max-w-xs text-xs text-muted dark:text-muted-dark">{t("places.map.unavailableBody")}</p>
          </div>
        ) : (
          <PlacesMap
            places={mapPlaces}
            selectedId={placeId}
            center={DEFAULT_CENTER}
            focus={focus}
            userPoint={geo.point}
            onSelect={(id) => navigate(`/places/${id}`)}
            onViewportChange={setPendingViewport}
            onUnavailable={() => setMapUnavailable(true)}
          />
        )}

        {pendingViewport && !results.isSearch && !mapUnavailable && (
          <button
            type="button"
            onClick={searchHere}
            className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-surface px-4 py-2 text-xs font-semibold text-ink shadow-soft hover:bg-brand-soft dark:bg-surface-dark dark:text-ink-dark"
          >
            {t("places.map.searchHere")}
          </button>
        )}

        {IS_DEV_MAP_STYLE && !mapUnavailable && (
          <p className="pointer-events-none absolute bottom-8 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
            {t("places.map.devStyle")}
          </p>
        )}
      </div>
    </div>
  );
}
