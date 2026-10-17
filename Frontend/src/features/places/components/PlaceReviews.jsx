import { useEffect, useState } from "react";
import Avatar from "@shared/components/Avatar";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { useAuth } from "@features/auth/context/AuthContext";
import { usePlaceReviews } from "../hooks/usePlaceReviews";
import ReportReviewDialog from "./ReportReviewDialog";
import ReviewPhotos from "./ReviewPhotos";
import ReviewReply from "./ReviewReply";

const MAX_BODY = 1000;
const STARS = [1, 2, 3, 4, 5];

function Stars({ value, size = 16 }) {
  return (
    <span className="inline-flex" aria-hidden="true">
      {STARS.map((star) => (
        <Icon
          key={star}
          name="star"
          size={size}
          fill={star <= Math.round(value) ? 1 : 0}
          className="text-th-warning-fg"
        />
      ))}
    </span>
  );
}

function ReviewForm({ mine, onSave, onDelete, onCancel }) {
  const { t } = useLanguage();
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!rating || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ rating, body: body.trim() || null });
    } catch (err) {
      setError(getErrorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line p-3 dark:border-line-dark">
      <fieldset>
        <legend className="mb-1 text-xs font-semibold text-muted dark:text-muted-dark">
          {t("places.reviews.yourRating")}
        </legend>
        <div className="flex gap-1">
          {STARS.map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              aria-pressed={rating === star}
              aria-label={t("places.reviews.starsLabel", { count: star })}
              className="rounded-full p-1 focus-visible:outline focus-visible:outline-2"
            >
              <Icon
                name="star"
                size={26}
                fill={star <= rating ? 1 : 0}
                className={star <= rating ? "text-th-warning-fg" : "text-muted dark:text-muted-dark"}
              />
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="sr-only">{t("places.reviews.bodyLabel")}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={MAX_BODY}
          rows={3}
          placeholder={t("places.reviews.bodyPlaceholder")}
          className="w-full rounded-xl border border-line bg-transparent p-2 text-sm text-ink dark:border-line-dark dark:text-ink-dark"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs font-semibold text-th-danger-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!rating || busy}
          className="rounded-full bg-th-brand px-4 py-2 text-xs font-semibold text-th-on-brand disabled:opacity-50"
        >
          {busy ? t("places.reviews.saving") : mine ? t("places.reviews.update") : t("places.reviews.publish")}
        </button>
        {mine && (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-th-danger-fg dark:border-line-dark"
          >
            {t("places.reviews.delete")}
          </button>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-2 text-xs font-semibold text-muted">
            {t("places.report.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Reseñas de la ficha (ADR-040 fase 4a). Cualquier persona con sesión puede reseñar; sin
 * sesión se leen. El texto de las reseñas se pinta SIEMPRE como texto de React (nunca
 * como HTML).
 */
export default function PlaceReviews({ placeId, canReply = false, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const data = usePlaceReviews(placeId);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(null);

  // Si la lista se recarga con una reseña propia nueva, se cierra el formulario.
  useEffect(() => {
    setEditing(false);
  }, [data.mine?.id, data.mine?.updated_at]);

  async function save(values) {
    await data.save(values);
    toast.success(t("places.reviews.saved"));
    onChanged?.();
  }

  async function remove() {
    try {
      await data.remove();
      toast.success(t("places.reviews.deleted"));
      onChanged?.();
    } catch (err) {
      toast.error(getErrorMessage(err, t));
    }
  }

  const { summary } = data;
  const others = data.reviews.filter((review) => !review.is_mine);

  return (
    <section aria-labelledby="place-reviews-title" className="mt-6">
      <h3 id="place-reviews-title" className="text-sm font-semibold text-ink dark:text-ink-dark">
        {t("places.reviews.title")}
      </h3>
      {summary.count > 0 ? (
        <p className="mt-1 flex items-center gap-2 text-sm text-ink dark:text-ink-dark">
          <Stars value={summary.average} />
          <span className="font-semibold">{summary.average.toFixed(1)}</span>
          <span className="text-muted dark:text-muted-dark">
            {t("places.reviews.count", { count: summary.count })}
          </span>
        </p>
      ) : (
        data.status === "ready" && (
          <p className="mt-1 text-sm text-muted dark:text-muted-dark">{t("places.reviews.none")}</p>
        )
      )}

      {data.status === "loading" && data.reviews.length === 0 && (
        <div role="status" className="py-4">
          <Spinner />
        </div>
      )}
      {data.status === "error" && (
        <div role="alert" className="py-3 text-sm">
          <p className="text-th-danger-fg">{data.error}</p>
          <button type="button" onClick={data.reload} className="mt-2 text-xs font-semibold text-th-brand-fg">
            {t("places.state.retry")}
          </button>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {!user ? (
          <p className="text-xs text-muted dark:text-muted-dark">{t("places.reviews.signIn")}</p>
        ) : data.mine && !editing ? (
          <article className="rounded-2xl border border-th-brand/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-th-brand-fg">{t("places.reviews.yours")}</span>
              <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-th-brand-fg hover:underline">
                {t("places.reviews.edit")}
              </button>
            </div>
            <Stars value={data.mine.rating} />
            {data.mine.body && (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink dark:text-ink-dark">{data.mine.body}</p>
            )}
            <ReviewPhotos placeId={placeId} images={data.mine.images ?? []} editable onChanged={data.reload} />
            {data.mine.hidden && (
              <p role="status" className="mt-2 text-xs font-semibold text-th-warning-fg">
                {t("places.reviews.hidden")}
              </p>
            )}
          </article>
        ) : data.status !== "loading" ? (
          <ReviewForm
            mine={data.mine}
            onSave={save}
            onDelete={remove}
            onCancel={data.mine ? () => setEditing(false) : null}
          />
        ) : null}

        <ul className="space-y-3">
          {others.map((review) => (
            <li key={review.id} className="flex gap-3">
              <Avatar name={review.author.name || review.author.username} photo={review.author.avatar_url} size="w-8 h-8" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink dark:text-ink-dark">
                  {review.author.name || review.author.username}
                  <span className="ml-2 font-normal text-muted dark:text-muted-dark">
                    {new Date(review.created_at).toLocaleDateString()}
                  </span>
                </p>
                <Stars value={review.rating} size={14} />
                {review.body && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink dark:text-ink-dark">{review.body}</p>
                )}
                <ReviewPhotos placeId={placeId} images={review.images ?? []} />
                <ReviewReply placeId={placeId} review={review} canReply={canReply} onChanged={data.reload} />
                {user && (
                  <button
                    type="button"
                    onClick={() => setReporting(review)}
                    className="mt-1 text-xs font-semibold text-muted hover:underline dark:text-muted-dark"
                  >
                    {t("places.reviews.report.open")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {reporting && (
        <ReportReviewDialog
          review={reporting}
          onClose={() => setReporting(null)}
          onReported={() => {
            setReporting(null);
            toast.success(t("places.reviews.report.thanks"));
          }}
        />
      )}
    </section>
  );
}
