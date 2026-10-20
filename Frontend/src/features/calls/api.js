import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";

// Llamadas 1 a 1 (POST/GET /api/calls..., ver API_CONTRACT.md). La identidad sale del token.
function headers() {
  return { Authorization: `Bearer ${getStoredToken()}` };
}

export async function startCall(userId, kind) {
  const res = await api.post("/calls", { user_id: userId, kind }, { headers: headers() });
  return res.data;
}

export async function getIncomingCall() {
  const res = await api.get("/calls/incoming", { headers: headers() });
  return res.data.call;
}

export async function getCall(callId) {
  const res = await api.get(`/calls/${callId}`, { headers: headers() });
  return res.data.call;
}

export async function acceptCall(callId) {
  const res = await api.post(`/calls/${callId}/accept`, null, { headers: headers() });
  return res.data;
}

export async function declineCall(callId) {
  await api.post(`/calls/${callId}/decline`, null, { headers: headers() });
}

export async function cancelCall(callId) {
  await api.post(`/calls/${callId}/cancel`, null, { headers: headers() });
}

export async function endCall(callId) {
  await api.post(`/calls/${callId}/end`, null, { headers: headers() });
}
