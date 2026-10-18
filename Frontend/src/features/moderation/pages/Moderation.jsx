import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "@shared/lib/api";
import { getStoredToken, useAuth } from "@features/auth";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import Spinner from "@shared/components/Spinner";
import NotFound from "@shared/seo/NotFound";
import ReportCard from "../components/ReportCard";
import ResolveDialog from "../components/ResolveDialog";
import MediaQueue from "../components/MediaQueue";
import AppealsQueue from "../components/AppealsQueue";
import StatsPanel from "../components/StatsPanel";
import AuditPanel from "../components/AuditPanel";
import { SECTIONS, canSeeSection, isTwoFactorRequired } from "../lib/contentLabels";
import { ACTIONS, STATUS_TABS, moderationErrorMessage } from "../lib/reportLabels";

// Página de moderación (ADR-032-content-reports-and-moderation.md §3, fase 3).
//
// Está OCULTA a propósito: no hay ningún enlace a ella y quien no es moderador ve la misma
// página que una URL inexistente. Eso es solo comodidad. La seguridad real está en el
// servidor: las rutas `/api/moderation/*` responden 404 a quien no tiene `is_moderator`,
// así que abrir esta URL con un token que no lo es no concede nada.

const PAGE_SIZE = 20;

function authHeaders() {
  return { Authorization: `Bearer ${getStoredToken()}` };
}

function ModerationQueue({ currentUserId }) {
  const toast = useToast();
  const { t } = useLanguage();

  const [status, setStatus] = useState("open");
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [denied, setDenied] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await api.get("/moderation/reports", {
          params: { status, limit: PAGE_SIZE },
          headers: authHeaders(),
        });
        if (cancelled) return;
        setItems(res.data.reports);
        setHasMore(res.data.has_more);
        setDenied(false);
      } catch (error) {
        if (cancelled) return;
        // 404: el servidor dice que esta cuenta ya no es moderadora (por ejemplo, se le
        // retiró el rol con la sesión abierta).
        if (error.response?.status === 404) setDenied(true);
        else if (isTwoFactorRequired(error)) toast.error("Activa la verificación en dos pasos para moderar");
        else toast.error(getErrorMessage(error, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // `toast` y `t` cambian de identidad entre renders y no deben repetir la consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function changeStatus(next) {
    if (next === status) return;
    setLoading(true);
    setItems([]);
    setStatus(next);
  }

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await api.get("/moderation/reports", {
        params: { status, limit: PAGE_SIZE, offset: items.length },
        headers: authHeaders(),
      });
      setItems((current) => [...current, ...res.data.reports]);
      setHasMore(res.data.has_more);
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, items.length]);

  async function confirm({ note, reason }) {
    const { report, action } = dialog;
    setBusy(true);
    try {
      const body = { action };
      if (note) body.note = note;
      if (reason) body.reason = reason;
      await api.post(`/moderation/reports/${report.id}/resolve`, body, { headers: authHeaders() });
      toast.success(ACTIONS[action].success);
      // En la pestaña de abiertos el reporte sale de la cola; el servidor también lo cierra.
      setItems((current) => current.filter((r) => r.id !== report.id));
      setDialog(null);
    } catch (error) {
      toast.error(moderationErrorMessage(error, getErrorMessage(error, t)));
      // 409: otra persona del equipo ya lo resolvió; se quita de la lista para no insistir.
      if (error.response?.status === 409) {
        setItems((current) => current.filter((r) => r.id !== report.id));
        setDialog(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <NotFound />;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-ink-dark">Moderación</h1>
        <p className="mt-1 text-sm text-muted dark:text-muted-dark">
          Lo crítico aparece primero y, dentro de cada prioridad, lo más antiguo. Nunca verás quién reportó.
        </p>
      </div>

      <div role="tablist" aria-label="Estado de los reportes" className="flex gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => changeStatus(tab.value)}
            className={`text-sm font-semibold px-4 py-2 rounded-full border transition ${
              status === tab.value
                ? "bg-pulse-600 border-pulse-600 text-white"
                : "border-line dark:border-line-dark text-ink dark:text-ink-dark hover:bg-canvas dark:hover:bg-canvas-dark"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-[24px] shadow-soft p-8 text-center">
          <p className="font-semibold text-ink dark:text-ink-dark">
            {status === "open" ? "No hay reportes abiertos" : "No hay reportes en esta lista"}
          </p>
          <p className="mt-1 text-sm text-muted dark:text-muted-dark">
            {status === "open" ? "Cuando alguien reporte algo, aparecerá aquí." : "Aún no hay nada que mostrar."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              currentUserId={currentUserId}
              onAction={(r, action) => setDialog({ report: r, action })}
            />
          ))}
          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={loadMore}
                className="text-sm font-semibold px-5 py-2 rounded-full border border-line dark:border-line-dark text-ink dark:text-ink-dark hover:bg-canvas dark:hover:bg-canvas-dark transition disabled:opacity-50"
              >
                {loadingMore ? "Cargando…" : "Cargar más"}
              </button>
            </div>
          )}
        </div>
      )}

      <ResolveDialog
        open={!!dialog}
        report={dialog?.report}
        action={dialog?.action}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => !busy && setDialog(null)}
      />
    </div>
  );
}

// Secciones del panel (ADR-044 §2.6). Es UN solo panel: Reportes es el de siempre. Ocultar una
// sección a quien no tiene el rol es comodidad; cada ruta del servidor lo vuelve a comprobar.
function ModerationShell({ user }) {
  const [section, setSection] = useState("reports");
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const visible = SECTIONS.filter((entry) => canSeeSection(entry, user));

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Secciones de moderación" className="max-w-2xl mx-auto flex flex-wrap gap-2">
        {visible.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={section === entry.value}
            onClick={() => setSection(entry.value)}
            className={`text-sm font-semibold px-4 py-2 rounded-full border transition ${
              section === entry.value
                ? "bg-ink dark:bg-ink-dark text-canvas dark:text-canvas-dark border-transparent"
                : "border-line dark:border-line-dark text-ink dark:text-ink-dark"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {needsTwoFactor && (
        <p role="alert" className="max-w-2xl mx-auto text-sm rounded-2xl border border-ember-300 text-ember-700 dark:text-ember-300 px-4 py-3">
          Para moderar necesitas activar la verificación en dos pasos en Configuración › Seguridad.
        </p>
      )}

      {section === "reports" && <ModerationQueue currentUserId={user.id} />}
      {section !== "reports" && (
        <div className="max-w-2xl mx-auto">
          {section === "media" && <MediaQueue onTwoFactorRequired={() => setNeedsTwoFactor(true)} />}
          {section === "appeals" && <AppealsQueue onTwoFactorRequired={() => setNeedsTwoFactor(true)} />}
          {section === "stats" && <StatsPanel onTwoFactorRequired={() => setNeedsTwoFactor(true)} />}
          {section === "audit" && <AuditPanel />}
        </div>
      )}
    </div>
  );
}

export default function Moderation() {
  const { user } = useAuth();
  // Comodidad, no seguridad (ver el comentario de arriba).
  if (!user?.is_moderator) return <NotFound />;
  return <ModerationShell user={user} />;
}
