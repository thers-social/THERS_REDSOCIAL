import { useEffect, useId, useRef, useState } from "react";
import Icon from "@shared/components/Icon";
import { useLanguage } from "@shared/i18n";
import { APK_URL, QR_IMAGE_URL } from "../config";
import { currentPlatform } from "../lib/platform";

const BUTTON_CLASS =
  "inline-flex w-full items-center justify-center gap-2 rounded-full border border-line py-3 px-5 font-bold text-ink transition hover:bg-canvas th-focus-ring";

function QrBlock({ t }) {
  if (QR_IMAGE_URL) {
    return <img src={QR_IMAGE_URL} alt={t("install.qrAlt")} className="h-56 w-56 rounded-2xl border border-line bg-white p-2" />;
  }
  // Hueco para el QR definitivo (ver `config.js`): se ve a propósito como un recuadro vacío.
  return (
    <div className="flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-muted">
      <Icon name="qr_code_2" size={64} />
      <span className="px-4 text-center text-sm font-semibold">{t("install.qrPending")}</span>
    </div>
  );
}

function InstallDialog({ platform, onClose }) {
  const { t } = useLanguage();
  const titleId = useId();
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const copy = {
    desktop: { title: t("install.desktopTitle"), hint: t("install.desktopHint") },
    android: { title: t("install.androidTitle"), hint: t("install.androidHint") },
    ios: { title: t("install.iosTitle"), hint: t("install.iosHint") },
  }[platform];

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-white p-6 text-center text-ink shadow-2xl"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("install.close")}
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-canvas"
        >
          <Icon name="close" size={22} />
        </button>

        <h2 id={titleId} className="px-6 pt-2 text-xl font-extrabold">
          {copy.title}
        </h2>
        <p className="max-w-xs text-sm text-muted">{copy.hint}</p>

        {platform === "desktop" && <QrBlock t={t} />}
        {platform === "android" && (
          <p className="w-full rounded-2xl border border-dashed border-line px-4 py-6 text-sm font-semibold text-muted">
            {t("install.androidPending")}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * «Instalar aplicación». Qué hace depende del dispositivo (`lib/platform.js`):
 *  - computadora: abre un diálogo con el código QR para escanearlo desde el celular;
 *  - Android: descarga el APK; si todavía no hay (`APK_URL` es `null`) avisa que llegará pronto;
 *  - iPhone/iPad: avisa que la aplicación es solo para Android.
 * Los archivos reales se conectan en `config.js`; mientras tanto el diálogo muestra su hueco.
 */
export default function InstallAppButton({ className = "" }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [platform] = useState(currentPlatform);

  const label = (
    <>
      <Icon name={platform === "desktop" ? "qr_code_2" : "download"} size={20} />
      {t("install.button")}
    </>
  );

  if (platform === "android" && APK_URL) {
    // El APK está en otro dominio (Drive): se abre en pestaña nueva; `download` solo vale en el mismo sitio.
    const external = /^https?:\/\//i.test(APK_URL);
    return (
      <a
        href={APK_URL}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : { download: true })}
        className={`${BUTTON_CLASS} ${className}`}
      >
        {label}
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${BUTTON_CLASS} ${className}`}>
        {label}
      </button>
      {open && <InstallDialog platform={platform} onClose={() => setOpen(false)} />}
    </>
  );
}
