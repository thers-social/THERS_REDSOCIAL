import { useCallback, useEffect, useState } from "react";
import Avatar from "@shared/components/Avatar";
import ImageGrid from "@shared/components/ImageGrid";
import VideoPlayer from "@shared/components/VideoPlayer";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { useAuth } from "@features/auth/context/AuthContext";
import { formatRelativeTime } from "@features/feed/lib/formatRelativeTime";
import { createPlacePost, fetchPlacePosts } from "../lib/placesApi";

const MAX_LENGTH = 2000;

/**
 * Publicaciones asociadas a un lugar (ADR-040 fase 4d). Se listan con las mismas reglas de
 * visibilidad que el feed (cuentas privadas, bloqueos, filtros); el texto se pinta como texto
 * de React. Publicar desde aquí asocia el lugar automáticamente; las fotos se suben desde el
 * flujo normal de publicar.
 */
export default function PlacePosts({ placeId }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const [state, setState] = useState({ status: "loading", posts: [] });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(
    (signal) =>
      fetchPlacePosts(placeId, signal)
        .then((posts) => setState({ status: "ready", posts }))
        .catch((error) => {
          if (!signal?.aborted) setState({ status: "error", posts: [], error: getErrorMessage(error, t) });
        }),
    [placeId, t]
  );

  useEffect(() => {
    if (!user) {
      setState({ status: "anonymous", posts: [] });
      return undefined;
    }
    setState({ status: "loading", posts: [] });
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [placeId, user, load]);

  async function publish(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await createPlacePost(placeId, content);
      setDraft("");
      toast.success(t("places.posts.published"));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-posts-title">
      <h2 id="place-posts-title" className="text-base font-semibold text-ink dark:text-ink-dark">
        {t("places.posts.title")}
      </h2>

      {state.status === "anonymous" && <p className="mt-2 text-sm text-muted">{t("places.posts.signIn")}</p>}

      {user && (
        <form onSubmit={publish} className="mt-3 space-y-2">
          <label className="block text-sm">
            <span className="sr-only">{t("places.posts.label")}</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_LENGTH}
              rows={2}
              placeholder={t("places.posts.placeholder")}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
            />
          </label>
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand hover:bg-th-brand-hover disabled:opacity-50"
          >
            {sending ? t("places.posts.publishing") : t("places.posts.publish")}
          </button>
        </form>
      )}

      {state.status === "loading" && <Spinner className="mt-3" />}
      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-th-danger-fg">
          {state.error}
        </p>
      )}
      {state.status === "ready" && state.posts.length === 0 && (
        <p className="mt-3 text-sm text-muted">{t("places.posts.empty")}</p>
      )}
      {state.posts.length > 0 && (
        <ul className="mt-3 space-y-4">
          {state.posts.map((post) => (
            <li key={post.id} className="flex gap-3">
              <Avatar name={post.author.name} photo={post.author.avatar_url} size="w-9 h-9" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink dark:text-ink-dark">
                  <span className="font-semibold">{post.author.name}</span>{" "}
                  <span className="text-xs text-muted">{formatRelativeTime(post.created_at)}</span>
                </p>
                {post.is_sensitive && post.author.id !== user?.id ? (
                  <p className="mt-1 text-xs italic text-muted">{t("places.posts.sensitive")}</p>
                ) : (
                  <>
                    {post.content && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink dark:text-ink-dark">{post.content}</p>
                    )}
                    <ImageGrid images={post.images} alt={`Imagen de ${post.author.name}`} compact />
                    <VideoPlayer video={post.video} label={`Video de ${post.author.name}`} compact />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
