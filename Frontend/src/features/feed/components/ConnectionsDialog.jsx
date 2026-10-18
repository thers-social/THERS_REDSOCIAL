import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@shared/components/Avatar";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { fetchConnections, followLabel, setFollow } from "../lib/socialApi";

const TABS = [
  { id: "followers", label: "Seguidores" },
  { id: "following", label: "Siguiendo" },
];

/**
 * Seguidores y seguidos de una persona (ADR-050), la propia o la de otra. Cada fila lleva a su perfil
 * y permite seguir o dejar de seguir. En una cuenta privada que no sigues el servidor responde 403 y
 * aquí se explica.
 */
export default function ConnectionsDialog({ userId, username, initialTab = "followers", onClose }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [tab, setTab] = useState(initialTab);
  const [items, setItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sequence = useRef(0);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setItems(null);
    setError(null);
    try {
      const page = await fetchConnections(userId, tab, 0);
      if (mine !== sequence.current) return;
      setItems(page.users);
      setHasMore(page.has_more);
    } catch (err) {
      if (mine !== sequence.current) return;
      setError({ denied: err?.response?.status === 403, message: getErrorMessage(err, t) });
    }
  }, [userId, tab, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (loadingMore || !items) return;
    const mine = sequence.current;
    setLoadingMore(true);
    try {
      const page = await fetchConnections(userId, tab, items.length);
      if (mine !== sequence.current) return;
      setItems((current) => {
        const known = new Set(current.map((p) => p.id));
        return [...current, ...page.users.filter((p) => !known.has(p.id))];
      });
      setHasMore(page.has_more);
    } catch {
      // Se reintenta con el mismo botón.
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleFollow(person) {
    try {
      const result = await setFollow(person.id, person.follow_status === null);
      setItems((current) =>
        current.map((p) => (p.id === person.id ? { ...p, follow_status: result.follow_status ?? null } : p))
      );
    } catch (err) {
      toast.error(getErrorMessage(err, t));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Seguidores y seguidos de @${username}`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-[24px] bg-surface shadow-soft dark:bg-surface-dark"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3 dark:border-line-dark">
          <h2 className="text-base font-semibold text-ink dark:text-ink-dark">@{username}</h2>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm font-semibold text-muted">
            Cerrar
          </button>
        </header>

        <div role="tablist" className="flex border-b border-line dark:border-line-dark">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`flex-1 border-b-2 px-4 py-3 text-sm font-semibold ${
                tab === item.id ? "border-th-brand text-th-brand-fg" : "border-transparent text-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="min-h-[12rem] flex-1 overflow-y-auto px-3 py-2">
          {items === null && !error && (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          )}
          {error && (
            <div role="alert" className="py-10 text-center text-sm text-muted">
              {error.denied ? (
                <>
                  <p className="font-semibold text-ink dark:text-ink-dark">Esta cuenta es privada</p>
                  <p className="mt-1">Sigue a esta cuenta para ver a quién sigue y quién la sigue.</p>
                </>
              ) : (
                <p>{error.message}</p>
              )}
            </div>
          )}
          {items && items.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">
              {tab === "followers" ? "Sin seguidores todavía." : "No sigue a nadie todavía."}
            </p>
          )}
          {items && items.length > 0 && (
            <ul className="space-y-1">
              {items.map((person) => (
                <li key={person.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <Link
                    to={person.is_me ? "/profile" : `/user/${person.id}`}
                    onClick={onClose}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <Avatar name={person.name} photo={person.avatar_url} size="w-11 h-11" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink dark:text-ink-dark">{person.name}</span>
                      <span className="block truncate text-xs text-muted">@{person.username}</span>
                    </span>
                  </Link>
                  {!person.is_me && (
                    <button
                      type="button"
                      onClick={() => toggleFollow(person)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${
                        person.follow_status
                          ? "border-line text-muted dark:border-line-dark"
                          : "border-th-brand bg-th-brand text-th-on-brand"
                      }`}
                    >
                      {followLabel(person.follow_status, person.is_private)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <div className="flex justify-center py-3">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50 dark:border-line-dark dark:text-ink-dark"
              >
                {loadingMore ? "Cargando…" : "Ver más"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
