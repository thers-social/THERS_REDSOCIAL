import { useState } from "react";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { deleteReviewReply, replyToReview } from "../lib/placesApi";

const MAX_REPLY = 500;

/**
 * Respuesta pública del negocio a una reseña (ADR-040 fase 7). Todos la leen; solo quien
 * gestiona el lugar (`canReply`) puede escribirla, corregirla o quitarla. Texto plano.
 */
export default function ReviewReply({ placeId, review, canReply, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(review.reply?.body ?? "");
  const [busy, setBusy] = useState(false);

  async function run(action, successKey) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey));
      setEditing(false);
      onChanged?.();
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      {review.reply && !editing && (
        <div className="rounded-lg bg-surface-alt p-2 text-sm dark:bg-surface-alt-dark">
          <p className="text-xs font-semibold text-muted">{t("places.reply.title")}</p>
          <p className="whitespace-pre-wrap break-words text-ink dark:text-ink-dark">{review.reply.body}</p>
        </div>
      )}
      {canReply && !editing && (
        <div className="mt-1 flex gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-th-brand hover:underline"
          >
            {review.reply ? t("places.reply.edit") : t("places.reply.write")}
          </button>
          {review.reply && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => deleteReviewReply(placeId, review.id), "places.reply.removed")}
              className="text-xs font-semibold text-th-danger-fg hover:underline disabled:opacity-50"
            >
              {t("places.reply.remove")}
            </button>
          )}
        </div>
      )}
      {canReply && editing && (
        <form
          className="mt-1 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim()) run(() => replyToReview(placeId, review.id, body.trim()), "places.reply.saved");
          }}
        >
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={MAX_REPLY}
            rows={3}
            aria-label={t("places.reply.title")}
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm dark:border-line-dark"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !body.trim()}
              className="rounded-full bg-th-brand px-3 py-1.5 text-xs font-semibold text-th-on-brand disabled:opacity-50"
            >
              {t("places.reply.save")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink dark:text-ink-dark"
            >
              {t("places.reply.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
