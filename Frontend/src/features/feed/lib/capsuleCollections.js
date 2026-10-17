// Colecciones de la página Cápsulas. Una «cápsula» es una publicación real (ADR-004), así que
// cada colección es un filtro sobre las publicaciones ya cargadas: no necesita endpoint nuevo.
// Lógica pura, probada en `tests/capsuleCollections.test.mjs`.

export const COLLECTIONS = [
  { id: "all", label: "Todas", icon: "layers" },
  { id: "following", label: "Siguiendo", icon: "group" },
  { id: "mine", label: "Mías", icon: "person" },
];

export function isCollection(id) {
  return COLLECTIONS.some((collection) => collection.id === id);
}

/**
 * Filtra por colección. «Siguiendo» usa `author.follow_status === "accepted"` (ADR-022), que
 * viene del servidor; una solicitud pendiente NO cuenta. «Mías» compara el id del autor.
 * Conserva el orden recibido (el feed ya llega del más reciente al más antiguo).
 */
export function filterCapsules(capsules, collectionId, currentUserId) {
  if (!Array.isArray(capsules)) return [];
  if (collectionId === "following") {
    return capsules.filter((c) => c.author?.follow_status === "accepted");
  }
  if (collectionId === "mine") {
    return currentUserId ? capsules.filter((c) => c.author?.id === currentUserId) : [];
  }
  return capsules;
}
