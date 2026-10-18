import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";

// Perfil de otra persona, seguidores/seguidos, Explorar y sugerencias (ADR-049, ADR-050, ADR-052).
// Cada función es una sola petición del contrato (API_CONTRACT.md §4.41, §4.42); la lógica de
// pantalla vive en las páginas.

function authConfig(extra = {}) {
  return { headers: { Authorization: `Bearer ${getStoredToken()}` }, ...extra };
}

/** `GET /api/users/<id>`: perfil público + relación de quien mira. 404 si hay bloqueo o no existe. */
export async function fetchPublicProfile(userId, signal) {
  const { data } = await api.get(`/users/${userId}`, authConfig({ signal }));
  return data.user;
}

/** `GET /api/posts?author_id=`: publicaciones de una persona, con las reglas de visibilidad del feed. */
export async function fetchPostsByAuthor(userId, signal) {
  const { data } = await api.get("/posts", authConfig({ params: { author_id: userId }, signal }));
  return data.posts;
}

/** `GET /api/users/<id>/followers|following`. `kind`: "followers" | "following". 403 en cuenta privada. */
export async function fetchConnections(userId, kind, offset = 0, signal) {
  const { data } = await api.get(`/users/${userId}/${kind}`, authConfig({ params: { offset }, signal }));
  return data;
}

/** `GET /api/explore`: fotos y videos populares de personas que no sigues. */
export async function fetchExplore(kind = "all", offset = 0, signal) {
  const { data } = await api.get("/explore", authConfig({ params: { kind, offset }, signal }));
  return data;
}

/** `GET /api/users/suggestions` con `limit` opcional (1–20). */
export async function fetchSuggestions(limit, signal) {
  const { data } = await api.get("/users/suggestions", authConfig({ params: limit ? { limit } : {}, signal }));
  return data.suggestions;
}

/** Seguir / dejar de seguir. Devuelve `{ following, follow_status }`. */
export async function setFollow(userId, follow) {
  const { data } = follow
    ? await api.post(`/users/${userId}/follow`, null, authConfig())
    : await api.delete(`/users/${userId}/follow`, authConfig());
  return data;
}

/** Texto del botón de seguir según la relación (ADR-022). */
export function followLabel(status, isPrivate) {
  if (status === "accepted") return "Siguiendo";
  if (status === "pending") return "Solicitado";
  return isPrivate ? "Solicitar" : "Seguir";
}

/** Enlace público del perfil dentro de la web. */
export function profileUrl(userId) {
  return `${window.location.origin}/user/${userId}`;
}
