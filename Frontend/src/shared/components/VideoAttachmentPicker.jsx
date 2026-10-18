import { useRef } from "react";
import Icon from "@shared/components/Icon";
import { ACCEPTED_VIDEO_TYPES, formatVideoDuration } from "@shared/lib/videoAttachments";

/**
 * Botón «Video» con la vista previa de lo adjuntado (ADR-046). Sin estado propio: lo gobierna
 * `useVideoAttachment`.
 *
 * `compact`: vista previa pequeña, para la barra de mensajes.
 * `hideButton`: solo la vista previa y el error; el botón lo pone quien lo usa.
 */
export default function VideoAttachmentPicker({ video, disabled = false, compact = false, hideButton = false }) {
  const inputRef = useRef(null);

  const handleChange = (event) => {
    video.add(event.target.files);
    // Permite volver a elegir el mismo archivo después de quitarlo.
    event.target.value = "";
  };

  return (
    <div className="flex flex-col gap-2">
      {video.item && (
        <div className="relative inline-block self-start">
          <video
            src={video.item.previewUrl}
            muted
            playsInline
            preload="metadata"
            aria-label="Vista previa del video"
            className={`rounded-xl border border-th-border bg-black object-contain ${
              compact ? "h-24 max-w-[10rem]" : "max-h-48 max-w-full"
            }`}
          />
          {video.item.durationSeconds !== null && (
            <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 text-[11px] font-semibold text-white">
              {formatVideoDuration(video.item.durationSeconds * 1000)}
            </span>
          )}
          <button
            type="button"
            onClick={video.clear}
            disabled={disabled}
            aria-label="Quitar el video"
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black th-focus-ring disabled:opacity-50"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {hideButton ? (
        video.error && (
          <p role="alert" className="text-xs font-semibold text-ember-500">
            {video.error}
          </p>
        )
      ) : (
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_VIDEO_TYPES.join(",")}
            onChange={handleChange}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || video.processing || Boolean(video.item)}
            className="flex min-h-[44px] items-center gap-1.5 rounded-th-input px-2.5 py-2 text-label-lg text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle disabled:opacity-50"
          >
            <Icon name="videocam" size={20} />
            <span>{video.processing ? "Preparando..." : "Video"}</span>
          </button>
          {video.error && (
            <p role="alert" className="text-xs font-semibold text-ember-500">
              {video.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
