import { useCallback, useEffect, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { useAuth } from "@features/auth/context/AuthContext";
import { createQuote, downloadQuotePdf, fetchQuoteItems } from "../lib/placesApi";

const MAX_QUANTITY = 10000;

/**
 * Cotizar en un lugar (ADR-040 fase 10). La persona elige cuántos de cada artículo del catálogo
 * del negocio; el TOTAL lo calcula el servidor y es el que se muestra. El cliente nunca suma
 * precios para decidir nada: el subtotal en pantalla es solo una vista previa.
 */
export default function PlaceQuote({ placeId }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const [state, setState] = useState({ status: "loading", items: [] });
  const [quantities, setQuantities] = useState({});
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(
    (signal) =>
      fetchQuoteItems(placeId, signal)
        .then((items) => setState({ status: "ready", items }))
        .catch((error) => {
          if (!signal?.aborted) setState({ status: "error", items: [], error: getErrorMessage(error, t) });
        }),
    [placeId, t]
  );

  useEffect(() => {
    if (!user) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [user, load]);

  if (!user) return null;
  if (state.status === "loading") return <Spinner className="mt-4" />;
  if (state.status === "error") return null;
  // Sin lista de precios la sección sigue visible y lo explica (ADR-051): antes se ocultaba y parecía
  // que la función no existía.
  if (state.items.length === 0) {
    return (
      <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-quotes-title">
        <h2 id="place-quotes-title" className="text-base font-semibold text-ink dark:text-ink-dark">
          {t("places.quotes.title")}
        </h2>
        <p className="mt-2 text-sm text-muted dark:text-muted-dark">{t("places.quotes.empty")}</p>
      </section>
    );
  }

  const chosen = Object.entries(quantities).filter(([, quantity]) => quantity > 0);

  async function submit(event) {
    event.preventDefault();
    if (sending || chosen.length === 0) return;
    setSending(true);
    try {
      const quote = await createQuote(placeId, {
        lines: chosen.map(([itemId, quantity]) => ({ item_id: itemId, quantity })),
        note: note.trim(),
      });
      setResult(quote);
      setQuantities({});
      setNote("");
      toast.success(t("places.quotes.done"));
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-quote-title">
      <h2 id="place-quote-title" className="text-base font-semibold text-ink dark:text-ink-dark">
        {t("places.quotes.title")}
      </h2>
      <form onSubmit={submit} className="mt-3 space-y-2">
        {state.items.map((item) => (
          <label key={item.id} className="flex items-center justify-between gap-3 text-sm text-ink dark:text-ink-dark">
            <span className="min-w-0">
              <span className="font-semibold">{item.name}</span>
              <span className="ml-2 text-xs text-muted">
                {item.unit_price.currency} {item.unit_price.amount} / {t(`places.quotes.unit.${item.unit}`)}
              </span>
              {item.description && <span className="block text-xs text-muted">{item.description}</span>}
            </span>
            <input
              type="number"
              min={0}
              max={MAX_QUANTITY}
              value={quantities[item.id] ?? 0}
              onChange={(e) => setQuantities((c) => ({ ...c, [item.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              aria-label={item.name}
              className="w-20 rounded-lg border border-line bg-transparent px-2 py-1 dark:border-line-dark"
            />
          </label>
        ))}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={t("places.quotes.note")}
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm dark:border-line-dark"
        />
        <button
          type="submit"
          disabled={sending || chosen.length === 0}
          className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand disabled:opacity-50"
        >
          {sending ? t("places.quotes.sending") : t("places.quotes.request")}
        </button>
      </form>
      {result && (
        <div className="mt-3 rounded-xl border border-line p-3 text-sm dark:border-line-dark" role="status">
          <ul>
            {result.lines.map((line, index) => (
              <li key={index} className="flex justify-between gap-2 text-ink dark:text-ink-dark">
                <span>
                  {line.quantity} × {line.name}
                </span>
                <span>{line.line_total.amount}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between font-semibold text-ink dark:text-ink-dark">
            <span>{t("places.quotes.total")}</span>
            <span>
              {result.total.currency} {result.total.amount}
            </span>
          </p>
          <p className="text-xs text-muted">
            {t("places.quotes.validUntil", { date: new Date(result.valid_until).toLocaleDateString() })}
          </p>
          <button
            type="button"
            onClick={() =>
              downloadQuotePdf(result.id).catch((error) => toast.error(getErrorMessage(error, t)))
            }
            className="mt-2 text-xs font-semibold text-th-brand hover:underline"
          >
            {t("places.quotes.pdf")}
          </button>
        </div>
      )}
    </section>
  );
}
