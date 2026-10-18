// Guardar y compartir publicaciones (ADR-047; contrato en API_CONTRACT.md v0.66).
//
// Guardar es privado e idempotente: el servidor devuelve siempre el estado final, así que un doble
// clic nunca deja la marca desincronizada. Compartir manda un mensaje directo con `post_id`.

import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth/context/AuthContext";

function authConfig(extra = {}) {
  return { ...extra, headers: { Authorization: `Bearer ${getStoredToken()}` } };
}

export async function setPostSaved(postId, saved) {
  const { data } = saved
    ? await api.post(`/posts/${postId}/save`, null, authConfig())
    : await api.delete(`/posts/${postId}/save`, authConfig());
  return data.saved;
}

export async function fetchSavedPosts(signal) {
  const { data } = await api.get("/posts/saved", authConfig({ signal }));
  return data.posts;
}

export async function fetchChatPeople(signal) {
  const { data } = await api.get("/conversations", authConfig({ signal }));
  return data.conversations.map((row) => row.user);
}

// A quién se puede mandar una publicación: personas con las que ya hay conversación y los grupos
// del usuario (ADR-048). Cada destino lleva su `kind` ("user" | "group") y su `id`.
export async function fetchShareTargets(signal) {
  const people = await fetchChatPeople(signal);
  let groups = [];
  try {
    const { data } = await api.get("/groups", authConfig({ signal }));
    groups = data.groups;
  } catch {
    // Los grupos son un añadido: si fallan, se puede seguir compartiendo con personas.
  }
  return [
    ...groups.map((g) => ({ kind: "group", id: g.id, name: g.name, avatar_url: null })),
    ...people.map((p) => ({ kind: "user", id: p.id, name: p.name, avatar_url: p.avatar_url })),
  ];
}

export async function sharePost(target, postId, content) {
  const body = { post_id: postId };
  if (content) body.content = content;
  const path = target.kind === "group" ? `/groups/${target.id}/messages` : `/users/${target.id}/messages`;
  const { data } = await api.post(path, body, authConfig());
  return data.message;
}
