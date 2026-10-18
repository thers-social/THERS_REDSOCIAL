import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import ReelPlayer from "../components/ReelPlayer";
import { deleteVideo, fetchFeed, fetchMine, reserveUpload, uploadToMux } from "../lib/videosApi";
import {
  POLL_INTERVAL_MS,
  canPlay,
  isInProgress,
  isModuleOff,
  makeIdempotencyKey,
  mergeVideos,
  statusText,
  uploadErrorMessage,
  validateCaption,
  validateDuration,
  validateFile,
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
      {error && <p role="alert" className="text-body-sm text-th-danger">{error}</p>}
      <p className="text-body-sm text-th-fg-muted">Hasta 60 segundos y 100 MB. Se publica cuando lo aprueba el equipo.</p>
      <button type="submit" disabled={busy} className="w-fit rounded-th-pill bg-th-primary px-5 py-2 text-label-lg font-bold text-white disabled:opacity-50">
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
            <button type="button" onClick={() => onDelete(video)} className="text-label-md text-th-danger">
              Borrar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Reels() {
  const toast = useToast();
  const [feed, setFeed] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [mine, setMine] = useState([]);
  const [state, setState] = useState("loading"); // loading | ready | off | error

  const loadMine = useCallback(async () => {
    try {
      setMine(await fetchMine());
    } catch {
      /* la lista propia es secundaria */
    }
  }, []);

  const loadFeed = useCallback(async (offset = 0) => {
    try {
      const data = await fetchFeed({ limit: 10, offset });
      setFeed((current) => (offset ? mergeVideos(current, data.videos) : data.videos));
      setHasMore(data.has_more);
      setState("ready");
    } catch (error) {
      setState(isModuleOff(error) ? "off" : "error");
    }
  }, []);

  useEffect(() => {
    loadFeed();
    loadMine();
  }, [loadFeed, loadMine]);

  // Mientras algo propio se sube o procesa, se consulta su estado; se detiene al terminar.
  useEffect(() => {
    if (!mine.some(isInProgress)) return undefined;
    const timer = setInterval(loadMine, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [mine, loadMine]);

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
    <div className="mx-auto flex max-w-th-feed flex-col gap-6 py-6">
      <h1 className="text-headline-lg text-th-fg-strong">Reels</h1>
      <UploadPanel onChanged={loadMine} />
      <MyVideos videos={mine} onDelete={remove} />

      {feed.length === 0 ? (
        <p className="py-8 text-center text-body-md text-th-fg-muted">Todavía no hay Reels para mostrar.</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {feed.map((video) => (
            <li key={video.id} className="flex flex-col gap-2">
              <p className="text-label-lg font-bold text-th-fg-strong">@{video.author.username}</p>
              {canPlay(video) ? (
                <ReelPlayer
                  hlsUrl={video.playback.hls_url}
                  caption={video.caption}
                  width={video.width}
                  height={video.height}
                  onExpired={() => loadFeed()}
                />
              ) : (
                <p className="text-body-sm text-th-fg-muted">No disponible.</p>
              )}
              {video.caption && <p className="text-body-md text-th-fg-strong">{video.caption}</p>}
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <button type="button" onClick={() => loadFeed(feed.length)} className="mx-auto rounded-th-pill border border-th-border px-5 py-2 text-label-lg">
          Cargar más
        </button>
      )}
    </div>
  );
}
