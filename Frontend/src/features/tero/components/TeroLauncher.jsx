import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useLanguage } from "@shared/i18n";
import useTeroChat from "../hooks/useTeroChat";
import { screenFor } from "../lib/teroChat";
import { SLEEP_AFTER_MS } from "../lib/teroPresence";
import TeroAvatar from "./TeroAvatar";
import TeroChatPanel from "./TeroChatPanel";

/**
 * Burbuja flotante de Tero y su panel. Se monta una vez en el shell de la app (solo con
 * sesión) y mantiene la conversación mientras se navega, porque el estado vive aquí.
 * Tero no se mueve de sitio, no abre el panel por su cuenta y, si nadie lo usa un rato,
 * se duerme.
 */
export default function TeroLauncher({ onActionConfirmed }) {
  const { t } = useLanguage();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const buttonRef = useRef(null);

  const chat = useTeroChat({
    context: { screen: screenFor(location.pathname) },
    onActionConfirmed,
  });

  // Se duerme tras un rato sin que nadie lo toque (solo con el panel cerrado).
  useEffect(() => {
    if (open) return undefined;
    const id = setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    return () => clearTimeout(id);
  }, [open]);

  const toggle = useCallback(() => {
    setAsleep(false);
    setOpen((value) => !value);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  const bubbleMood = open ? "attention" : asleep ? "sleeping" : "idle";

  // En los mensajes la burbuja taparia los botones de enviar y grabar del chat: alli se oculta (no se
  // desmonta, para no perder la conversacion al volver).
  const hidden = location.pathname.startsWith("/messages");

  return (
    <div hidden={hidden}>
      {open ? <TeroChatPanel chat={chat} onClose={close} /> : null}
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={open ? t("tero.close") : t("tero.open")}
        aria-expanded={open}
        className="fixed bottom-[calc(var(--th-bottomnav-h)+env(safe-area-inset-bottom)+12px)] right-4 z-50 flex h-16 w-16 items-center justify-center rounded-full border border-th-border bg-th-surface shadow-xl transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-th-brand motion-reduce:transition-none motion-reduce:hover:scale-100 lg:bottom-6 lg:right-6"
      >
        <TeroAvatar size={48} mood={open ? chat.mood : bubbleMood} />
      </button>
    </div>
  );
}
