import { useLanguage } from "@shared/i18n";
import { canAct } from "../lib/teroChat";

// Tarjeta de confirmación (ADR-041 §6): Tero PREPARÓ una acción, no la hizo. El texto
// (`summary`) lo redactó el servidor y se muestra tal cual; hasta que la persona
// pulsa «Confirmar» no ha pasado nada, y la tarjeta lo dice.
const FINAL = new Set(["confirmed", "cancelled", "expired", "unavailable", "failed"]);

export default function TeroActionCard({ card, state, onConfirm, onCancel }) {
  const { t } = useLanguage();
  const busy = state.status === "confirming" || state.status === "cancelling";
  const active = canAct(state, card);
  const finished = FINAL.has(state.status);

  const tone =
    state.status === "confirmed"
      ? "border-th-success-accent/50 bg-th-success-surface"
      : state.status === "failed"
        ? "border-th-danger-border bg-th-danger-surface"
        : "border-th-border bg-th-surface";

  return (
    <div className={`mt-2 rounded-2xl border p-3 ${tone}`} role="group" aria-label={t("tero.card.aria")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-th-fg-muted">
        {finished ? t(`tero.card.status.${state.status}`) : t("tero.card.notDoneYet")}
      </p>
      <p className="mt-1 text-sm font-medium text-th-fg-strong">{card.summary}</p>

      {!finished ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => onConfirm(card)}
            disabled={!active || busy}
            className="rounded-full bg-th-brand px-4 py-1.5 text-sm font-semibold text-th-on-brand transition hover:bg-th-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-th-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.status === "confirming" ? t("tero.card.confirming") : t("tero.card.confirm")}
          </button>
          <button
            type="button"
            onClick={() => onCancel(card)}
            disabled={!active || busy}
            className="rounded-full border border-th-border-strong px-4 py-1.5 text-sm font-semibold text-th-fg transition hover:bg-th-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-th-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.status === "cancelling" ? t("tero.card.cancelling") : t("tero.card.cancel")}
          </button>
        </div>
      ) : null}

      {state.note ? (
        <p className="mt-2 text-xs text-th-fg-muted" role="status">
          {t(`tero.card.notes.${state.note}`)}
        </p>
      ) : null}
    </div>
  );
}
