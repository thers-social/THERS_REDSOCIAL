import { useEffect, useRef, useState } from "react";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { MAX_REPORT_DETAILS, REASON_NEEDS_DETAILS, REPORT_REASONS } from "../lib/placeReasons";
import { reportPlace } from "../lib/placesApi";

/**
 * Reportar datos incorrectos de un lugar (ADR-040 fase 2: POST /api/places/<id>/report).
 * El servidor valida todo; aquí solo se evita enviar un formulario que se sabe inválido.
 */
export default function ReportPlaceDialog({ place, onClose, onReported }) {
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

  const needsDetails = reason === REASON_NEEDS_DETAILS;
  const canSend = reason && (!needsDetails || details.trim()) && !sending;

  async function submit(event) {
    event.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      await reportPlace(place.id, { reason, details: details.trim() || undefined });
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
        aria-labelledby="report-place-title"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-[24px] bg-surface p-6 shadow-soft dark:bg-surface-dark"
      >
        <h2 id="report-place-title" className="text-base font-semibold text-ink dark:text-ink-dark">
          {t("places.report.title", { name: place.name })}
        </h2>

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-ink dark:text-ink-dark">{t("places.report.reasonLabel")}</span>
          <select
            ref={firstField}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          >
            <option value="">{t("places.report.reasonPlaceholder")}</option>
            {REPORT_REASONS.map((value) => (
              <option key={value} value={value}>
                {t(`places.report.reasons.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-ink dark:text-ink-dark">
            {needsDetails ? t("places.report.detailsRequired") : t("places.report.detailsOptional")}
          </span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={MAX_REPORT_DETAILS}
            rows={3}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          />
          <span className="block text-right text-[11px] text-muted dark:text-muted-dark">
            {details.length}/{MAX_REPORT_DETAILS}
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-full px-4 py-2 text-sm font-semibold text-ink hover:bg-line dark:text-ink-dark dark:hover:bg-line-dark"
          >
            {t("places.report.cancel")}
          </button>
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-50"
          >
            {sending ? t("places.report.sending") : t("places.report.send")}
          </button>
        </div>
      </form>
    </div>
  );
}
