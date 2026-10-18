import { formatVideoDuration } from "@shared/lib/videoAttachments";

/**
 * Video de una publicación o de un mensaje (ADR-046).
 *
 * `video`: `{ url, thumbnail_url, width, height, duration_ms }` tal como lo entrega la API. Las
 * dimensiones reservan el espacio antes de que cargue, para que el feed no salte (CLS), y la miniatura
 * es el póster: no se descarga el video hasta que la persona lo reproduce (`preload="none"`).
 *
 * `compact`: más pequeño, para dentro de una burbuja de chat.
 */
export default function VideoPlayer({ video, label = "Video adjunto", compact = false }) {
  if (!video) return null;

  const maxWidth = compact ? "max-w-[16rem]" : "max-w-full";
  const ratio = video.width && video.height ? `${video.width} / ${video.height}` : "16 / 9";

  return (
    <figure className={`relative overflow-hidden rounded-2xl border border-th-border bg-black ${maxWidth}`}>
      <video
        src={video.url}
        poster={video.thumbnail_url}
        controls
        playsInline
        preload="none"
        aria-label={label}
        width={video.width}
        height={video.height}
        style={{ aspectRatio: ratio, maxHeight: compact ? "18rem" : "32rem" }}
        className="block h-auto w-full object-contain"
      />
      <figcaption className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-1.5 text-[11px] font-semibold text-white">
        {formatVideoDuration(video.duration_ms)}
      </figcaption>
    </figure>
  );
}
