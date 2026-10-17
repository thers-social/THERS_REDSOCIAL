import { useRef, useState } from "react";
import Icon from "@shared/components/Icon";
import { getErrorMessage } from "@shared/lib/api";
import { ACCEPTED_IMAGE_TYPES, ImageSelectionError, prepareImage } from "@shared/lib/imageAttachments";
import { useLanguage } from "@shared/i18n";
import { deleteReviewImage, uploadReviewImages } from "../lib/placesApi";

export const MAX_REVIEW_PHOTOS = 3;
const MAX_SIDE = 1280;

/**
 * Fotos de una reseña (ADR-040 fase 4b). Cualquiera las ve; solo su autor puede añadirlas
 * o quitarlas (`editable`). Las fotos se reducen en el navegador antes de subirlas; el
 * servidor las vuelve a validar y re-codificar (quita EXIF/GPS): esto es solo comodidad.
 */
export default function ReviewPhotos({ placeId, images, editable = false, onChanged }) {
  const { t } = useLanguage();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(event) {
    const incoming = Array.from(event.target.files || []);
    event.target.value = "";
    if (incoming.length === 0) return;
    const room = MAX_REVIEW_PHOTOS - images.length;
    if (incoming.length > room) {
      setError(t("places.reviews.photos.limit", { count: MAX_REVIEW_PHOTOS }));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const prepared = [];
      for (const file of incoming) prepared.push(await prepareImage(file, MAX_SIDE));
      await uploadReviewImages(placeId, prepared);
      onChanged?.();
    } catch (err) {
      setError(err instanceof ImageSelectionError ? err.message : getErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove(image) {
    setBusy(true);
    setError("");
    try {
      await deleteReviewImage(placeId, image.id);
      onChanged?.();
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (images.length === 0 && !editable) return null;

  return (
    <div className="mt-2">
      <ul className="flex flex-wrap gap-2" aria-label={t("places.reviews.photos.title")}>
        {images.map((image, index) => (
          <li key={image.id} className="relative">
            <a href={image.url} target="_blank" rel="noopener noreferrer">
              <img
                src={image.url}
                width={image.width}
                height={image.height}
                alt={t("places.reviews.photos.alt", { index: index + 1 })}
                loading="lazy"
                className="h-20 w-20 rounded-xl border border-line object-cover dark:border-line-dark"
              />
            </a>
            {editable && (
              <button
                type="button"
                onClick={() => remove(image)}
                disabled={busy}
                aria-label={t("places.reviews.photos.remove", { index: index + 1 })}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black disabled:opacity-50"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && images.length < MAX_REVIEW_PHOTOS && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            multiple
            onChange={add}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-th-brand-fg hover:underline disabled:opacity-50"
          >
            <Icon name="image" size={16} />
            {busy
              ? t("places.reviews.photos.uploading")
              : t("places.reviews.photos.add", { count: images.length, max: MAX_REVIEW_PHOTOS })}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-th-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
