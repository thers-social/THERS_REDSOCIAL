import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AppState, ToastAndroid } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { messageOf } from '@features/posts/PostsContext';
import { ApiError } from '@shared/lib/api';

import {
  acceptCall,
  cancelCall,
  declineCall,
  endCall,
  fetchCall,
  fetchIncomingCall,
  startCall as startCallRequest,
  TERMINAL_STATUSES,
} from './api';
import type { Call, CallAccess, CallKind } from './api';
import { CALLS_ENABLED } from './config';
import { CallScreen } from './CallScreen';

/**
 * Llamadas y videollamadas 1 a 1. No hay tiempo real en el servidor (igual que en mensajes y
 * notificaciones), así que el estado se consulta periódicamente: la llamada entrante cada pocos
 * segundos mientras no hay ninguna, y el estado de la llamada en curso mientras suena o está activa.
 * El timbre solo funciona con la app abierta; con la app cerrada no suena (hace falta push).
 *
 * `session`: null | { call, access, phase } con phase `outgoing` | `incoming` | `active`.
 */

const POLL_INCOMING_MS = 4000;
const POLL_RINGING_MS = 2000;
const POLL_ACTIVE_MS = 5000;

export type CallSession = {
  call: Call;
  access: CallAccess | null;
  phase: 'outgoing' | 'incoming' | 'active';
};

type CallsState = {
  enabled: boolean;
  inCall: boolean;
  startCall: (userId: string, kind: CallKind) => Promise<void>;
};

const CallContext = createContext<CallsState | null>(null);

function notify(message: string) {
  if (ToastAndroid) ToastAndroid.show(message, ToastAndroid.SHORT);
  else Alert.alert(message);
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [session, setSession] = useState<CallSession | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  sessionRef.current = session;
  const busyRef = useRef(false);

  // Al cerrar la sesión de la cuenta se descarta cualquier llamada en pantalla.
  useEffect(() => {
    if (!userId) setSession(null);
  }, [userId]);

  // Llamada entrante: solo con sesión, sin otra llamada y con la app a la vista.
  useEffect(() => {
    if (!CALLS_ENABLED || !userId || session) return undefined;
    const controller = new AbortController();

    async function check() {
      if (AppState.currentState !== 'active' || sessionRef.current) return;
      try {
        const call = await fetchIncomingCall(controller.signal);
        if (!controller.signal.aborted && call && !sessionRef.current) {
          setSession({ call, access: null, phase: 'incoming' });
        }
      } catch {
        // Un fallo de red al preguntar no se avisa: se vuelve a intentar en el siguiente ciclo.
      }
    }

    check();
    const timer = setInterval(check, POLL_INCOMING_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [userId, session]);

  // Estado de la llamada en curso: la otra persona contesta, rechaza o cuelga.
  const callId = session?.call.id ?? null;
  const phase = session?.phase ?? null;
  useEffect(() => {
    if (!callId) return undefined;
    const controller = new AbortController();

    async function poll() {
      try {
        const call = await fetchCall(callId as string, controller.signal);
        if (controller.signal.aborted) return;
        const current = sessionRef.current;
        if (!current || current.call.id !== callId) return;

        if (TERMINAL_STATUSES.includes(call.status)) {
          if (current.phase === 'outgoing') {
            if (call.status === 'declined') notify('Rechazó la llamada.');
            else if (call.status === 'missed') notify('No contestó.');
          } else if (current.phase === 'incoming' && call.status !== 'declined') {
            notify('Llamada perdida.');
          } else if (current.phase === 'active') {
            notify('La llamada terminó.');
          }
          setSession(null);
        } else if (current.phase === 'outgoing' && call.status === 'active') {
          setSession({ ...current, call, phase: 'active' });
        }
      } catch (error) {
        if (!controller.signal.aborted && error instanceof ApiError && error.status === 404) {
          setSession(null);
        }
      }
    }

    const timer = setInterval(poll, phase === 'active' ? POLL_ACTIVE_MS : POLL_RINGING_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [callId, phase]);

  const startCall = useCallback(async (otherUserId: string, kind: CallKind) => {
    if (sessionRef.current || busyRef.current) {
      notify('Ya hay una llamada en curso.');
      return;
    }
    busyRef.current = true;
    try {
      const { call, access } = await startCallRequest(otherUserId, kind);
      setSession({ call, access, phase: 'outgoing' });
    } catch (error) {
      Alert.alert('No se pudo llamar', messageOf(error));
    } finally {
      busyRef.current = false;
    }
  }, []);

  const accept = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    try {
      const { call, access } = await acceptCall(current.call.id);
      setSession({ call, access, phase: 'active' });
    } catch (error) {
      notify(error instanceof ApiError && error.status === 409 ? 'Llamada perdida.' : messageOf(error));
      setSession(null);
    } finally {
      busyRef.current = false;
    }
  }, []);

  // Colgar según la fase: rechazar si suena para mí, cancelar si yo llamo, terminar si ya está activa.
  const hangUp = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const id = current.call.id;
    const request =
      current.phase === 'incoming' ? declineCall(id) : current.phase === 'outgoing' ? cancelCall(id) : endCall(id);
    request.catch(() => {});
    setSession(null);
  }, []);

  const value = useMemo<CallsState>(
    () => ({ enabled: CALLS_ENABLED, inCall: session !== null, startCall }),
    [session, startCall],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {CALLS_ENABLED && session ? <CallScreen session={session} onAccept={accept} onHangUp={hangUp} /> : null}
    </CallContext.Provider>
  );
}

export function useCalls(): CallsState {
  const value = useContext(CallContext);
  if (!value) throw new Error('useCalls debe usarse dentro de <CallProvider>');
  return value;
}
