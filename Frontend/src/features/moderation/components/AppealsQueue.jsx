import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import Spinner from "@shared/components/Spinner";
import { formatRelativeTime } from "@features/feed/lib/formatRelativeTime";
import { APPEAL_TABS, OUTCOMES, isTwoFactorRequired } from "../lib/contentLabels";
import { moderationErrorMessage } from "../lib/reportLabels";

// Apelaciones (ADR-044 §2.7). Las revisa una persona distinta a quien decidió: si esta cuenta
// tomó la decisión original, el servidor responde 403 con el motivo y aquí se muestra tal cual.

const authHeaders = () => ({ Authorization: `Bearer ${getStoredToken()}` });

function AppealCard({ appeal, busy, onResolve }) {
  const [note, setNote] = useState("");
  const open = appeal.status === "open";
  return (
    <article
      className={`bg-surface dark:bg-surface-dark border rounded-[24px] shadow-soft p-5 space-y-3 ${
        appeal.overdue ? "border-ember-300 dark:border-ember-500/50" : "border-line dark:border-line-dark"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-ink dark:text-ink-dark">@{appeal.appellant}</span>
        {appeal.overdue && (
          <span className="px-2 py-0.5 rounded-full border border-ember-300 text-ember-700 dark:text-ember-300">
            Fuera del plazo de 72 h
          </span>
        )}
        <span className="ml-auto text-muted dark:text-muted-dark">{formatRelativeTime(appeal.created_at)}</span>
      </header>
      <p className="text-sm text-ink dark:text-ink-dark whitespace-pre-wrap">{appeal.reason}</p>
      {!open && appeal.resolution_note && (
        <p className="text-xs text-muted dark:text-muted-dark">Resolución: {appeal.resolution_note}</p>
      )}
      {open && (
        <>
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota para la persona (opcional)"
            aria-label="Nota de la resolución"
            className="w-full text-sm rounded-xl border border-line dark:border-line-dark bg-canvas dark:bg-canvas-dark px-3 py-2"
          />
          <div className="flex flex-wrap gap-2">
            {Object.entries(OUTCOMES).map(([value, meta]) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                onClick={() => onResolve(appeal, value, note)}
                className={`text-sm font-semibold px-4 py-2 rounded-full border transition disabled:opacity-50 ${
                  value === "overturned"
                    ? "bg-pulse-600 border-pulse-600 text-white"
                    : "border-line dark:border-line-dark text-ink dark:text-ink-dark"
                }`}
              >
                {meta.label}
              </button>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

export default function AppealsQueue({ onTwoFactorRequired }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [tab, setTab] = useState("open");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/moderation/appeals", {
        params: { status: tab, limit: 50 },
        headers: authHeaders(),
      });
      setItems(res.data.items);
    } catch (error) {
      if (isTwoFactorRequired(error)) onTwoFactorRequired?.();
      else toast.error(moderationErrorMessage(error, getErrorMessage(error, t)));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    load();
  }, [load]);

  async function resolve(appeal, outcome, note) {
    setBusy(true);
    try {
      const body = { outcome };
      if (note.trim()) body.note = note.trim();
      await api.post(`/moderation/appeals/${appeal.id}/resolve`, body, { headers: authHeaders() });
      toast.success(OUTCOMES[outcome].success);
      setItems((current) => current.filter((a) => a.id !== appeal.id));
    } catch (error) {
      toast.error(moderationErrorMessage(error, getErrorMessage(error, t)));
      // 409: ya la resolvió otra persona.
      if (error.response?.status === 409) setItems((current) => current.filter((a) => a.id !== appeal.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Estado de las apelaciones" className="flex gap-2">
        {APPEAL_TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={tab === entry.value}
            onClick={() => setTab(entry.value)}
            className={`text-sm font-semibold px-4 py-2 rounded-full border transition ${
              tab === entry.value
                ? "bg-pulse-600 border-pulse-600 text-white"
                : "border-line dark:border-line-dark text-ink dark:text-ink-dark"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-muted dark:text-muted-dark py-10">No hay apelaciones en esta lista.</p>
      ) : (
        <div className="space-y-4">
          {items.map((appeal) => (
            <AppealCard key={appeal.id} appeal={appeal} busy={busy} onResolve={resolve} />
          ))}
        </div>
      )}
    </div>
  );
}
