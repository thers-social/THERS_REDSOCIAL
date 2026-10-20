import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getStoredToken } from "@features/auth";
import { getErrorMessage } from "@shared/lib/api";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import * as callsApi from "./api";
import { CALLS_ENABLED } from "./config";
import CallScreen from "./CallScreen";

// Llamadas y videollamadas 1 a 1. No hay tiempo real en el servidor (como en mensajes y notificaciones),
// así que el estado se consulta por polling: la llamada entrante cada pocos segundos mientras no hay
// ninguna, y el estado de la llamada en curso mientras suena o está activa. El audio y el video no pasan
// por ahí: van directo a LiveKit con el token que entrega la API.
//
// `session` = null | { call, access, phase } con phase "outgoing" | "incoming" | "active".

const POLL_INCOMING_MS = 4000;
const POLL_RINGING_MS = 2000;
const POLL_ACTIVE_MS = 5000;
const TERMINAL = ["declined", "cancelled", "missed", "ended"];

const CallContext = createContext(null);

export function CallProvider({ children }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  sessionRef.current = session;
  const busyRef = useRef(false);
  // El polling lee el toast desde un ref: así no se reinicia si el contexto de toasts se recrea.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const clear = useCallback(() => setSession(null), []);

  // Llamada entrante: solo cuando no hay otra llamada, hay sesión y la pestaña está a la vista.
  useEffect(() => {
    if (!CALLS_ENABLED || session) return undefined;
    let cancelled = false;

    async function check() {
      if (cancelled || document.hidden || !getStoredToken() || sessionRef.current) return;
      try {
        const call = await callsApi.getIncomingCall();
        if (!cancelled && call && !sessionRef.current) {
          setSession({ call, access: null, phase: "incoming" });
        }
      } catch {
        // Un fallo de red al preguntar no se avisa: se vuelve a intentar en el siguiente ciclo.
      }
    }

    check();
    const timer = setInterval(check, POLL_INCOMING_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session]);

  // Estado de la llamada en curso: la otra persona contesta, rechaza o cuelga.
  const phase = session?.phase;
  const callId = session?.call.id;
  useEffect(() => {
    if (!callId) return undefined;
    let cancelled = false;

    async function poll() {
      try {
        const call = await callsApi.getCall(callId);
        if (cancelled) return;
        const current = sessionRef.current;
        if (!current || current.call.id !== callId) return;

        if (TERMINAL.includes(call.status)) {
          if (current.phase === "outgoing") {
            if (call.status === "declined") toastRef.current.info("Rechazó la llamada.");
            else if (call.status === "missed") toastRef.current.info("No contestó.");
          } else if (current.phase === "incoming" && call.status !== "declined") {
            toastRef.current.info("Llamada perdida.");
          } else if (current.phase === "active") {
            toastRef.current.info("La llamada terminó.");
          }
          setSession(null);
        } else if (current.phase === "outgoing" && call.status === "active") {
          setSession({ ...current, call, phase: "active" });
        }
      } catch (error) {
        if (!cancelled && error.response?.status === 404) setSession(null);
      }
    }

    const timer = setInterval(poll, phase === "active" ? POLL_ACTIVE_MS : POLL_RINGING_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // El polling solo se reinicia al cambiar la llamada o su fase.
  }, [callId, phase]);

  const startCall = useCallback(
    async (user, kind) => {
      if (sessionRef.current || busyRef.current) {
        toast.info("Ya hay una llamada en curso.");
        return;
      }
      busyRef.current = true;
      try {
        const { call, access } = await callsApi.startCall(user.id, kind);
        setSession({ call, access, phase: "outgoing" });
      } catch (error) {
        toast.error(getErrorMessage(error, t));
      } finally {
        busyRef.current = false;
      }
    },
    [toast, t]
  );

  const accept = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    try {
      const { call, access } = await callsApi.acceptCall(current.call.id);
      setSession({ call, access, phase: "active" });
    } catch (error) {
      toast.error(error.response?.status === 409 ? "Llamada perdida." : getErrorMessage(error, t));
      setSession(null);
    } finally {
      busyRef.current = false;
    }
  }, [toast, t]);

  // Colgar según la fase: rechazar si suena para mí, cancelar si yo llamo, terminar si ya está activa.
  const hangUp = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const { call, phase: currentPhase } = current;
    const request =
      currentPhase === "incoming"
        ? callsApi.declineCall(call.id)
        : currentPhase === "outgoing"
          ? callsApi.cancelCall(call.id)
          : callsApi.endCall(call.id);
    request.catch(() => {});
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({ enabled: CALLS_ENABLED, inCall: Boolean(session), startCall }),
    [session, startCall]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {CALLS_ENABLED && session && (
        <CallScreen session={session} onAccept={accept} onHangUp={hangUp} />
      )}
    </CallContext.Provider>
  );
}

export function useCalls() {
  const value = useContext(CallContext);
  if (!value) throw new Error("useCalls debe usarse dentro de <CallProvider>");
  return value;
}
