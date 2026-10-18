import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import Avatar from "@shared/components/Avatar";
import Icon from "@shared/components/Icon";
import ImageGrid from "@shared/components/ImageGrid";
import Spinner from "@shared/components/Spinner";
import VideoPlayer from "@shared/components/VideoPlayer";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import { getErrorMessage } from "@shared/lib/api";
import { formatRelativeTime } from "../lib/formatRelativeTime";
import { fetchSavedPosts, setPostSaved } from "../lib/savedPostsApi";

/**
 * Publicaciones guardadas (ADR-047). Lista privada: la última guardada primero. Solo aparecen las
 * que sigues pudiendo ver (el servidor aplica las mismas reglas que el feed); una que deja de ser
 * visible desaparece sin borrarse.
 */
export default function Saved() {
  const { t } = useLanguage();
  const toast = useToast();
  const { currentUser } = useOutletContext();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchSavedPosts(controller.signal)
      .then(setPosts)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(getErrorMessage(err, t));
          setPosts([]);
        }
      });
    return () => controller.abort();
  }, [t]);

  async function remove(post) {
    const previous = posts;
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
    try {
      await setPostSaved(post.id, false);
      toast.success(t("postActions.save.removed"));
    } catch (err) {
      setPosts(previous);
      toast.error(getErrorMessage(err, t));
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4" aria-labelledby="saved-title">
      <header>
        <h1 id="saved-title" className="text-headline-sm font-semibold text-th-fg-strong">
          {t("postActions.saved.title")}
        </h1>
        <p className="text-body-sm text-th-fg-muted">{t("postActions.saved.subtitle")}</p>
      </header>

      {posts === null && (
        <div className="flex justify-center py-8" role="status">
          <Spinner />
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-th-danger-fg">
          {error}
        </p>
      )}
      {posts && posts.length === 0 && !error && (
        <p className="rounded-th-card border border-th-border bg-th-surface p-6 text-center text-body-md text-th-fg-muted">
          {t("postActions.saved.empty")}
        </p>
      )}

      {posts?.map((post) => (
        <article key={post.id} className="flex flex-col gap-3 rounded-th-card border border-th-border bg-th-surface p-5">
          <header className="flex items-center gap-3">
            <Avatar name={post.author.name} photo={post.author.avatar_url} size="w-10 h-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-label-lg font-semibold text-th-fg-strong">{post.author.name}</p>
              <p className="truncate text-body-sm text-th-fg-muted">
                @{post.author.username} · {formatRelativeTime(post.created_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(post)}
              aria-label={t("postActions.save.remove")}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-th-pill px-3 py-1.5 text-label-lg text-th-brand th-focus-ring hover:bg-th-surface-subtle"
            >
              <Icon name="bookmark" size={20} fill={1} />
              <span>{t("postActions.save.remove")}</span>
            </button>
          </header>
          {post.is_sensitive && post.author.id !== currentUser?.id ? (
            <p className="flex items-center gap-1 text-body-sm text-th-fg-muted">
              <Icon name="warning" size={16} />
              {t("postActions.card.sensitive")}
            </p>
          ) : (
            <>
              {post.content && <p className="whitespace-pre-wrap break-words text-body-md text-th-fg">{post.content}</p>}
              <ImageGrid images={post.images} alt={`Imagen de ${post.author.name}`} />
              <VideoPlayer video={post.video} label={`Video de ${post.author.name}`} />
            </>
          )}
        </article>
      ))}
    </section>
  );
}
