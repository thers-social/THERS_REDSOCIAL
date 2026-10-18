import { useEffect, useRef, useState } from "react";

/**
 * Reproductor de un Reel (HLS firmado por espectador, ADR-043-A).
 *
 * Safari/iOS reproducen HLS de forma nativa; el resto usa hls.js, que se carga SOLO cuando hace falta
 * (no entra en el paquete principal). El token de la URL caduca: si la reproducción falla, se avisa a
 * quien lo usa con `onExpired` para pedir una URL nueva en vez de reintentar con la caducada.
 */
export default function ReelPlayer({ hlsUrl, caption, width, height, onExpired }) {
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return undefined;
    setFailed(false);
    let hls = null;
    let cancelled = false;

    async function attach() {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsUrl;
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setFailed(true);
        return;
      }
      hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        setFailed(true);
        // 401/403 = token vencido: se pide una URL nueva.
        if (data.response && [401, 403].includes(data.response.code)) onExpired?.();
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    }

    attach().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
    // `onExpired` cambia de identidad entre renders y no debe reiniciar la reproducción.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlsUrl]);

  if (failed) {
    return (
      <p className="rounded-th-card border border-th-border px-4 py-6 text-center text-body-md text-th-fg-muted">
        No se pudo reproducir este Reel.
      </p>
    );
  }

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      preload="metadata"
      aria-label={caption || "Reel"}
      width={width || undefined}
      height={height || undefined}
      className="w-full max-h-[70vh] rounded-th-card bg-black object-contain"
    />
  );
}
