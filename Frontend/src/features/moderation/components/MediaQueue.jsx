import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import Spinner from "@shared/components/Spinner";
import { formatRelativeTime } from "@features/feed/lib/formatRelativeTime";
import ReelPlayer from "@features/videos/components/ReelPlayer";
import {
  CONTENT_KINDS,
  DECISIONS,
  MEDIA_TABS,
  isTwoFactorRequired,
  parentText,
  priorityText,
  reasonText,
  topScores,
} from "../lib/contentLabels";
import { moderationErrorMessage } from "../lib/reportLabels";

// Cola de contenido retenido (ADR-044 §2.6). La autorización es del servidor: un `reviewer` nunca
// recibe lo restringido (seguridad infantil / ilegal); esta pantalla no lo filtra, solo muestra lo
// que llega. La vista previa pide el archivo con la sesión (el público no puede abrirlo).

const PAGE_SIZE = 20;
const authHeaders = () => ({ Authorization: `Bearer ${getStoredToken()}` });

function Preview({ id, kind }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = null;
    let cancelled = false;
    const params = { type: kind };

    // Las historias en el almacenamiento PRIVADO se ven con una URL firmada de 5 minutos; el resto
    // (y las historias públicas) se piden como archivo con la sesión.
    async function load() {
      if (kind === "video") {
        // Un reel se ve por HLS con un token firmado de vida corta, que el servidor emite tras
        // comprobar el rol.
        const res = await api.get(`/moderation/media/${id}/preview-url`, { params, headers: authHeaders() });
        if (!cancelled) setSrc(res.data.url);
        return;
      }
      if (kind === "story") {
        try {
          const res = await api.get(`/moderation/media/${id}/preview-url`, { params, headers: authHeaders() });
          if (!cancelled) setSrc(res.data.url);
          return;
        } catch {
          /* no es privada: se pide como archivo */
        }
      }
      const res = await api.get(`/moderation/media/${id}/file`, {
        params,
        responseType: "blob",
        headers: authHeaders(),
      });
      if (cancelled) return;
      revoked = URL.createObjectURL(res.data);
      setSrc(revoked);
    }

    load().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [id, kind]);

  if (failed) {
    return (
      <p className="text-xs text-muted dark:text-muted-dark">Vista previa no disponible.</p>
    );
  }
  if (!src) return <div className="h-40 rounded-2xl bg-canvas dark:bg-canvas-dark animate-pulse" />;
  if (kind === "video") {
    return (
      <div className="max-w-xs">
        <ReelPlayer hlsUrl={src} caption="Reel retenido" onExpired={() => setFailed(true)} />
      </div>
    );
  }
  return <img src={src} alt="Imagen retenida" className="max-h-72 rounded-2xl border border-line dark:border-line-dark" />;
}

function ItemCard({ item, kind, busy, onDecide }) {
  const [note, setNote] = useState("");
  const scores = topScores(item.scores);
  return (
    <article
      className={`bg-surface dark:bg-surface-dark border rounded-[24px] shadow-soft p-5 space-y-3 ${
        item.priority === "critical" ? "border-ember-300 dark:border-ember-500/50" : "border-line dark:border-line-dark"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-ink dark:text-ink-dark">{parentText(item.parent_type)}</span>
        <span className="text-muted dark:text-muted-dark">de @{item.owner.username}</span>
        <span className="px-2 py-0.5 rounded-full border border-line dark:border-line-dark">
          Prioridad {priorityText(item.priority)}
        </span>
        {item.restricted && (
          <span className="px-2 py-0.5 rounded-full border border-ember-300 text-ember-700 dark:text-ember-300">
            Restringido
          </span>
        )}
        <span className="ml-auto text-muted dark:text-muted-dark">{formatRelativeTime(item.created_at)}</span>
      </header>

      <Preview id={item.id} kind={kind} />

      <p className="text-sm text-ink dark:text-ink-dark">
        <span className="text-muted dark:text-muted-dark">Motivo: </span>
        {reasonText(item.reason)}
      </p>
      {scores.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {scores.map((s) => (
            <li key={s.category} className="px-2 py-0.5 rounded-full bg-canvas dark:bg-canvas-dark border border-line dark:border-line-dark">
              {s.label} {s.percent}%
            </li>
          ))}
        </ul>
      )}

      <label className="block">
        <span className="sr-only">Nota de la decisión</span>
        <input
          type="text"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota (opcional, queda en la auditoría)"
          className="w-full text-sm rounded-xl border border-line dark:border-line-dark bg-canvas dark:bg-canvas-dark px-3 py-2"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {Object.entries(DECISIONS).map(([value, meta]) => (
          <button
            key={value}
            type="button"
            disabled={busy || item.status === value}
            onClick={() => onDecide(item, value, note)}
            className={`text-sm font-semibold px-4 py-2 rounded-full border transition disabled:opacity-50 ${
              meta.tone === "primary"
                ? "bg-pulse-600 border-pulse-600 text-white"
                : meta.tone === "danger"
                  ? "border-ember-500 text-ember-700 dark:text-ember-300"
                  : "border-line dark:border-line-dark text-ink dark:text-ink-dark"
            }`}
          >
            {meta.label}
          </button>
        ))}
      </div>
    </article>
  );
}

export default function MediaQueue({ onTwoFactorRequired }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [tab, setTab] = useState("held");
  const [kind, setKind] = useState("media");
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (offset = 0) => {
      try {
        const res = await api.get("/moderation/media", {
          params: { status: tab, type: kind, limit: PAGE_SIZE, offset },
          headers: authHeaders(),
        });
        setItems((current) => (offset ? [...current, ...res.data.items] : res.data.items));
        setHasMore(res.data.has_more);
      } catch (error) {
        if (isTwoFactorRequired(error)) onTwoFactorRequired?.();
        else toast.error(moderationErrorMessage(error, getErrorMessage(error, t)));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, kind],
  );

  useEffect(() => {
    setLoading(true);
    setItems([]);
    load(0);
  }, [load]);

  async function decide(item, decision, note) {
    setBusy(true);
    try {
      const body = { decision };
      if (note.trim()) body.note = note.trim();
      await api.post(`/moderation/media/${item.id}/decision`, body, {
        params: { type: kind },
        headers: authHeaders(),
      });
      toast.success(DECISIONS[decision].success);
      // Sale de la lista actual salvo que la decisión la deje en la misma pestaña.
      setItems((current) =>
        decision === tab ? current.map((i) => (i.id === item.id ? { ...i, status: decision } : i)) : current.filter((i) => i.id !== item.id),
      );
    } catch (error) {
      toast.error(moderationErrorMessage(error, getErrorMessage(error, t)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Tipo de contenido" className="flex gap-2">
        {CONTENT_KINDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={kind === entry.value}
            onClick={() => setKind(entry.value)}
            className={`text-xs font-semibold px-3 py-1 rounded-full border transition ${
              kind === entry.value
                ? "bg-ink dark:bg-ink-dark text-canvas dark:text-canvas-dark border-transparent"
                : "border-line dark:border-line-dark text-ink dark:text-ink-dark"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div role="tablist" aria-label="Estado del contenido" className="flex gap-2">
        {MEDIA_TABS.map((entry) => (
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
        <p className="text-center text-sm text-muted dark:text-muted-dark py-10">No hay contenido en esta lista.</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} kind={kind} busy={busy} onDecide={decide} />
          ))}
          {hasMore && (
            <div className="flex justify-center">
              <button type="button" onClick={() => load(items.length)} className="text-sm font-semibold px-5 py-2 rounded-full border border-line dark:border-line-dark">
                Cargar más
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
