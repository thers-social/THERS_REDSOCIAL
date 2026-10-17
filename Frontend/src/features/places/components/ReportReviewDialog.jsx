import { useEffect, useRef, useState } from "react";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { MAX_REPORT_DETAILS } from "../lib/placeReasons";
import { REVIEW_REPORT_REASONS } from "../lib/reviewReasons";
import { reportReview } from "../lib/placesApi";

/**
 * Reportar la reseña de otra persona (ADR-040 fase 4a.2; `POST /api/reports` con
 * `target_type = "review"`, ADR-032). Quien reporta NO es revelado al autor. El servidor
 * valida todo; aquí solo se evita enviar un formulario que se sabe inválido.
 */
export default function ReportReviewDialog({ review, onClose, onReported }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const firstField = useRef(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (event) => event.key === "Escape" && !sending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  async function submit(event) {
    event.preventDefault();
    if (!reason || sending) return;
    setSending(true);
    setError("");
    try {
      await reportReview(review.id, { reason, details: details.trim() || undefined });
      onReported();
    } catch (err) {
      setError(getErrorMessage(err, t));
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => !sending && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-review-title"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-[24px] bg-surface p-6 shadow-soft dark:bg-surface-dark"
      >
        <h2 id="report-review-title" className="text-base font-semibold text-ink dark:text-ink-dark">
          {t("places.reviews.report.title")}
        </h2>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-ink dark:text-ink-dark">{t("places.reviews.report.reasonLabel")}</span>
          <select
            ref={firstField}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          >
            <option value="">{t("places.report.reasonPlaceholder")}</option>
            {REVIEW_REPORT_REASONS.map((value) => (
              <option key={value} value={value}>
                {t(`places.reviews.report.reasons.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-ink dark:text-ink-dark">{t("places.report.detailsOptional")}</span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={MAX_REPORT_DETAILS}
            rows={3}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-th-danger-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={sending} className="rounded-full px-4 py-2 text-sm font-semibold text-ink dark:text-ink-dark">
            {t("places.report.cancel")}
          </button>
          <button
            type="submit"
            disabled={!reason || sending}
            className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand hover:bg-th-brand-hover disabled:opacity-50"
          >
            {sending ? t("places.report.sending") : t("places.report.send")}
          </button>
        </div>
      </form>
    </div>
  );
}
