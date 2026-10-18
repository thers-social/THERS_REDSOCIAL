import { useRef, useState } from "react";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { ImageSelectionError, prepareImage } from "@shared/lib/imageAttachments";
import { useLanguage } from "@shared/i18n";
import { removePlaceImage, uploadPlaceImage } from "../lib/placesApi";

const MAX_SIDE = 1200;
const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Imagen que identifica al lugar (ADR-046). Solo la ve y la cambia quien lo gestiona; el servidor lo
 * vuelve a comprobar. Se reduce en el navegador antes de subirla (una foto de móvil pasa de 5 MB).
 */
export default function ManageImage({ placeId, imageUrl, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function run(action, successKey) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey));
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof ImageSelectionError ? error.message : getErrorMessage(error, t));
    } finally {
      setBusy(false);
    }
  }

  const choose = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    run(async () => uploadPlaceImage(placeId, await prepareImage(file, MAX_SIDE)), "places.manage.image.saved");
  };

  return (
    <fieldset className="mt-4 rounded-lg border border-line p-3 dark:border-line-dark" disabled={busy}>
      <legend className="px-1 text-sm font-semibold text-ink dark:text-ink-dark">{t("places.manage.image.title")}</legend>
      <div className="flex items-center gap-3">
        {imageUrl ? (
          <img src={imageUrl} alt={t("places.manage.image.current")} className="h-20 w-20 rounded-xl border border-line object-cover dark:border-line-dark" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted dark:border-line-dark">
            {t("places.manage.image.none")}
          </span>
        )}
        <div className="flex flex-col items-start gap-2">
          <input ref={inputRef} type="file" accept={ACCEPT} onChange={choose} className="sr-only" tabIndex={-1} aria-hidden="true" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand hover:bg-th-brand-hover disabled:opacity-50"
          >
            {busy ? t("places.manage.image.working") : imageUrl ? t("places.manage.image.change") : t("places.manage.image.add")}
          </button>
          {imageUrl && (
            <button
              type="button"
              onClick={() => run(() => removePlaceImage(placeId), "places.manage.image.removed")}
              className="text-xs font-semibold text-th-danger-fg hover:underline disabled:opacity-50"
            >
              {t("places.manage.image.remove")}
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">{t("places.manage.image.hint")}</p>
    </fieldset>
  );
}
