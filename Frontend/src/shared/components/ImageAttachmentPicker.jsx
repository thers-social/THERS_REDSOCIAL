import { useRef } from "react";
import Icon from "@shared/components/Icon";
import { ACCEPTED_IMAGE_TYPES } from "@shared/lib/imageAttachments";

/**
 * Botón «Foto» con las vistas previas de lo adjuntado (ADR-039). Sin estado
 * propio: lo gobierna `useImageAttachments`.
 *
 * `compact`: una sola miniatura, para la barra de mensajes.
 * `hideButton`: solo las vistas previas y el error; el botón lo pone quien lo usa.
 */
export default function ImageAttachmentPicker({
  items,
  max,
  processing = false,
  disabled = false,
  error = "",
  onAdd,
  onRemove,
  compact = false,
  hideButton = false,
}) {
  const inputRef = useRef(null);
  const atLimit = items.length >= max;

  const handleChange = (event) => {
    onAdd(event.target.files);
    // Permite volver a elegir el mismo archivo después de quitarlo.
    event.target.value = "";
  };

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Imágenes adjuntas">
          {items.map((item, index) => (
            <li key={item.id} className="relative">
              <img
                src={item.previewUrl}
                alt={`Vista previa de la imagen ${index + 1}`}
                className={`rounded-xl border border-th-border object-cover ${
                  compact ? "h-16 w-16" : "h-24 w-24"
                }`}
              />
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                disabled={disabled}
                aria-label={`Quitar la imagen ${index + 1}`}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black th-focus-ring disabled:opacity-50"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hideButton ? (
        error && (
          <p role="alert" className="text-xs font-semibold text-ember-500">
            {error}
          </p>
        )
      ) : (
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple={max > 1}
          onChange={handleChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || atLimit || processing}
          className="flex min-h-[44px] items-center gap-1.5 rounded-th-input px-2.5 py-2 text-label-lg text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle disabled:opacity-50"
        >
          <Icon name="image" size={20} />
          <span>{processing ? "Preparando..." : max > 1 ? "Foto" : "Adjuntar foto"}</span>
          {max > 1 && (
            <span className="text-th-fg-subtle">
              {items.length}/{max}
            </span>
          )}
        </button>
        {error && (
          <p role="alert" className="text-xs font-semibold text-ember-500">
            {error}
          </p>
        )}
      </div>
      )}
    </div>
  );
}
