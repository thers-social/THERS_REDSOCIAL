import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import CapsuleCard from "../components/CapsuleCard";
import { fetchExplore } from "../lib/socialApi";

const FILTERS = [
  { id: "all", label: "Para ti" },
  { id: "images", label: "Fotos" },
  { id: "videos", label: "Videos" },
];

// Explorar (ADR-050): cuadrícula de fotos y videos populares de personas que no sigues, como el
// Explorar de Instagram. Tocar una miniatura abre la publicación con sus comentarios. Se pagina con
// «Ver más»; el servidor aplica cuentas privadas, bloqueos y filtros.
export default function Explore() {
  const {
    currentUser,
    allCapsules,
    adoptCapsules,
    onToggleLike,
    onLoadComments,
    onPostComment,
    onDeleteComment,
    onEditComment,
    onToggleFollowAuthor,
    onDeleteCapsule,
    onEditCapsule,
  } = useOutletContext();
  const { t } = useLanguage();
  const [kind, setKind] = useState("all");
  const [items, setItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setItems(null);
    setError(null);
    try {
      const page = await fetchExplore(kind, 0);
      if (mine !== sequence.current) return;
      setItems(page.posts);
      setHasMore(page.has_more);
      adoptCapsules(page.posts);
    } catch (err) {
      if (mine === sequence.current) setError(getErrorMessage(err, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (loadingMore || !items) return;
    const mine = sequence.current;
    setLoadingMore(true);
    try {
      const page = await fetchExplore(kind, items.length);
      if (mine !== sequence.current) return;
      setItems((current) => {
        const known = new Set(current.map((p) => p.id));
        return [...current, ...page.posts.filter((p) => !known.has(p.id))];
      });
      setHasMore(page.has_more);
      adoptCapsules(page.posts);
    } catch {
      // Se reintenta con el mismo botón.
    } finally {
      setLoadingMore(false);
    }
  }

  const live = useMemo(() => new Map(allCapsules.map((c) => [c.id, c])), [allCapsules]);
  const opened = openId ? live.get(openId) ?? items?.find((p) => p.id === openId) : null;

  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (event) => event.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 py-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-headline-md text-th-fg-strong">Explorar</h1>
        <p className="text-body-md text-th-fg-muted">Fotos y videos populares de personas que aún no sigues.</p>
        <div className="flex gap-2" role="tablist" aria-label="Tipo de contenido">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={kind === filter.id}
              onClick={() => setKind(filter.id)}
              className={`rounded-th-pill border px-4 py-1.5 text-label-lg font-semibold th-focus-ring ${
                kind === filter.id
                  ? "border-th-brand bg-th-brand text-th-on-brand"
                  : "border-th-border bg-th-surface text-th-fg-muted hover:bg-th-surface-subtle"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      {items === null && !error && (
        <div className="flex justify-center py-16" role="status">
          <Spinner />
        </div>
      )}
      {error && (
        <div role="alert" className="py-16 text-center text-body-md text-th-fg-muted">
          <p>{error}</p>
          <button type="button" onClick={load} className="mt-2 font-semibold text-th-brand-fg hover:underline">
            Reintentar
          </button>
        </div>
      )}
      {items && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-th-card border border-dashed border-th-border bg-th-surface px-6 py-14 text-center">
          <Icon name="grid_view" size={26} className="text-th-fg-subtle" />
          <p className="text-label-lg font-bold text-th-fg-strong">Aún no hay nada que explorar</p>
          <p className="max-w-md text-body-md text-th-fg-muted">
            Cuando otras personas publiquen fotos o videos, aparecerán aquí.
          </p>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="grid grid-cols-3 gap-1 sm:gap-2">
          {items.map((post) => {
            const thumb = post.video?.thumbnail_url ?? post.images?.[0]?.url;
            const several = (post.images?.length ?? 0) > 1;
            return (
              <li key={post.id} className="relative aspect-square overflow-hidden bg-th-surface-subtle">
                <button
                  type="button"
                  onClick={() => setOpenId(post.id)}
                  aria-label={`${post.video ? "Video" : "Foto"} de ${post.author.name}`}
                  className="h-full w-full th-focus-ring"
                >
                  {thumb && <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  {(post.video || several) && (
                    <span className="absolute right-1.5 top-1.5 rounded-th-pill bg-black/50 p-1 text-white">
                      <Icon name={post.video ? "play_arrow" : "collections"} size={16} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-th-pill border border-th-border bg-th-surface px-5 py-2 text-label-lg font-semibold text-th-fg th-focus-ring hover:bg-th-surface-subtle disabled:opacity-50"
          >
            {loadingMore ? "Cargando…" : "Ver más"}
          </button>
        </div>
      )}

      {opened && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => setOpenId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Publicación"
            onClick={(event) => event.stopPropagation()}
            className="my-8 w-full max-w-2xl"
          >
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="mb-2 ml-auto flex items-center gap-1 rounded-th-pill bg-th-surface px-3 py-1 text-label-md font-semibold text-th-fg"
            >
              <Icon name="close" size={16} />
              Cerrar
            </button>
            <CapsuleCard
              capsule={opened}
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
          </div>
        </div>
      )}
    </div>
  );
}
