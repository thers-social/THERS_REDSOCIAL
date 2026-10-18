import { useEffect, useRef, useState } from "react";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import {
  ACCEPTED_IMAGE_TYPES,
  ImageSelectionError,
  prepareImage,
} from "@shared/lib/imageAttachments";
import { createStory } from "../lib/storiesApi";

/** Mismo máximo que el servidor (`MAX_STORY_TEXT`, ADR-042). */
const MAX_TEXT = 200;
/** El servidor reduce a 1920 px; se reduce antes para no subir fotos de varios MB. */
const MAX_SIDE = 1920;

/**
 * Nueva historia (ADR-042): elegir una imagen, escribir un texto opcional y publicar.
 * La imagen se reduce en el navegador (comodidad: el servidor lo vuelve a validar todo).
 */
export default function StoryComposer({ onClose, onPublished }) {
  const { t } = useLanguage();
  const inputRef = useRef(null);
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!image) return undefined;
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      setImage(await prepareImage(file, MAX_SIDE));
    } catch (problem) {
      setError(problem instanceof ImageSelectionError ? problem.message : t("errors.unexpected"));
    }
  }

  async function handlePublish() {
    if (!image || busy) return;
    setBusy(true);
    setError("");
    try {
      const story = await createStory({ image, content: text });
      onPublished?.(story);
      onClose();
    } catch (problem) {
      setError(getErrorMessage(problem, t));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 px-4 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Nueva historia"
    >
      <div
        className="flex w-full max-w-sm flex-col gap-4 rounded-th-card border border-th-border bg-th-surface p-5 shadow-th-card"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-headline-sm text-th-fg-strong">Nueva historia</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
            className="rounded-full p-2 text-th-fg-muted th-focus-ring hover:bg-th-surface-raised disabled:opacity-50"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          onChange={handleFile}
          className="sr-only"
          aria-label="Elegir una imagen para la historia"
        />

        {previewUrl ? (
          <div className="relative h-[46vh] overflow-hidden rounded-th-card bg-black">
            <img src={previewUrl} alt="Vista previa de la historia" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="absolute bottom-2 right-2 rounded-th-pill bg-black/50 px-3 py-1.5 text-label-md font-semibold text-white"
            >
              Cambiar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-[46vh] flex-col items-center justify-center gap-2 rounded-th-card border-2 border-dashed border-th-border text-th-fg-muted th-focus-ring hover:border-th-border-strong"
          >
            <Icon name="add_photo_alternate" size={32} />
            <span className="text-label-lg font-semibold">Elegir una imagen</span>
            <span className="text-label-md">JPEG, PNG o WebP</span>
          </button>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-label-md font-semibold text-th-fg-muted">Texto (opcional)</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, MAX_TEXT))}
            rows={2}
            disabled={busy}
            className="resize-none rounded-th-input border border-th-border bg-th-surface-subtle px-3 py-2 text-body-md text-th-fg th-focus-ring"
            placeholder="¿Qué quieres decir?"
          />
          <span className="self-end text-label-md text-th-fg-subtle">
            {text.length}/{MAX_TEXT}
          </span>
        </label>

        <p className="text-label-md text-th-fg-subtle">
          Dura 24 horas. La verán quienes te siguen.
        </p>

        {error && (
          <p role="alert" className="text-body-sm text-th-danger-fg">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handlePublish}
          disabled={!image || busy}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-th-pill bg-th-brand px-4 py-2 text-label-lg font-bold text-th-on-brand th-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Spinner size={16} />
              Publicando…
            </>
          ) : (
            "Publicar historia"
          )}
        </button>
      </div>
    </div>
  );
}
