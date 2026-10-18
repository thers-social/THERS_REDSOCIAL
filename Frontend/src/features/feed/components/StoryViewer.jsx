import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@shared/components/Icon";
import Avatar from "@shared/components/Avatar";
import ConfirmDialog from "@shared/components/ConfirmDialog";
import Spinner from "@shared/components/Spinner";
import { formatRelativeTime } from "../lib/formatRelativeTime";
import {
  deleteStory,
  fetchUserStories,
  fetchViews,
  markViewed,
} from "../lib/storiesApi";
import {
  STORY_DURATION_MS,
  barFill,
  firstUnseenIndex,
  nextPosition,
  previousPosition,
} from "../lib/storyProgress";

const TICK_MS = 100;

/**
 * Visor de historias (ADR-042). Pantalla completa, una persona tras otra.
 *
 * Carga las historias de cada persona al llegar a ella (no todas de golpe). Registra la vista
 * de las ajenas al mostrarlas. Mantener pulsado o abrir un diálogo pausa el avance. Quien
 * publicó puede ver cuántas personas la vieron y borrarla.
 */
export default function StoryViewer({ authors, startIndex, onClose, onChanged }) {
  const [position, setPosition] = useState({ authorIndex: startIndex, storyIndex: 0 });
  // id de la persona -> {status: "loading"|"ready"|"error", stories: []}
  const [loaded, setLoaded] = useState({});
  const [elapsed, setElapsed] = useState(0);
  const [holding, setHolding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [views, setViews] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const viewedRef = useRef(new Set());

  const author = authors[position.authorIndex];
  const entry = loaded[author.author.id];
  const stories = entry?.stories ?? [];
  const story = stories[position.storyIndex];
  const counts = authors.map((a, i) =>
    i === position.authorIndex && entry?.status === "ready" ? stories.length : a.stories_count
  );

  // Carga las historias de la persona actual la primera vez que se llega a ella.
  useEffect(() => {
    const id = author.author.id;
    if (loaded[id]) return undefined;
    const controller = new AbortController();
    setLoaded((state) => ({ ...state, [id]: { status: "loading", stories: [] } }));
    fetchUserStories(id, controller.signal)
      .then((list) => {
        setLoaded((state) => ({ ...state, [id]: { status: "ready", stories: list } }));
        setPosition((current) =>
          current.authorIndex === position.authorIndex && current.storyIndex === 0
            ? { ...current, storyIndex: firstUnseenIndex(list) }
            : current
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoaded((state) => ({ ...state, [id]: { status: "error", stories: [] } }));
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar de persona
  }, [position.authorIndex]);

  const advance = useCallback(() => {
    const next = nextPosition(position, counts);
    if (next === null) onClose();
    else {
      setElapsed(0);
      setViews(null);
      setPosition(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `counts` se recalcula en cada render
  }, [position, onClose, entry?.status, stories.length]);

  const back = useCallback(() => {
    setElapsed(0);
    setViews(null);
    setPosition((current) => previousPosition(current, counts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.status, stories.length]);

  // Registrar la vista de las historias ajenas, una sola vez por historia y sesión del visor.
  useEffect(() => {
    if (!story || author.is_me || viewedRef.current.has(story.id)) return;
    viewedRef.current.add(story.id);
    markViewed(story.id)
      .then(() => onChanged?.())
      .catch(() => viewedRef.current.delete(story.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // Avance automático.
  useEffect(() => {
    if (!story || holding || confirmDelete || deleting) return undefined;
    const id = setInterval(() => setElapsed((value) => value + TICK_MS), TICK_MS);
    return () => clearInterval(id);
  }, [story, holding, confirmDelete, deleting]);

  useEffect(() => {
    if (elapsed >= STORY_DURATION_MS) advance();
  }, [elapsed, advance]);

  // Teclado: Escape cierra, flechas navegan.
  useEffect(() => {
    function onKey(event) {
      if (confirmDelete) return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") advance();
      else if (event.key === "ArrowLeft") back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, onClose, confirmDelete]);

  async function handleShowViews() {
    if (views) {
      setViews(null);
      return;
    }
    setViews({ status: "loading" });
    try {
      const data = await fetchViews(story.id);
      setViews({ status: "ready", ...data });
    } catch {
      setViews({ status: "error" });
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteStory(story.id);
      onChanged?.();
      const remaining = stories.filter((s) => s.id !== story.id);
      if (remaining.length === 0) {
        onClose();
        return;
      }
      setLoaded((state) => ({
        ...state,
        [author.author.id]: { status: "ready", stories: remaining },
      }));
      setPosition((current) => ({
        ...current,
        storyIndex: Math.min(current.storyIndex, remaining.length - 1),
      }));
      setElapsed(0);
      setViews(null);
    } catch {
      // Se deja la historia donde está; el usuario puede reintentar.
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 px-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Historias de ${author.author.name}`}
    >
      <div
        className="relative h-[80vh] w-full max-w-sm select-none overflow-hidden rounded-[32px] bg-black"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={() => setHolding(true)}
        onPointerUp={() => setHolding(false)}
        onPointerLeave={() => setHolding(false)}
      >
        {entry?.status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-white" role="status">
            <Spinner size={24} />
          </div>
        )}
        {entry?.status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
            <Icon name="cloud_off" size={28} />
            <p className="text-label-lg font-bold">No se pudieron cargar las historias</p>
            <button type="button" onClick={onClose} className="rounded-th-pill bg-white/20 px-4 py-2 text-label-lg">
              Cerrar
            </button>
          </div>
        )}
        {entry?.status === "ready" && stories.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
            <Icon name="history_toggle_off" size={28} />
            <p className="text-label-lg font-bold">Esta historia ya no está disponible</p>
            <button type="button" onClick={advance} className="rounded-th-pill bg-white/20 px-4 py-2 text-label-lg">
              Continuar
            </button>
          </div>
        )}

        {story && (
          <>
            <img
              src={story.image.url}
              alt={story.content || `Historia de ${author.author.name}`}
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />

            <div className="absolute inset-x-0 top-0 flex gap-1 p-4">
              {stories.map((item, i) => (
                <div key={item.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                  <div
                    className="h-full bg-white"
                    style={{ width: `${barFill(i, position.storyIndex, elapsed) * 100}%` }}
                  />
                </div>
              ))}
            </div>

            <div className="absolute left-4 top-8 flex items-center gap-2">
              <Avatar name={author.author.name} photo={author.author.avatar_url} size="w-9 h-9 text-sm" ring />
              <div>
                <p className="text-sm font-semibold text-white drop-shadow">{author.author.name}</p>
                <p className="text-xs text-white/70">{formatRelativeTime(story.created_at)}</p>
              </div>
            </div>

            {story.content && (
              <p className="absolute inset-x-4 bottom-16 text-center text-body-md font-semibold text-white drop-shadow-lg">
                {story.content}
              </p>
            )}

            {author.is_me && (
              <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleShowViews}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-th-pill bg-black/40 px-3 text-label-lg font-semibold text-white"
                >
                  <Icon name="visibility" size={18} />
                  {views?.status === "ready" ? views.views_count : "Vistas"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Borrar esta historia"
                  className="flex h-10 w-10 items-center justify-center rounded-th-pill bg-black/40 text-white"
                >
                  <Icon name="delete" size={20} />
                </button>
              </div>
            )}

            {author.is_me && views && (
              <div className="absolute inset-x-4 bottom-16 max-h-[40%] overflow-y-auto rounded-th-card bg-black/70 p-3 text-white">
                {views.status === "loading" && <Spinner size={18} />}
                {views.status === "error" && <p className="text-body-sm">No se pudo cargar quién la vio.</p>}
                {views.status === "ready" &&
                  (views.views.length === 0 ? (
                    <p className="text-body-sm">Todavía nadie la vio.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {views.views.map((viewer) => (
                        <li key={viewer.id} className="flex items-center gap-2 text-body-sm">
                          <Avatar name={viewer.name} photo={viewer.avatar_url} size="w-7 h-7 text-xs" />
                          <span className="truncate font-semibold">{viewer.name}</span>
                          <span className="ml-auto shrink-0 text-white/60">{formatRelativeTime(viewer.viewed_at)}</span>
                        </li>
                      ))}
                    </ul>
                  ))}
              </div>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar historias"
          className="absolute right-4 top-7 rounded-full bg-black/25 p-2 text-white transition hover:bg-black/40"
        >
          <Icon name="close" size={20} />
        </button>

        <button
          type="button"
          onClick={back}
          aria-label="Historia anterior"
          className="absolute inset-y-24 left-0 w-1/4"
        />
        <button
          type="button"
          onClick={advance}
          aria-label="Historia siguiente"
          className="absolute inset-y-24 right-0 w-1/4"
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="¿Borrar esta historia?"
        description="Se borra para todas las personas y no se puede deshacer."
        confirmLabel={deleting ? "Borrando…" : "Borrar"}
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
