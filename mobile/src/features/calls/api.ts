/**
 * Llamadas y videollamadas 1 a 1 (`POST/GET /api/calls...`, `API_CONTRACT.md`). El audio y el video no
 * pasan por la API: van directo a LiveKit con el token de sala que entrega el servidor. La API solo
 * coordina quién llama a quién y en qué estado está la llamada; como no hay tiempo real, el estado se
 * consulta periódicamente.
 */

import { request } from '@shared/lib/api';

export type CallKind = 'audio' | 'video';
export type CallStatus = 'ringing' | 'active' | 'declined' | 'cancelled' | 'missed' | 'ended';

export type CallPerson = {
  id: string;
  name: string;
  username: string;
  avatar_url: string | null;
};

export type Call = {
  id: string;
  kind: CallKind;
  status: CallStatus;
  /** `outgoing` si la inicié yo; `incoming` si me están llamando. */
  direction: 'outgoing' | 'incoming';
  caller: CallPerson;
  callee: CallPerson;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
};

/** Para entrar a la sala de LiveKit: URL pública `wss://...` y token de una sola sala. */
export type CallAccess = { token: string; url: string; room: string };

export const TERMINAL_STATUSES: CallStatus[] = ['declined', 'cancelled', 'missed', 'ended'];

export async function startCall(userId: string, kind: CallKind): Promise<{ call: Call; access: CallAccess }> {
  return request('/calls', { method: 'POST', body: { user_id: userId, kind }, authenticated: true });
}

export async function fetchIncomingCall(signal?: AbortSignal): Promise<Call | null> {
  const { call } = await request<{ call: Call | null }>('/calls/incoming', { authenticated: true, signal });
  return call;
}

export async function fetchCall(callId: string, signal?: AbortSignal): Promise<Call> {
  const { call } = await request<{ call: Call }>(`/calls/${callId}`, { authenticated: true, signal });
  return call;
}

export async function acceptCall(callId: string): Promise<{ call: Call; access: CallAccess }> {
  return request(`/calls/${callId}/accept`, { method: 'POST', authenticated: true });
}

export async function declineCall(callId: string): Promise<void> {
  await request(`/calls/${callId}/decline`, { method: 'POST', authenticated: true });
}

export async function cancelCall(callId: string): Promise<void> {
  await request(`/calls/${callId}/cancel`, { method: 'POST', authenticated: true });
}

export async function endCall(callId: string): Promise<void> {
  await request(`/calls/${callId}/end`, { method: 'POST', authenticated: true });
}
