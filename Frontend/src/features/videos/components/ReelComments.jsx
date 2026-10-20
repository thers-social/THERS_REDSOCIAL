import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@shared/components/Avatar";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { deleteComment, fetchComments, postComment } from "../lib/videosApi";
import { commentErrorMessage, formatCount } from "../lib/reelsLogic";

const MAX_COMMENT = 1000;

/**
 * Panel de comentarios de un Reel (ADR-055). Se abre como una hoja inferior sobre el propio video, igual
 * que en Instagram: el Reel sigue detrás. `onCountChange(delta)` mantiene el contador del carril al día.
 */
export default function ReelComments({ videoId, count, onClose, onCountChange }) {
  const toast = useToast();
  const [comments, setComments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(
    async (offset, signal) => {
      try {
        const data = await fetchComments(videoId, { limit: 20, offset }, signal);
        setComments((current) => (offset ? [...current, ...data.comments] : data.comments));
        setHasMore(data.has_more);
        setState("ready");
      } catch (failure) {
        if (failure?.code === "ERR_CANCELED") return;
        setState("error");
      } finally {
        setLoadingMore(false);
      }
    },
    [videoId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(0, controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const comment = await postComment(videoId, content);
      setComments((current) => [...current, comment]);
      setText("");
      onCountChange(1);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
    } catch (failure) {
      setError(commentErrorMessage(failure));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function remove(comment) {
    try {
      await deleteComment(videoId, comment.id);
      setComments((current) => current.filter((c) => c.id !== comment.id));
      onCountChange(-1);
    } catch {
      toast.error("No se pudo borrar el comentario");
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Comentarios"
      className="absolute inset-x-0 bottom-0 z-30 flex h-[72%] flex-col rounded-t-2xl bg-th-surface text-th-fg shadow-th-card"
    >
      <header className="flex items-center justify-between border-b border-th-border px-4 py-3">
        <h2 className="text-title-md font-bold text-th-fg-strong">
          Comentarios <span className="font-medium text-th-fg-muted">{formatCount(count)}</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar comentarios"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-th-surface-subtle"
        >
          <Icon name="close" size={22} />
        </button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
        {state === "loading" && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {state === "error" && (
          <p role="alert" className="py-8 text-center text-body-md text-th-fg-muted">
            No se pudieron cargar los comentarios.
          </p>
        )}
        {state === "ready" && comments.length === 0 && (
          <p className="py-8 text-center text-body-md text-th-fg-muted">Todavía no hay comentarios. Sé la primera persona.</p>
        )}
        <ul className="flex flex-col gap-4">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <Avatar name={comment.author.name || comment.author.username} photo={comment.author.avatar_url} size="w-9 h-9" />
              <div className="min-w-0 flex-1">
                <Link to={`/user/${comment.author.id}`} className="text-label-md font-bold text-th-fg-strong hover:underline">
                  @{comment.author.username}
                </Link>
                <p className="whitespace-pre-wrap break-words text-body-md">{comment.content}</p>
              </div>
              {comment.can_delete && (
                <button
                  type="button"
                  onClick={() => remove(comment)}
                  aria-label="Borrar comentario"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-th-fg-muted hover:bg-th-surface-subtle"
                >
                  <Icon name="delete" size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {hasMore && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              load(comments.length);
            }}
            className="mx-auto mt-4 block rounded-th-pill border border-th-border px-4 py-1.5 text-label-md disabled:opacity-50"
          >
            {loadingMore ? "Cargando…" : "Ver más comentarios"}
          </button>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-th-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="mb-2 text-body-sm text-th-danger-fg">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={text}
            maxLength={MAX_COMMENT}
            onChange={(event) => setText(event.target.value)}
            placeholder="Añade un comentario…"
            aria-label="Escribe un comentario"
            className="min-w-0 flex-1 rounded-th-pill border border-th-border bg-th-surface-subtle px-4 py-2 text-body-md outline-none focus-visible:ring-2 focus-visible:ring-th-brand"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label="Publicar comentario"
            className="grid h-10 w-10 place-items-center rounded-full bg-th-brand text-th-on-brand disabled:opacity-40"
          >
            <Icon name="send" size={20} fill={1} />
          </button>
        </div>
      </form>
    </div>
  );
}
