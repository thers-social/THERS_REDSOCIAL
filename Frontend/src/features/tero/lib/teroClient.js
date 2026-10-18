// Cliente HTTP de Tero (ADR-041). Usa el mismo `api` (axios) y el mismo token que el
// resto del Frontend. El servidor NO guarda historial: cada petición lleva la
// conversación previa (ver `historyForRequest`).

import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";
import { chatBody, parseChatResponse } from "./teroChat";

function authHeaders() {
  return { Authorization: `Bearer ${getStoredToken()}` };
}

// Una respuesta con herramientas puede encadenar hasta 3 vueltas al modelo (5 a 15 s);
// el tiempo por defecto de axios (sin tope) no sirve para avisar de un fallo a tiempo.
const CHAT_TIMEOUT_MS = 60000;

export async function sendToTero(text, context, history, signal, image = null) {
  const res = await api.post("/tero/chat", chatBody(text, context, history, image), {
    headers: authHeaders(),
    timeout: CHAT_TIMEOUT_MS,
    signal,
  });
  return parseChatResponse(res.data);
}

// El cuerpo va vacío a propósito: el servidor identifica a la persona por la sesión.
export async function confirmTeroAction(actionId, signal) {
  const res = await api.post(`/tero/actions/${encodeURIComponent(actionId)}/confirm`, null, {
    headers: authHeaders(),
    signal,
  });
  return res.data;
}

export async function cancelTeroAction(actionId, signal) {
  const res = await api.post(`/tero/actions/${encodeURIComponent(actionId)}/cancel`, null, {
    headers: authHeaders(),
    signal,
  });
  return res.data;
}
