// Cliente HTTP de «Mejores amigos» (API_CONTRACT.md §4.47, ADR-054). La lista es privada: solo quien
// la hace la ve. Con las historias apagadas en el servidor (STORIES_ENABLED) todo responde 404.

import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";

function authConfig(extra = {}) {
  return { ...extra, headers: { Authorization: `Bearer ${getStoredToken()}` } };
}

/** `{friends: [{id, username, name, avatar_url, added_at}], limit}`. */
export async function fetchCloseFriends(signal) {
  const { data } = await api.get("/close-friends", authConfig({ signal }));
  return data;
}

export async function addCloseFriend(userId) {
  await api.post("/close-friends", { user_id: userId }, authConfig());
}

export async function removeCloseFriend(userId) {
  await api.delete(`/close-friends/${userId}`, authConfig());
}
