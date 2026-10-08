// Estado de la vista de THERS Places (ADR-040, encargo §25). Módulo PURO, probado con
// `node --test`.
//
// Toda pantalla de lugares debe resolverse en exactamente UNO de estos estados, nunca en
// una pantalla rota porque la API no respondió.
//
//   loading   -> consulta en curso y todavía no hay resultados que mostrar
//   offline   -> el navegador no tiene red (distinto de un error del servidor)
//   error     -> la API respondió con error o no se pudo alcanzar
//   empty     -> la consulta salió bien pero no hay lugares
//   success   -> hay lugares
//
// `location_denied` NO es un estado de la vista: la lista sigue funcionando sin GPS
// (buscar, mover el mapa, elegir zona), así que se informa aparte con `locationNotice`.

export const VIEW_STATES = ["loading", "offline", "error", "empty", "success"];

export function deriveViewState({ loading, error, offline, count }) {
  // Con resultados ya cargados se siguen mostrando mientras se refresca: un parpadeo a
  // "cargando" en cada movimiento del mapa sería peor que datos ligeramente viejos.
  if (count > 0) return "success";
  if (offline) return "offline";
  if (loading) return "loading";
  if (error) return "error";
  return "empty";
}

/**
 * Aviso sobre la ubicación, o `null` si no hace falta ninguno.
 * `status`: idle | requesting | granted | denied | unavailable | timeout.
 */
export function locationNotice(status) {
  if (status === "denied") return "location_denied";
  if (status === "unavailable") return "location_unavailable";
  if (status === "timeout") return "location_timeout";
  return null;
}
