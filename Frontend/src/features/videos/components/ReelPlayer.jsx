import { useEffect, useRef, useState } from "react";

/**
 * Reproductor de un Reel (HLS firmado por espectador, ADR-043-A).
 *
 * Safari/iOS reproducen HLS de forma nativa; el resto usa hls.js, que se carga SOLO cuando hace falta
 * (no entra en el paquete principal). El token de la URL caduca: si la reproducción falla, se avisa a
 * quien lo usa con `onExpired` para pedir una URL nueva en vez de reintentar con la caducada.
 */
function isAppleWebKit() {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua));
}

export default function ReelPlayer({ hlsUrl, caption, width, height, onExpired, videoRef: externalRef, muted = true, className = "" }) {
  const ownRef = useRef(null);
  // La pantalla de Reels maneja el <video> desde fuera (pausa, barra de progreso); sin ella, uno propio.
  const videoRef = externalRef || ownRef;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return undefined;
    setFailed(false);
    let hls = null;
    let cancelled = false;

    async function attach() {
      // Solo Safari/iOS: Chrome y Edge recientes también dicen poder reproducir HLS nativo, pero ahí
      // falla en silencio (video negro, sin evento de error útil). Con hls.js hay errores controlables.
      if (isAppleWebKit() && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsUrl;
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (!Hls.isSupported()) {
        // Sin MSE (navegador antiguo): último recurso, el reproductor nativo si lo hubiera.
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = hlsUrl;
          return;
        }
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
  }, [hlsUrl, videoRef]);

  if (failed) {
    return (
      <p className="flex h-full w-full items-center justify-center px-4 py-6 text-center text-body-md text-white/80">
        No se pudo reproducir este Reel.
      </p>
    );
  }

  // Sin `controls`: la barra, la pausa y el sonido son de la pantalla de Reels (ReelSlide).
  return (
    <video
      ref={videoRef}
      playsInline
      loop
      muted={muted}
      preload="metadata"
      aria-label={caption || "Reel"}
      width={width || undefined}
      height={height || undefined}
      className={`h-full w-full bg-black object-contain ${className}`}
    />
  );
}
