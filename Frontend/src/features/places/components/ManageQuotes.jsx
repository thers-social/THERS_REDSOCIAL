import { useCallback, useEffect, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import {
  createQuoteItem,
  decideQuote,
  deleteQuoteItem,
  downloadQuotePdf,
  fetchManagedQuotes,
  fetchManageQuoteItems,
  updateQuoteItem,
} from "../lib/placesApi";

// El precio se escribe en dólares («12.50») y se convierte a CENTAVOS ENTEROS sin pasar por
// coma flotante; el servidor solo acepta enteros.
function toCents(text) {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
}

/**
 * Catálogo del cotizador y cotizaciones recibidas (ADR-040 fase 10), dentro del panel de quien
 * gestiona el lugar. Los precios nuevos solo afectan a cotizaciones futuras.
 */
export default function ManageQuotes({ placeId }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [state, setState] = useState({ status: "loading" });
  const [items, setItems] = useState([]);
  const [received, setReceived] = useState([]);
  const [form, setForm] = useState({ name: "", unit: "person", price: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (signal) =>
      Promise.all([fetchManageQuoteItems(placeId, signal), fetchManagedQuotes(placeId, signal)])
        .then(([catalog, quotes]) => {
          setItems(catalog);
          setReceived(quotes);
          setState({ status: "ready" });
        })
        .catch((error) => {
          if (!signal?.aborted) setState({ status: "error", error: getErrorMessage(error, t) });
        }),
    [placeId, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function run(action, successKey) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") return <Spinner className="mt-3" />;
  if (state.status === "error") {
    return (
      <p role="alert" className="mt-3 text-sm text-th-danger-fg">
        {state.error}
      </p>
    );
  }

  const input = "rounded-lg border border-line bg-transparent px-2 py-1 dark:border-line-dark";
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-ink dark:text-ink-dark">{t("places.quotes.manage.title")}</h3>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink dark:text-ink-dark">
            <span className={item.is_active ? "" : "text-muted line-through"}>
              {item.name} · {item.unit_price.currency} {item.unit_price.amount} / {t(`places.quotes.unit.${item.unit}`)}
            </span>
            <span className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() => updateQuoteItem(placeId, item.id, { is_active: !item.is_active }), "places.quotes.manage.updated")
                }
                className="text-xs font-semibold text-th-brand hover:underline disabled:opacity-50"
              >
                {item.is_active ? t("places.quotes.manage.deactivate") : t("places.quotes.manage.activate")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => deleteQuoteItem(placeId, item.id), "places.quotes.manage.deleted")}
                className="text-xs font-semibold text-th-danger-fg hover:underline disabled:opacity-50"
              >
                {t("places.quotes.manage.delete")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const cents = toCents(form.price);
          if (!form.name.trim() || cents === null) return toast.error(t("places.quotes.manage.invalid"));
          run(async () => {
            await createQuoteItem(placeId, { name: form.name.trim(), unit: form.unit, unit_price_cents: cents });
            setForm({ name: "", unit: "person", price: "" });
          }, "places.quotes.manage.created");
        }}
      >
        <input
          value={form.name}
          onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
          maxLength={120}
          placeholder={t("places.quotes.manage.name")}
          className={input}
        />
        <select value={form.unit} onChange={(e) => setForm((c) => ({ ...c, unit: e.target.value }))} className={input}>
          {["person", "unit", "hour"].map((unit) => (
            <option key={unit} value={unit}>
              {t(`places.quotes.unit.${unit}`)}
            </option>
          ))}
        </select>
        <input
          value={form.price}
          onChange={(e) => setForm((c) => ({ ...c, price: e.target.value }))}
          inputMode="decimal"
          placeholder="12.50"
          aria-label={t("places.quotes.manage.price")}
          className={`${input} w-24`}
        />
        <button type="submit" disabled={busy} className="rounded-full px-3 py-1.5 text-xs font-semibold text-th-brand disabled:opacity-50">
          {t("places.quotes.manage.add")}
        </button>
      </form>

      <h3 className="mt-4 text-sm font-semibold text-ink dark:text-ink-dark">{t("places.quotes.manage.received")}</h3>
      {received.length === 0 && <p className="mt-1 text-sm text-muted">{t("places.quotes.manage.none")}</p>}
      <ul className="mt-2 space-y-2">
        {received.map((quote) => (
          <li key={quote.id} className="rounded-xl border border-line p-3 text-sm dark:border-line-dark">
            <p className="font-semibold text-ink dark:text-ink-dark">
              {quote.user.name || quote.user.username} · {quote.total.currency} {quote.total.amount}
            </p>
            <p className="text-xs text-muted">{new Date(quote.created_at).toLocaleString()}</p>
            <p className="text-ink dark:text-ink-dark">
              {quote.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ")}
            </p>
            {quote.note && <p className="whitespace-pre-wrap break-words text-ink dark:text-ink-dark">{quote.note}</p>}
            <p className="mt-1 text-xs font-semibold text-muted">
              {t(`places.quotes.status.${quote.status}`)}
              {quote.status === "pending" && new Date(quote.valid_until) <= new Date()
                ? ` · ${t("places.quotes.manage.expired")}`
                : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {quote.status === "pending" && new Date(quote.valid_until) > new Date() && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => decideQuote(placeId, quote.id, "accepted"), "places.quotes.manage.accepted")}
                    className="text-xs font-semibold text-th-brand hover:underline disabled:opacity-50"
                  >
                    {t("places.quotes.manage.accept")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => decideQuote(placeId, quote.id, "rejected"), "places.quotes.manage.rejected")}
                    className="text-xs font-semibold text-th-danger-fg hover:underline disabled:opacity-50"
                  >
                    {t("places.quotes.manage.reject")}
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => downloadQuotePdf(quote.id), "places.quotes.pdf")}
                className="text-xs font-semibold text-th-brand hover:underline disabled:opacity-50"
              >
                {t("places.quotes.pdf")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
