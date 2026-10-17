import { useCallback, useEffect, useState } from "react";
import Icon from "@shared/components/Icon";
import Avatar from "@shared/components/Avatar";
import Spinner from "@shared/components/Spinner";
import StoryComposer from "./StoryComposer";
import StoryViewer from "./StoryViewer";
import { formatRelativeTime } from "../lib/formatRelativeTime";
import { fetchStrip } from "../lib/storiesApi";

/**
 * Momentos — sección 1 de REF-FEED-01, ahora con historias REALES (ADR-042).
 *
 * Composición de la referencia: cabecera «Momentos Activos» y un carrusel horizontal con snap.
 * La primera tarjeta es la de creación propia (borde discontinuo, avatar con insignia «+»);
 * después, las personas que tienen historias vigentes que puedes ver (`GET /api/stories`).
 *
 * Medidas literales del prototipo: tarjetas de 128×184px, radio 16px.
 *
 * Una historia dura 24 horas y la ven quienes siguen a la persona (ADR-042 §2). Sin historias
 * vigentes la fila muestra solo la tarjeta de creación y lo dice; no se inventa actividad.
 */
export default function MomentsRow({ currentUser }) {
  const [status, setStatus] = useState("loading");
  const [authors, setAuthors] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async (signal) => {
    try {
      const list = await fetchStrip(signal);
      setAuthors(list);
      setStatus("ready");
    } catch {
      if (!signal?.aborted) setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <section aria-label="Momentos" className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-2 text-label-lg font-bold text-th-fg-strong">
          <Icon name="auto_awesome_motion" size={18} className="text-th-brand" />
          Momentos Activos
        </h2>
        <span className="text-label-md text-th-fg-subtle">Duran 24 horas</span>
      </header>

      <div className="th-scrollbar-none flex snap-x snap-mandatory items-center gap-4 overflow-x-auto pb-1">
        {/* Tarjeta de creación propia */}
        <button
          type="button"
          onClick={() => setComposing(true)}
          aria-label="Crear una historia"
          className="group relative flex h-[184px] w-[128px] shrink-0 snap-start cursor-pointer flex-col justify-between overflow-hidden rounded-th-card border-2 border-dashed border-th-border bg-th-surface p-2 text-left shadow-th-card transition-all th-focus-ring hover:border-th-border-strong hover:shadow-th-hover"
        >
          <div className="relative w-fit">
            <Avatar name={currentUser?.name} photo={currentUser?.avatar_url} size="w-10 h-10 text-sm" />
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-th-pill bg-th-brand shadow-th-card">
              <Icon name="add" size={14} className="text-th-on-brand" />
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-label-md font-bold text-th-fg-strong">Tu momento</span>
            <span className="text-label-md text-th-fg-muted">Compartir ahora</span>
          </div>
        </button>

        {status === "loading" && (
          <div className="flex h-[184px] items-center px-4 text-th-fg-muted" role="status">
            <Spinner size={20} />
            <span className="sr-only">Cargando historias…</span>
          </div>
        )}

        {status === "error" && (
          <p className="max-w-[220px] px-2 text-body-sm text-th-fg-muted">
            No se pudieron cargar las historias.{" "}
            <button type="button" onClick={() => load()} className="font-semibold text-th-brand-fg underline">
              Reintentar
            </button>
          </p>
        )}

        {status === "ready" && authors.length === 0 && (
          <p className="max-w-[240px] px-2 text-body-sm text-th-fg-muted">
            Nadie a quien sigues tiene historias ahora. Las que publiques tú las verán quienes te siguen.
          </p>
        )}

        {authors.map((item, index) => (
          <button
            key={item.author.id}
            type="button"
            onClick={() => setViewerIndex(index)}
            aria-label={
              item.is_me
                ? "Ver tus historias"
                : `Ver las historias de ${item.author.name}${item.has_unseen ? " (sin ver)" : ""}`
            }
            className={`group relative h-[184px] w-[128px] shrink-0 snap-start overflow-hidden rounded-th-card bg-th-surface-raised shadow-th-card ring-2 transition-all th-focus-ring hover:ring-th-brand ${
              item.has_unseen ? "ring-th-brand" : "ring-transparent"
            }`}
          >
            {item.latest_image_url && (
              <img
                src={item.latest_image_url}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/75 via-slate-900/10 to-slate-900/10" />

            <span className="absolute left-2 top-2">
              <Avatar name={item.author.name} photo={item.author.avatar_url} size="w-9 h-9 text-xs" ring />
            </span>

            <span className="absolute inset-x-2 bottom-2 flex flex-col text-left">
              <span className="truncate text-label-lg font-bold text-white drop-shadow">
                {item.is_me ? "Tu historia" : item.author.name}
              </span>
              <span className="text-label-md text-white/75">{formatRelativeTime(item.latest_at)}</span>
            </span>
          </button>
        ))}
      </div>

      {viewerIndex !== null && (
        <StoryViewer
          authors={authors}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onChanged={() => load()}
        />
      )}

      {composing && <StoryComposer onClose={() => setComposing(false)} onPublished={() => load()} />}
    </section>
  );
}
