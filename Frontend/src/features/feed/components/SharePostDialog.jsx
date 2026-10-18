import { useEffect, useState } from "react";
import Avatar from "@shared/components/Avatar";
import Spinner from "@shared/components/Spinner";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { IoPeopleOutline } from "react-icons/io5";
import { fetchShareTargets, sharePost } from "../lib/savedPostsApi";

/**
 * Mandar una publicación por chat (ADR-047). Se elige entre las personas con las que ya hay una
 * conversación; el servidor vuelve a comprobar bloqueos, privacidad y que quien comparte pueda ver
 * la publicación, así que aquí solo se muestra el resultado.
 */
export default function SharePostDialog({ post, onClose, onShared }) {
  const { t } = useLanguage();
  const [people, setPeople] = useState(null);
  const [comment, setComment] = useState("");
  const [sendingTo, setSendingTo] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchShareTargets(controller.signal)
      .then(setPeople)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(getErrorMessage(err, t));
          setPeople([]);
        }
      });
    return () => controller.abort();
  }, [t]);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && !sendingTo && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sendingTo]);

  async function send(person) {
    if (sendingTo) return;
    setSendingTo(`${person.kind}-${person.id}`);
    setError("");
    try {
      await sharePost(person, post.id, comment.trim());
      onShared(person);
    } catch (err) {
      setError(getErrorMessage(err, t));
      setSendingTo(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => !sendingTo && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-post-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-[24px] bg-surface p-6 shadow-soft dark:bg-surface-dark"
      >
        <h2 id="share-post-title" className="text-base font-semibold text-ink dark:text-ink-dark">
          {t("postActions.share.title", { name: post.author.name })}
        </h2>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-ink dark:text-ink-dark">{t("postActions.share.commentLabel")}</span>
          <input
            type="text"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={500}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          />
        </label>
        {people === null && <Spinner />}
        {people && people.length === 0 && !error && (
          <p className="text-sm text-muted">{t("postActions.share.empty")}</p>
        )}
        {people && people.length > 0 && (
          <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={t("postActions.share.people")}>
            {people.map((person) => (
              <li key={`${person.kind}-${person.id}`}>
                <button
                  type="button"
                  onClick={() => send(person)}
                  disabled={!!sendingTo}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-canvas disabled:opacity-50 dark:hover:bg-canvas-dark"
                >
                  {person.kind === "group" ? (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pulse-100 text-pulse-700 dark:bg-pulse-900/30 dark:text-pulse-300">
                      <IoPeopleOutline size={18} />
                    </span>
                  ) : (
                    <Avatar name={person.name} photo={person.avatar_url} size="w-9 h-9" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink dark:text-ink-dark">{person.name}</span>
                  <span className="text-xs font-semibold text-th-brand-fg">
                    {sendingTo === `${person.kind}-${person.id}` ? t("postActions.share.sending") : t("postActions.share.send")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-th-danger-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} disabled={!!sendingTo} className="rounded-full px-4 py-2 text-sm font-semibold text-ink dark:text-ink-dark">
            {t("postActions.share.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
