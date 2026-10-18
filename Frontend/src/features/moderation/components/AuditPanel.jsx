import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import Spinner from "@shared/components/Spinner";
import { formatRelativeTime } from "@features/feed/lib/formatRelativeTime";
import { moderationErrorMessage } from "../lib/reportLabels";

// Auditoría y trabajos fallidos (ADR-044 §2.4). Solo el rol `admin`: el servidor responde 404 al
// resto, así que esta sección ni siquiera se ofrece a quien no lo es.

const authHeaders = () => ({ Authorization: `Bearer ${getStoredToken()}` });

export default function AuditPanel() {
  const toast = useToast();
  const { t } = useLanguage();
  const [audit, setAudit] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, j] = await Promise.all([
        api.get("/moderation/audit", { params: { limit: 30 }, headers: authHeaders() }),
        api.get("/moderation/jobs", { headers: authHeaders() }),
      ]);
      setAudit(a.data.items);
      setJobs(j.data.items);
    } catch (error) {
      toast.error(moderationErrorMessage(error, getErrorMessage(error, t)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function retry(job) {
    setBusy(true);
    try {
      await api.post(`/moderation/jobs/${job.id}/retry`, {}, { headers: authHeaders() });
      toast.success("Trabajo devuelto a la cola");
      await load();
    } catch (error) {
      toast.error(moderationErrorMessage(error, getErrorMessage(error, t)));
    } finally {
      setBusy(false);
    }
  }

  if (!audit || !jobs) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div className="space-y-8">
      <section aria-labelledby="jobs-title" className="space-y-3">
        <h2 id="jobs-title" className="text-lg font-bold text-ink dark:text-ink-dark">Trabajos fallidos</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted dark:text-muted-dark">No hay trabajos fallidos.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-2 text-sm bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl px-4 py-3">
                <span className="font-semibold">{job.status === "dead" ? "Muerto" : "Fallido"}</span>
                <span className="text-muted dark:text-muted-dark">{job.attempts} intentos · {job.last_error || "sin detalle"}</span>
                <button type="button" disabled={busy} onClick={() => retry(job)} className="ml-auto text-xs font-semibold px-3 py-1 rounded-full border border-line dark:border-line-dark disabled:opacity-50">
                  Reintentar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="audit-title" className="space-y-3">
        <h2 id="audit-title" className="text-lg font-bold text-ink dark:text-ink-dark">Decisiones recientes</h2>
        <ul className="space-y-2">
          {audit.map((row) => (
            <li key={row.id} className="text-sm bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-2xl px-4 py-3">
              <span className="font-semibold">{row.actor_kind === "system" ? "Sistema" : `@${row.actor || "—"}`}</span>{" "}
              <span className="text-muted dark:text-muted-dark">{row.action.replace("moderation_", "").replaceAll("_", " ")}</span>
              {row.changes?.to && <span> → {row.changes.to}</span>}
              <span className="float-right text-xs text-muted dark:text-muted-dark">{formatRelativeTime(row.at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
