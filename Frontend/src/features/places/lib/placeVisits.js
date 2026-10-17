// Registro de visitas a la ficha (ADR-040 §33). Un fallo NUNCA se muestra ni rompe la ficha: contar
// visitas es un extra del negocio, no una función de quien visita.
import { recordPlaceVisit } from "./placesApi";

export const VISIT_EVENTS = ["view", "phone", "website", "directions"];

// Abrir la ficha cuenta una sola vez por lugar y carga de la página: reabrirla o volver atrás no
// infla la cifra. Los toques (teléfono, web, ruta) sí cuentan cada vez: son una intención.
const viewed = new Set();

/** `true` si se envió. Evento desconocido o `view` repetido en la misma carga: no se envía. */
export function trackPlaceVisit(placeId, event, send = recordPlaceVisit) {
  if (!placeId || !VISIT_EVENTS.includes(event)) return false;
  if (event === "view") {
    if (viewed.has(placeId)) return false;
    viewed.add(placeId);
  }
  Promise.resolve(send(placeId, event)).catch(() => {});
  return true;
}

/** Solo para las pruebas. */
export function resetViewedForTests() {
  viewed.clear();
}
