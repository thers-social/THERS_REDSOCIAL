import { useCallback, useEffect, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { useAuth } from "@features/auth/context/AuthContext";
import { createClaim, fetchMyClaims, withdrawClaim } from "../lib/placesApi";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Reclamar un negocio (ADR-040 fase 6). El documento que respalda el reclamo lo ve solo la
 * moderación; aquí únicamente se sube. Todo texto se pinta como texto de React.
 */
export default function PlaceClaim({ place }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const [state, setState] = useState({ status: "loading", claims: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const skip = !user || place.managed_by_me || place.is_claimed;

  const load = useCallback(
    (signal) =>
      fetchMyClaims(signal)
        .then((claims) =>
          setState({ status: "ready", claims: claims.filter((claim) => claim.place?.id === place.id) })
        )
        .catch((error) => {
          if (!signal?.aborted) setState({ status: "error", claims: [], error: getErrorMessage(error, t) });
        }),
    [place.id, t]
  );

  useEffect(() => {
    if (skip) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [skip, load]);

  if (!user) return null;
  if (place.managed_by_me) {
    return <p className="mt-6 text-sm font-semibold text-th-success-fg">{t("places.claims.managedByMe")}</p>;
  }
  if (place.is_claimed) return null;
  if (state.status === "loading") return <Spinner className="mt-4" />;

  const pending = state.claims.find((claim) => claim.status === "pending");
  const lastRejected = !pending && state.claims.find((claim) => claim.status === "rejected");

  async function withdraw() {
    if (busy) return;
    setBusy(true);
    try {
      await withdrawClaim(pending.id);
      toast.success(t("places.claims.withdrawn"));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-claim-title">
      <h2 id="place-claim-title" className="text-base font-semibold text-ink dark:text-ink-dark">
        {t("places.claims.title")}
      </h2>
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-th-danger-fg">
          {state.error}
        </p>
      )}
      {pending && (
        <div className="mt-2">
          <p className="text-sm text-muted">{t("places.claims.pending")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={withdraw}
            className="mt-2 rounded-full px-3 py-1.5 text-xs font-semibold text-th-danger-fg disabled:opacity-50"
          >
            {t("places.claims.withdraw")}
          </button>
        </div>
      )}
      {lastRejected && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-th-danger-fg">
          {t("places.claims.rejected")} {lastRejected.review_note}
        </p>
      )}
      {!pending && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink dark:border-line-dark dark:text-ink-dark"
        >
          {t("places.claims.start")}
        </button>
      )}
      {!pending && open && (
        <ClaimForm
          placeId={place.id}
          onCancel={() => setOpen(false)}
          onSent={async () => {
            setOpen(false);
            toast.success(t("places.claims.sent"));
            await load();
          }}
        />
      )}
    </section>
  );
}

function ClaimForm({ placeId, onCancel, onSent }) {
  const { t } = useLanguage();
  const [businessName, setBusinessName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  function pick(event) {
    const picked = event.target.files?.[0] ?? null;
    if (picked && picked.size > MAX_BYTES) {
      setError(t("places.claims.tooBig"));
      setFile(null);
      return;
    }
    setError("");
    setFile(picked);
  }

  async function submit(event) {
    event.preventDefault();
    if (sending) return;
    if (!businessName.trim()) return setError(t("places.claims.nameRequired"));
    if (!file) return setError(t("places.claims.documentRequired"));
    setSending(true);
    setError("");
    try {
      await createClaim(placeId, {
        businessName: businessName.trim(),
        contactPhone: contactPhone.trim(),
        message: message.trim(),
        document: file,
      });
      await onSent();
    } catch (err) {
      setError(getErrorMessage(err, t));
      setSending(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 dark:border-line-dark";
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl border border-line p-3 dark:border-line-dark">
      <p className="text-xs text-muted">{t("places.claims.privacy")}</p>
      <label className="block text-sm text-ink dark:text-ink-dark">
        {t("places.claims.businessName")}
        <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={160} className={input} />
      </label>
      <label className="block text-sm text-ink dark:text-ink-dark">
        {t("places.claims.phone")}
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={40} inputMode="tel" className={input} />
      </label>
      <label className="block text-sm text-ink dark:text-ink-dark">
        {t("places.claims.message")}
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} rows={3} className={input} />
      </label>
      <label className="block text-sm text-ink dark:text-ink-dark">
        {t("places.claims.document")}
        <input type="file" accept={ACCEPT} onChange={pick} className="mt-1 block w-full text-sm" />
      </label>
      {error && (
        <p role="alert" className="text-sm text-th-danger-fg">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand hover:bg-th-brand-hover disabled:opacity-50"
        >
          {sending ? t("places.claims.sending") : t("places.claims.submit")}
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-sm font-semibold text-ink dark:text-ink-dark"
        >
          {t("places.claims.cancel")}
        </button>
      </div>
    </form>
  );
}
