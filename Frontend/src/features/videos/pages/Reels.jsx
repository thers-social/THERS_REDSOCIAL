import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@features/auth";
import { setFollow } from "@features/feed/lib/socialApi";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import ReelSlide from "../components/ReelSlide";
import {
  deleteVideo,
  fetchFeed,
  fetchMine,
  fetchSaved,
  fetchVideo,
  reserveUpload,
  setLike,
  setSave,
  uploadToMux,
} from "../lib/videosApi";
import {
  POLL_INTERVAL_MS,
  isInProgress,
  isModuleOff,
  makeIdempotencyKey,
  mergeVideos,
  mostVisibleIndex,
  reelUrl,
  statusText,
  uploadErrorMessage,
  validateCaption,
  validateDuration,
  validateFile,
  withLike,
  withSaved,
} from "../lib/reelsLogic";

// Reels (ADR-043, ADR-043-A). Con el módulo apagado en el servidor (`VIDEOS_ENABLED`, por defecto) la
// API responde 404 y esta pantalla muestra «Próximamente», exactamente como antes. La subida pública
// sigue bloqueada por D3: solo las cuentas de la lista de prueba pueden subir; para el resto el
// servidor responde 404 a la reserva y el panel de subida se oculta. Nada de esto concede permisos:
// el servidor lo comprueba siempre.

function ComingSoon() {
  return (
    <div className="mx-auto flex max-w-th-feed flex-col gap-2 py-8">
      <h1 className="text-headline-lg text-th-fg-strong">Reels</h1>
      <p className="text-body-md text-th-fg-muted">Reels, el video vertical de THERS, llegará pronto.</p>
    </div>
  );
}

function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(probe.duration);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(NaN);
    };
    probe.src = url;
  });
}

function UploadPanel({ onChanged }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const busy = progress !== null;

  async function submit(event) {
    event.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    const problem = validateFile(file) || validateCaption(caption) || validateDuration(await readDuration(file));
    if (problem) {
      setError(problem);
      return;
    }
    setProgress(0);
    try {
      const video = await reserveUpload({ caption, idempotencyKey: makeIdempotencyKey() });
      await uploadToMux(video.upload_url, file, setProgress);
      toast.success("Video subido. Lo estamos procesando.");
      setCaption("");
      if (fileRef.current) fileRef.current.value = "";
      onChanged();
    } catch (failure) {
      if (failure?.response?.status === 404) setUnavailable(true);
      setError(failure?.message === "upload_failed" ? "La subida falló. Inténtalo de nuevo." : uploadErrorMessage(failure));
    } finally {
      setProgress(null);
    }
  }

  if (unavailable) return null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-th-card border border-th-border bg-th-surface p-4 shadow-th-card">
      <h2 className="text-title-md font-bold text-th-fg-strong">Subir un Reel</h2>
      <input ref={fileRef} type="file" accept="video/*" disabled={busy} aria-label="Video" />
      <input
        type="text"
        value={caption}
        maxLength={200}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Texto (opcional)"
        aria-label="Texto del Reel"
        disabled={busy}
        className="rounded-th-card border border-th-border bg-th-surface-subtle px-3 py-2 text-body-md"
      />
      {busy && (
        <progress value={progress} max={1} aria-label="Progreso de la subida" className="w-full" />
      )}
      {error && <p role="alert" className="text-body-sm text-th-danger-fg">{error}</p>}
      <p className="text-body-sm text-th-fg-muted">Hasta 60 segundos y 100 MB. Se publica cuando lo aprueba el equipo.</p>
      <button type="submit" disabled={busy} className="w-fit rounded-th-pill bg-th-brand px-5 py-2 text-label-lg font-bold text-th-on-brand disabled:opacity-50">
        {busy ? "Subiendo…" : "Subir"}
      </button>
    </form>
  );
}

