import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import PlaceCard from "@features/places/components/PlaceCard";
import { fetchTopPlaces, searchPlaces } from "@features/places/lib/placesApi";
import { fetchFeed } from "@features/videos/lib/videosApi";

/**
 * Contenido sugerido de los ámbitos «Lugares» y «Videos» del buscador.
 *
 *  · Lugares: sin texto, los mejor valorados de THERS Places (`GET /api/places/top`); con texto, la
 *    búsqueda del catálogo (`GET /api/places/search`). Tocar uno abre su ficha en `/places/:id`.
 *  · Videos: cuando haya videos aparecerán aquí como sugerencias. Hoy el módulo puede estar apagado
 *    en el servidor (`GET /api/videos` responde 404) o sin videos aprobados; en ambos casos se
 *    muestra el aviso y, en cuanto existan, la lista se llena sola sin tocar este código.
 */

const PLACES_LIMIT = 8;
const VIDEOS_LIMIT = 6;

export function PlaceSuggestions({ query }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: "loading", places: [] });
  const needle = query.trim();

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", places: [] });
    const request = needle
      ? searchPlaces({ q: needle, limit: PLACES_LIMIT }, controller.signal)
      : fetchTopPlaces({ limit: PLACES_LIMIT }, controller.signal);
    request
      .then((places) => setState({ status: "ready", places }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error", places: [] });
      });
    return () => controller.abort();
  }, [needle]);

  return (
    <section className="flex flex-col gap-4" aria-label="Lugares">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-headline-sm text-th-fg-strong">
            {needle ? "Lugares" : "Lugares sugeridos"}
          </h2>
          <p className="text-body-sm text-th-fg-muted">
            {needle ? "Resultados de THERS Places." : "Los mejor valorados de THERS Places."}
          </p>
        </div>
        <Link
          to="/places"
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-th-pill border border-th-border px-3.5 text-label-lg font-semibold text-th-brand-fg th-focus-ring hover:bg-th-surface-raised"
        >
          <Icon name="location_on" size={18} />
          Abrir THERS Places
        </Link>
      </div>

      {state.status === "loading" ? (
        <div className="flex items-center justify-center gap-2 py-12 text-th-fg-muted" role="status">
          <Spinner size={20} />
          <span className="text-body-md">Cargando lugares…</span>
        </div>
      ) : state.status === "error" ? (
        <Notice icon="error" title="No se pudieron cargar los lugares" />
      ) : state.places.length === 0 ? (
        <Notice
          icon="location_off"
          title={needle ? `Sin lugares para «${needle}»` : "Todavía no hay lugares sugeridos"}
          description={needle ? "Prueba con otro nombre o categoría." : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {state.places.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              selected={false}
              onSelect={(id) => navigate(`/places/${id}`)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function VideoSuggestions() {
  const [state, setState] = useState({ status: "loading", videos: [] });

  useEffect(() => {
    const controller = new AbortController();
    fetchFeed({ limit: VIDEOS_LIMIT }, controller.signal)
      .then((data) => setState({ status: "ready", videos: data.videos ?? [] }))
      .catch(() => {
        // 404 con el módulo apagado, o cualquier fallo: se queda el aviso de «cuando haya videos».
        if (!controller.signal.aborted) setState({ status: "ready", videos: [] });
      });
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-th-fg-muted" role="status">
        <Spinner size={20} />
        <span className="text-body-md">Cargando videos…</span>
      </div>
    );
  }

  if (state.videos.length === 0) {
    return (
      <Notice
        icon="videocam"
        title="Cuando haya videos, aquí saldrán las sugerencias"
        description="Todavía no hay videos publicados. En cuanto los haya, los verás sugeridos en este apartado."
      />
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Videos">
      <div className="flex flex-col">
        <h2 className="text-headline-sm text-th-fg-strong">Videos sugeridos</h2>
        <p className="text-body-sm text-th-fg-muted">Cortos recientes de la comunidad.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {state.videos.map((video) => (
          <li key={video.id}>
            <Link
              to="/videos"
              className="flex items-center gap-3 rounded-th-card border border-th-border bg-th-surface p-4 th-focus-ring hover:border-th-brand-soft-strong"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-th-pill bg-th-brand-soft text-th-brand-fg">
                <Icon name="play_circle" size={22} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-body-md font-semibold text-th-fg-strong">
                  {video.caption || "Sin texto"}
                </span>
                {video.author?.username && (
                  <span className="block truncate text-label-md text-th-fg-muted">
                    @{video.author.username}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notice({ icon, title, description }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-th-card border border-dashed border-th-border bg-th-surface px-6 py-16 text-center">
      <Icon name={icon} size={28} className="text-th-fg-subtle" />
      <p className="text-label-lg font-bold text-th-fg-strong">{title}</p>
      {description && <p className="max-w-md text-body-md text-th-fg-muted">{description}</p>}
    </div>
  );
}
