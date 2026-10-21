import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import CapsuleCard from "../components/CapsuleCard";
import PeopleResults from "../components/PeopleResults";
import SearchRail from "../components/SearchRail";
import { PlaceSuggestions, VideoSuggestions } from "../components/SearchSuggestions";

/**
 * Buscar — REF-SEARCH-01.
 *
 * Orden de secciones de la referencia:
 *   1. Tarjeta de búsqueda + selectores de ámbito
 *   2. Barra de filtración avanzada + chips de filtros clave
 *   3. Rejilla de 12 columnas: 8 de resultados (destacado + stream) + 4 de rail
 *
 * QUÉ BUSCA DE VERDAD — y por qué así:
 *
 * NO existe endpoint de búsqueda: el backend solo expone `GET /api/posts`,
 * que devuelve la lista completa (ADR-004). En vez de fingir un buscador de
 * servidor, se filtra en cliente sobre las publicaciones REALES ya cargadas,
 * y la interfaz lo dice en pantalla. El archivo maestro §9.4 prohíbe dejar un
 * mock por rapidez, pero también §8.2 exige distinguir «sin resultados»,
 * «todavía no buscaste», «cargando» y «error»: eso sí se cumple con datos
 * reales.
 *
 * Los ámbitos «Sonidos» y «Creadores» se retiraron (pedido del propietario).
 * «Lugares» muestra los mejor valorados de THERS Places, o su búsqueda si hay
 * texto; «Videos» avisa que las sugerencias saldrán cuando haya videos y las
 * muestra en cuanto existan (SearchSuggestions.jsx).
 *
 * `?q=` y `?scope=` viven en la URL, así que una búsqueda se puede compartir
 * y recargar (§8.2).
 */

const SCOPES = [
  { id: "all", label: "Todos los resultados", icon: null },
  { id: "people", label: "Personas", icon: "group" },
  { id: "videos", label: "Videos", icon: "videocam" },
  { id: "capsules", label: "Cápsulas", icon: "history_toggle_off" },
  { id: "places", label: "Lugares", icon: "near_me" },
];

/** Ámbitos que hoy tienen contenido real detrás. */
const SUPPORTED_SCOPES = new Set(["all", "capsules"]);

const SORTS = [
  { id: "recent", label: "Más recientes" },
  { id: "resonance", label: "Mayor resonancia" },
];

/** Filtros clave de la referencia. Ninguno es aplicable a un post de solo texto. */
const KEY_FILTERS = [
  { id: "verified", label: "Verificados únicamente", icon: "verified" },
  { id: "capsule", label: "Con cápsula vinculada", icon: "link" },
  { id: "music", label: "Música / Sound Design", icon: "headphones" },
  { id: "maps", label: "Cartografía urbana", icon: "map" },
  { id: "tech", label: "Tutoriales & Tech", icon: "terminal" },
  { id: "wide", label: "Panorámico 16:9", icon: "aspect_ratio" },
];