function MyVideos({ videos, onDelete }) {
  if (videos.length === 0) return null;
  return (
    <section aria-labelledby="mine-title" className="flex flex-col gap-2">
      <h2 id="mine-title" className="text-title-md font-bold text-th-fg-strong">Mis Reels</h2>
      <ul className="flex flex-col gap-2">
        {videos.map((video) => (
          <li key={video.id} className="flex items-center gap-3 rounded-th-card border border-th-border px-4 py-3 text-body-md">
            <span className="flex-1">
              <span className="font-semibold">{video.caption || "Sin texto"}</span>
              <span className="block text-body-sm text-th-fg-muted">{statusText(video)}</span>
            </span>
            <button type="button" onClick={() => onDelete(video)} className="text-label-md text-th-danger-fg">
              Borrar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}


function ReelDialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-th-dialog bg-th-surface p-5 text-th-fg shadow-th-overlay"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-title-md font-bold text-th-fg-strong">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-th-surface-subtle"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Altura del escenario: el alto de la ventana menos la barra superior, la navegación inferior (solo en
// móvil), los márgenes del contenido y la fila de pestañas. Un Reel ocupa SIEMPRE todo el escenario.
const STAGE =
  "h-[calc(100dvh_-_var(--th-topbar-h)_-_var(--th-bottomnav-h)_-_env(safe-area-inset-bottom)_-_100px)] lg:h-[calc(100dvh_-_var(--th-topbar-h)_-_100px)]";

const TABS = [
  { id: "foryou", label: "Para ti" },
  { id: "saved", label: "Guardados" },
];

export default function Reels() {
  const toast = useToast();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const sharedId = params.get("v");
  const [tab, setTab] = useState("foryou");
  const [feed, setFeed] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [mine, setMine] = useState([]);
  const [state, setState] = useState("loading"); // loading | ready | off | error
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const scrollerRef = useRef(null);
  const loadingMore = useRef(false);
  const refreshedAt = useRef(new Map());

  const loadMine = useCallback(async () => {
    try {
      setMine(await fetchMine());
    } catch {
      /* la lista propia es secundaria */
    }
  }, []);

  const loadFeed = useCallback(async (offset = 0, which = "foryou") => {
    try {
      const data = which === "saved" ? await fetchSaved({ limit: 10, offset }) : await fetchFeed({ limit: 10, offset });
      setFeed((current) => (offset ? mergeVideos(current, data.videos) : data.videos));
      setHasMore(data.has_more);
      setState("ready");
    } catch (error) {
      if (!offset) setState(isModuleOff(error) ? "off" : "error");
    } finally {
      loadingMore.current = false;
    }
  }, []);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  // Cambia de pestaña (o primera carga): vuelve al primer Reel. Un enlace `?v=<id>` abre ese Reel primero.
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setActive(0);
    (async () => {
      await loadFeed(0, tab);
      if (cancelled || tab !== "foryou" || !sharedId) return;
      try {
        const shared = await fetchVideo(sharedId);
        if (!cancelled) setFeed((current) => [shared, ...current.filter((v) => v.id !== shared.id)]);
      } catch {
        /* enlace de un Reel que ya no existe: se ignora */
      }
      if (!cancelled) setParams({}, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
    // `sharedId` solo se lee en la carga de la pestaña; cambiarlo no debe recargar el feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loadFeed]);

  // Mientras algo propio se sube o procesa, se consulta su estado; se detiene al terminar.
  useEffect(() => {
    if (!mine.some(isInProgress)) return undefined;
    const timer = setInterval(loadMine, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [mine, loadMine]);

  // Qué Reel ocupa la pantalla: el que se ve al 60 % o más.
  useEffect(() => {
    const root = scrollerRef.current;
    if (state !== "ready" || !root) return undefined;
    const ratios = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(Number(entry.target.dataset.index), entry.intersectionRatio);
        const index = mostVisibleIndex([...ratios].map(([i, ratio]) => ({ index: i, ratio })));
        if (index >= 0) setActive(index);
      },
      { root, threshold: [0, 0.25, 0.6, 0.9, 1] },
    );
    root.querySelectorAll("[data-index]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [state, feed.length, tab]);

  // Al acercarse al final se pide la página siguiente.
  useEffect(() => {
    if (state !== "ready" || !hasMore || loadingMore.current || active < feed.length - 3) return;
    loadingMore.current = true;
    loadFeed(feed.length, tab);
  }, [active, feed.length, hasMore, state, tab, loadFeed]);

  const goTo = useCallback((index) => {
    scrollerRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Flechas arriba/abajo: pasan de Reel (las demás teclas son del Reel activo).
  useEffect(() => {
    if (state !== "ready") return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
      if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        goTo(Math.min(active + 1, feed.length - 1));
      } else if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        goTo(Math.max(active - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, active, feed.length, goTo]);

  const patchVideo = useCallback((id, change) => {
    setFeed((current) => current.map((v) => (v.id === id ? change(v) : v)));
  }, []);

  async function handleLike(video) {
    const next = !video.liked_by_me;
    patchVideo(video.id, (v) => withLike(v, next));
    try {
      const result = await setLike(video.id, next);
      patchVideo(video.id, (v) => ({ ...v, liked_by_me: result.liked, likes_count: result.likes_count }));
    } catch {
      patchVideo(video.id, (v) => withLike(v, !next));
      toast.error("No se pudo actualizar tu me gusta");
    }
  }

  async function handleSave(video) {
    const next = !video.saved_by_me;
    patchVideo(video.id, (v) => withSaved(v, next));
    try {
      await setSave(video.id, next);
      toast.success(next ? "Reel guardado" : "Quitado de guardados");
    } catch {
      patchVideo(video.id, (v) => withSaved(v, !next));
      toast.error("No se pudo guardar el Reel");
    }
  }

  async function handleShare(video) {
    const url = reelUrl(window.location.origin, video.id);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Reel de @${video.author.username}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Enlace copiado");
      }
    } catch (failure) {
      if (failure?.name !== "AbortError") toast.error("No se pudo compartir el Reel");
    }
  }

  async function handleFollow(author) {
    try {
      const result = await setFollow(author.id, true);
      const pending = result.follow_status === "pending";
      setFeed((current) =>
        current.map((v) =>
          v.author.id === author.id ? { ...v, author: { ...v.author, is_following: !pending, follow_pending: pending } } : v,
        ),
      );
    } catch {
      toast.error("No se pudo seguir a esta persona");
    }
  }

  function handleCommentsCount(id, delta) {
    patchVideo(id, (v) => ({ ...v, comments_count: Math.max(0, (v.comments_count || 0) + delta) }));
  }

  // El token de reproducción caducó: se pide el Reel de nuevo (como mucho una vez por minuto cada uno).
  async function handleExpired(id) {
    const last = refreshedAt.current.get(id) || 0;
    if (Date.now() - last < 60_000) return;
    refreshedAt.current.set(id, Date.now());
    try {
      const fresh = await fetchVideo(id);
      patchVideo(id, () => fresh);
    } catch {
      /* se queda el aviso «No se pudo reproducir» */
    }
  }

  async function remove(video) {
    try {
      await deleteVideo(video.id);
      setMine((current) => current.filter((v) => v.id !== video.id));
      setFeed((current) => current.filter((v) => v.id !== video.id));
      toast.success("Reel borrado");
    } catch {
      toast.error("No se pudo borrar el Reel");
    }
  }

  if (state === "loading") {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }
  if (state === "off") return <ComingSoon />;
  if (state === "error") {
    return <p role="alert" className="py-12 text-center text-body-md text-th-fg-muted">No se pudieron cargar los Reels.</p>;
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-2">
      <header className="flex h-11 items-center justify-between gap-2">
        <h1 className="text-headline-sm font-bold text-th-fg-strong">Reels</h1>
        <div role="tablist" aria-label="Reels" className="flex gap-1 rounded-th-pill bg-th-surface-subtle p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-th-pill px-3 py-1 text-label-md font-bold ${
                tab === item.id ? "bg-th-brand text-th-on-brand" : "text-th-fg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1 rounded-th-pill border border-th-border px-3 py-1.5 text-label-md font-bold"
        >
          <Icon name="add" size={18} />
          Subir
        </button>
      </header>

      <div className="relative">
        <div
          ref={scrollerRef}
          className={`${STAGE} snap-y snap-mandatory overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
        >
          {feed.length === 0 ? (
            <p className="grid h-full place-items-center px-6 text-center text-body-md text-th-fg-muted">
              {tab === "saved" ? "Todavía no guardaste ningún Reel." : "Todavía no hay Reels para mostrar."}
            </p>
          ) : (
            feed.map((video, index) => (
              <div key={video.id} data-index={index} className="h-full snap-start snap-always">
                <ReelSlide
                  video={video}
                  active={index === active}
                  near={Math.abs(index - active) <= 1}
                  muted={muted}
                  currentUserId={user?.id}
                  onMutedChange={setMuted}
                  onLike={handleLike}
                  onSave={handleSave}
                  onShare={handleShare}
                  onFollow={handleFollow}
                  onCommentsCountChange={handleCommentsCount}
                  onExpired={handleExpired}
                />
              </div>
            ))
          )}
        </div>

        {feed.length > 1 && (
          <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 flex-col gap-3 xl:flex">
            <button
              type="button"
              onClick={() => goTo(active - 1)}
              disabled={active === 0}
              aria-label="Reel anterior"
              className="grid h-11 w-11 place-items-center rounded-full bg-th-surface-subtle disabled:opacity-30"
            >
              <Icon name="keyboard_arrow_up" size={26} />
            </button>
            <button
              type="button"
              onClick={() => goTo(active + 1)}
              disabled={active >= feed.length - 1}
              aria-label="Reel siguiente"
              className="grid h-11 w-11 place-items-center rounded-full bg-th-surface-subtle disabled:opacity-30"
            >
              <Icon name="keyboard_arrow_down" size={26} />
            </button>
          </div>
        )}
      </div>

      {uploadOpen && (
        <ReelDialog title="Tus Reels" onClose={() => setUploadOpen(false)}>
          <UploadPanel onChanged={loadMine} />
          <MyVideos videos={mine} onDelete={remove} />
        </ReelDialog>
      )}
    </div>
  );
}
