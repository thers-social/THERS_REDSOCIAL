import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@shared/i18n";
import { radiusFromBounds } from "../lib/coordinates";
import { DEFAULT_ZOOM, MAP_STYLE_URL } from "../lib/mapConfig";

/**
 * Mapa de lugares (MapLibre GL JS). El proveedor de tiles sale de VITE_MAP_STYLE_URL.
 *
 * - Los pines son UNA capa GeoJSON (no un marcador DOM por lugar): aguanta cientos sin lag.
 * - `onViewportChange` solo se llama por gestos de la persona (arrastrar/zoom), no por los
 *   movimientos que hace este componente (`focus`, selección), para no entrar en bucle.
 * - Si el navegador no puede crear el mapa (sin WebGL), avisa con `onUnavailable` y la
 *   lista de la página sigue funcionando.
 *
 * Props:
 *   places        lugares a pintar ({id, latitude, longitude, name})
 *   selectedId    id resaltado
 *   center, zoom  vista inicial (solo se leen al montar)
 *   focus         { lat, lng, key } -> centra el mapa cuando cambia `key`
 *   userPoint     { lat, lng } punto (redondeado) de la persona, si lo compartió
 */
// MapLibre 6 busca su worker junto al script que lo carga; empaquetado con Vite ese archivo no
// existe y el mapa queda vacío. `vite-maplibre-worker.js` lo sirve en esta ruta fija.
maplibregl.setWorkerUrl(
  new URL(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`, window.location.origin).href
);

const SOURCE_ID = "thers-places";
const BRAND = "#7c3aed";

function toGeoJson(places) {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature",
      properties: { id: place.id, name: place.name },
      geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
    })),
  };
}

export default function PlacesMap({
  places,
  selectedId,
  center,
  zoom = DEFAULT_ZOOM,
  focus,
  userPoint,
  onSelect,
  onViewportChange,
  onUnavailable,
}) {
  const { t } = useLanguage();
  const container = useRef(null);
  const mapRef = useRef(null);
  const userMarker = useRef(null);
  const [ready, setReady] = useState(false);

  // Callbacks y datos vivos en refs: el mapa se crea UNA vez y no debe recrearse por ellos.
  const handlers = useRef({ onSelect, onViewportChange });
  handlers.current = { onSelect, onViewportChange };
  const latest = useRef({ places, selectedId });
  latest.current = { places, selectedId };

  useEffect(() => {
    let map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: [center.lng, center.lat],
        zoom,
        attributionControl: { compact: true },
      });
    } catch {
      onUnavailable?.();
      return undefined;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource(SOURCE_ID, { type: "geojson", data: toGeoJson(latest.current.places) });
      map.addLayer({
        id: "places-selected-halo",
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["get", "id"], latest.current.selectedId || ""],
        paint: { "circle-radius": 16, "circle-color": BRAND, "circle-opacity": 0.25 },
      });
      map.addLayer({
        id: "places-pins",
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 8,
          "circle-color": BRAND,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.on("click", "places-pins", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (id) handlers.current.onSelect?.(id);
      });
      map.on("mouseenter", "places-pins", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "places-pins", () => (map.getCanvas().style.cursor = ""));
      setReady(true);
    });

    map.on("moveend", (event) => {
      // `originalEvent` solo existe cuando lo movió la persona (no `easeTo` de este componente).
      if (!event.originalEvent) return;
      const c = map.getCenter();
      const ne = map.getBounds().getNorthEast();
      handlers.current.onViewportChange?.({
        center: { lat: c.lat, lng: c.lng },
        radius: radiusFromBounds({ lat: c.lat, lng: c.lng }, { lat: ne.lat, lng: ne.lng }),
      });
    });

    return () => {
      userMarker.current?.remove();
      userMarker.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // El mapa se crea una sola vez: centro/zoom iniciales no deben recrearlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pines
  useEffect(() => {
    if (!ready) return;
    mapRef.current.getSource(SOURCE_ID)?.setData(toGeoJson(places));
  }, [places, ready]);

  // Pin seleccionado: resalta y centra suavemente
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    map.setFilter("places-selected-halo", ["==", ["get", "id"], selectedId || ""]);
    const place = places.find((p) => p.id === selectedId);
    if (place) map.easeTo({ center: [place.longitude, place.latitude], duration: 400 });
    // Solo al cambiar la selección, no cada vez que cambia la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  // Centrar por orden de la página (p. ej. "usar mi ubicación")
  useEffect(() => {
    if (!ready || !focus) return;
    mapRef.current.easeTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 13, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, ready]);

  // Punto de la persona
  useEffect(() => {
    if (!ready) return;
    userMarker.current?.remove();
    userMarker.current = null;
    if (!userPoint) return;
    const dot = document.createElement("div");
    dot.setAttribute("aria-hidden", "true");
    dot.style.cssText =
      "width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid #fff;" +
      "box-shadow:0 0 0 6px rgba(37,99,235,.25)";
    userMarker.current = new maplibregl.Marker({ element: dot })
      .setLngLat([userPoint.lng, userPoint.lat])
      .addTo(mapRef.current);
  }, [userPoint, ready]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={t("places.map.aria")}
      className="h-full w-full min-h-[280px] bg-line dark:bg-line-dark"
    />
  );
}
