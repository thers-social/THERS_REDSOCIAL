import { useEffect, useState } from "react";
import { api, getErrorMessage } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import Spinner from "@shared/components/Spinner";
import { hoursLabel, isTwoFactorRequired } from "../lib/contentLabels";
import { moderationErrorMessage } from "../lib/reportLabels";

// Estadísticas del panel (ADR-044 §2.6). Los conteos de un `reviewer` excluyen lo restringido: lo
// decide el servidor.

const authHeaders = () => ({ Authorization: `Bearer ${getStoredToken()}` });

function Tile({ label, value, hint }) {
  return (
    <div className="bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-[20px] p-4">
      <p className="text-xs text-muted dark:text-muted-dark">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-ink dark:text-ink-dark">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted dark:text-muted-dark">{hint}</p>}
    </div>
  );
}

export default function StatsPanel({ onTwoFactorRequired }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/moderation/stats", { headers: authHeaders() })
      .then((res) => !cancelled && setStats(res.data))
      .catch((error) => {
        if (cancelled) return;
        if (isTwoFactorRequired(error)) onTwoFactorRequired?.();
        else toast.error(moderationErrorMessage(error, getErrorMessage(error, t)));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!stats) return <div className="flex justify-center py-12"><Spinner /></div>;

  const jobs = stats.jobs_by_status || {};
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <Tile label="Retenidos" value={stats.by_status.held ?? 0} hint={`${stats.held_by_priority.critical ?? 0} críticos`} />
      <Tile label="Pendientes" value={stats.by_status.pending ?? 0} />
      <Tile label="Aprobados solos (7 d)" value={stats.last_7_days.auto_approved} />
      <Tile label="Retenidos solos (7 d)" value={stats.last_7_days.auto_held} />
      <Tile label="Decisiones humanas (7 d)" value={stats.last_7_days.human_decisions} />
      <Tile label="Tiempo medio de revisión" value={hoursLabel(stats.last_7_days.avg_hours_to_human_decision)} />
      <Tile label="Apelaciones abiertas" value={stats.appeals.open} hint={`${stats.appeals.overdue} fuera de plazo`} />
      <Tile label="Trabajos fallidos" value={jobs.failed ?? 0} />
      <Tile label="Trabajos muertos" value={jobs.dead ?? 0} />
    </div>
  );
}