export default function Search() {
  const {
    currentUser,
    capsules,
    capsulesLoading,
    onToggleLike,
    onLoadComments,
    onPostComment,
    onDeleteComment,
    onEditComment,
    onToggleFollowAuthor,
    onDeleteCapsule,
    onEditCapsule,
  } = useOutletContext();

  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get("q") ?? "";
  const scopeParam = SCOPES.some((s) => s.id === searchParams.get("scope"))
    ? searchParams.get("scope")
    : "all";
  const sortParam = SORTS.some((s) => s.id === searchParams.get("sort"))
    ? searchParams.get("sort")
    : "recent";

  // El input es controlado por su propio estado y se sincroniza con la URL con
  // un pequeño retardo: escribir no debe crear una entrada de historial por
  // cada tecla. `replace: true` por el mismo motivo.
  const [draft, setDraft] = useState(queryParam);
  const inputRef = useRef(null);

  useEffect(() => {
    setDraft(queryParam);
  }, [queryParam]);

  useEffect(() => {
    if (draft === queryParam) return undefined;
    const id = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (draft.trim()) next.set("q", draft.trim());
      else next.delete("q");
      setSearchParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [draft, queryParam, searchParams, setSearchParams]);

  function setParam(key, value, fallback) {
    const next = new URLSearchParams(searchParams);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  // Búsqueda real sobre las publicaciones cargadas: contenido, nombre y
  // usuario del autor. Sin acentos ni mayúsculas para que «cápsula» encuentre
  // «Capsula».
  const results = useMemo(() => {
    const needle = normalize(queryParam);
    const scoped = SUPPORTED_SCOPES.has(scopeParam) ? capsules : [];
    const filtered = needle
      ? scoped.filter(
          (c) =>
            normalize(c.content).includes(needle) ||
            normalize(c.author?.name).includes(needle) ||
            normalize(c.author?.username).includes(needle)
        )
      : scoped;

    return [...filtered].sort((a, b) =>
      sortParam === "resonance"
        ? (b.likes_count ?? 0) - (a.likes_count ?? 0)
        : new Date(b.created_at) - new Date(a.created_at)
    );
  }, [capsules, queryParam, scopeParam, sortParam]);

  const spotlight = sortParam === "resonance" && results.length > 0 && (results[0].likes_count ?? 0) > 0
    ? results[0]
    : null;
  const stream = spotlight ? results.slice(1) : results;

  const scopeSupported = SUPPORTED_SCOPES.has(scopeParam);

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-6 py-4">
      {/* 1. Tarjeta de búsqueda + ámbitos */}
      <header className="flex flex-col gap-4 rounded-th-card border border-th-border bg-th-surface p-6 shadow-th-card">
        <div className="flex flex-col items-stretch justify-between gap-4 lg:flex-row lg:items-center">
          <div className="relative flex flex-1 items-center">
            <label htmlFor="th-search-input" className="sr-only">
              Buscar en THERS
            </label>
            <Icon
              name="search"
              size={20}
              className="pointer-events-none absolute left-4 text-th-fg-subtle"
            />
            <input
              id="th-search-input"
              ref={inputRef}
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Buscar personas, publicaciones, lugares..."
              className="min-h-[48px] w-full rounded-th-input border border-th-border bg-th-surface-subtle py-2.5 pl-12 pr-11 text-body-md text-th-fg placeholder:text-th-fg-muted transition-colors th-focus-ring focus:bg-th-surface"
            />
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  inputRef.current?.focus();
                }}
                aria-label="Limpiar búsqueda"
                className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-th-pill text-th-fg-subtle th-focus-ring hover:bg-th-surface-raised hover:text-th-fg-strong"
              >
                <Icon name="close" size={18} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-end lg:self-auto">
            <Link
              to="/explore"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-th-pill border border-th-brand bg-th-brand px-4 text-label-lg font-bold text-th-on-brand th-focus-ring hover:bg-th-brand-hover"
            >
              <Icon name="grid_view" size={18} />
              Explorar contenido
            </Link>
            <PendingChip id="save-search" icon="bookmark" label="Guardar búsqueda" />
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Ámbito de búsqueda"
          className="th-scrollbar-none flex items-center gap-2 overflow-x-auto border-t border-th-border-subtle pt-3"
        >
          {SCOPES.map((scope) => {
            const active = scope.id === scopeParam;
            return (
              <button
                key={scope.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setParam("scope", scope.id, "all")}
                className={`flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-th-sm px-3.5 py-1.5 text-body-sm transition-colors th-focus-ring ${
                  active
                    ? "border border-th-brand-soft-strong bg-th-brand-soft font-bold text-th-brand-fg"
                    : "font-medium text-th-fg-muted hover:bg-th-surface-raised hover:text-th-fg-strong"
                }`}
              >
                {scope.icon && <Icon name={scope.icon} size={18} />}
                {scope.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* 2. Filtración avanzada */}
      <section
        aria-label="Filtros"
        className="flex flex-col gap-4 rounded-th-card border border-th-border bg-th-surface p-6 shadow-th-card"
      >
        <div className="flex flex-col items-start justify-between gap-4 xl:flex-row xl:items-center">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-label-md font-bold uppercase tracking-wider text-th-fg-subtle">
              Filtración avanzada
            </span>

            {/* Orden SÍ es real: ambos criterios se calculan sobre datos que
                ya viajan con cada publicación. */}
            <label className="flex items-center gap-2 text-body-sm text-th-fg-muted">
              <span className="sr-only">Orden de los resultados</span>
              <select
                value={sortParam}
                onChange={(event) => setParam("sort", event.target.value, "recent")}
                className="min-h-[40px] rounded-th-sm border border-th-border bg-th-surface px-3 py-1.5 text-body-sm font-semibold text-th-fg th-focus-ring"
              >
                {SORTS.map((sort) => (
                  <option key={sort.id} value={sort.id}>
                    Orden: {sort.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Duración, Fecha y Calidad describen contenido de vídeo, que no
                existe en el modelo de datos. Se conservan visibles y
                deshabilitados en vez de omitirse (§1) o fingir (§9.4). */}
            <PendingSelect label="Duración" />
            <PendingSelect label="Fecha" />
            <PendingSelect label="Calidad" />
          </div>

          <p className="flex items-center gap-2 text-body-sm text-th-fg-muted">
            <Icon name="sort" size={16} />
            <span aria-live="polite">
              {scopeParam === "places" || scopeParam === "videos"
                ? "Sugerencias"
                : scopeParam === "people"
                ? "Personas"
                : capsulesLoading
                ? "Cargando…"
                : `${results.length.toLocaleString("es")} ${
                    results.length === 1 ? "resultado" : "resultados"
                  }`}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-th-border-subtle pt-3">
          <span className="mr-1 text-label-md font-bold uppercase tracking-wider text-th-fg-subtle">
            Filtros clave
          </span>
          {KEY_FILTERS.map((filter) => (
            <PendingChip
              key={filter.id}
              id={`filter-${filter.id}`}
              icon={filter.icon}
              label={filter.label}
              small
            />
          ))}
        </div>
      </section>

      {/* 3. Rejilla de 12 columnas */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-8">
          {/* Personas: las busca el servidor por nombre o usuario, hayan publicado o no. En «Todos»
              van arriba y recortadas; en «Personas» son lo único que se muestra. */}
          {(scopeParam === "all" || scopeParam === "people") && (
            <PeopleResults
              query={queryParam}
              limit={scopeParam === "people" ? 30 : 5}
              showEmpty={scopeParam === "people"}
            />
          )}
          {scopeParam === "people" ? (
            !queryParam && (
              <EmptyState
                icon="group"
                title="Busca a alguien"
                description="Escribe un nombre o un @usuario para encontrar personas, aunque todavía no hayan publicado."
              />
            )
          ) : scopeParam === "places" ? (
            <PlaceSuggestions query={queryParam} />
          ) : scopeParam === "videos" ? (
            <VideoSuggestions />
          ) : !scopeSupported ? (
            <EmptyState
              icon={SCOPES.find((s) => s.id === scopeParam)?.icon || "search_off"}
              title={`«${SCOPES.find((s) => s.id === scopeParam)?.label}» todavía no es buscable`}
              description="THERS aún no tiene un modelo de datos para este tipo de contenido, así que no hay nada que indexar. El ámbito se conserva porque está en el diseño de referencia."
            />
          ) : capsulesLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-th-fg-muted" role="status">
              <Spinner size={20} />
              <span className="text-body-md">Cargando publicaciones…</span>
            </div>
          ) : results.length === 0 ? (
            queryParam ? (
              <EmptyState
                icon="search_off"
                title={`Sin resultados para «${queryParam}»`}
                description="No hay publicaciones que coincidan. Probá con otras palabras o revisá el ámbito seleccionado."
              />
            ) : (
              <EmptyState
                icon="search"
                title="Todavía no hay nada publicado"
                description="Cuando existan publicaciones aparecerán acá, y podrás filtrarlas desde el buscador."
              />
            )
          ) : (
            <>
              {spotlight && (
                <section className="flex flex-col gap-3 overflow-hidden rounded-th-card border border-th-brand-soft-strong bg-th-brand-soft p-6 shadow-th-card">
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-th-pill bg-th-surface px-3 py-1 text-label-sm font-bold uppercase tracking-wide text-th-brand-fg">
                    <Icon name="trending_up" size={14} />
                    Mayor resonancia
                  </span>
                  <CapsuleCard
                    capsule={spotlight}
                    currentUserId={currentUser.id}
                    onToggleLike={onToggleLike}
                    onLoadComments={onLoadComments}
                    onPostComment={onPostComment}
                    onDeleteComment={onDeleteComment}
                    onEditComment={onEditComment}
                    onToggleFollowAuthor={onToggleFollowAuthor}
                    onDeleteCapsule={onDeleteCapsule}
                    onEditCapsule={onEditCapsule}
                  />
                </section>
              )}

              {stream.length > 0 && (
                <div className="flex items-center justify-between pt-1">
                  <div className="flex flex-col">
                    <h2 className="text-headline-sm text-th-fg-strong">
                      {queryParam ? "Resultados" : "Contenido sugerido"}
                    </h2>
                    <p className="text-body-sm text-th-fg-muted">
                      Publicaciones reales cargadas desde el servidor.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-6">
                {stream.map((capsule) => (
                  <CapsuleCard
                    key={capsule.id}
                    capsule={capsule}
                    currentUserId={currentUser.id}
                    onToggleLike={onToggleLike}
                    onLoadComments={onLoadComments}
                    onPostComment={onPostComment}
                    onDeleteComment={onDeleteComment}
                    onEditComment={onEditComment}
                    onToggleFollowAuthor={onToggleFollowAuthor}
                    onDeleteCapsule={onDeleteCapsule}
                    onEditCapsule={onEditCapsule}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <SearchRail />
      </div>
    </div>
  );
}

/** Quita acentos y mayúsculas para comparar de forma tolerante. */
function normalize(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function EmptyState({ icon, title, description }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-th-card border border-dashed border-th-border bg-th-surface px-6 py-16 text-center">
      <Icon name={icon} size={28} className="text-th-fg-subtle" />
      <p className="text-label-lg font-bold text-th-fg-strong">{title}</p>
      <p className="max-w-md text-body-md text-th-fg-muted">{description}</p>
    </div>
  );
}

/** Control presente en la referencia que todavía no tiene datos detrás. */
function PendingChip({ id, icon, label, small = false }) {
  return (
    <button
      type="button"
      disabled
      aria-describedby={`${id}-hint`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-th-pill border border-th-border bg-th-surface-subtle font-semibold text-th-fg-subtle opacity-60 ${
        small ? "px-3 py-1 text-label-md" : "min-h-[44px] px-3.5 py-2 text-label-lg"
      }`}
    >
      <Icon name={icon} size={small ? 14 : 18} />
      {label}
      <span id={`${id}-hint`} className="sr-only">
        {label}: todavía no disponible, falta soporte en el servidor
      </span>
    </button>
  );
}

function PendingSelect({ label }) {
  return (
    <span
      className="inline-flex min-h-[40px] items-center gap-1 rounded-th-sm border border-th-border bg-th-surface-subtle px-3 py-1.5 text-body-sm font-semibold text-th-fg-subtle opacity-60"
      title={`${label}: aplica a contenido de vídeo, que todavía no existe`}
    >
      {label}
      <Icon name="expand_more" size={16} />
      <span className="sr-only">: todavía no disponible, no hay contenido de vídeo indexado</span>
    </span>
  );
}
