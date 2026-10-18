// Cliente HTTP de THERS Places (contrato: API_CONTRACT.md §4.23 y §4.24).
//
// El catálogo es público: si hay sesión se envía el token (el backend marca `is_saved`);
// si no, se llama igual. Un token vencido NO rompe el catálogo (el backend lo trata como
// anónimo). Guardar y reportar sí exigen sesión.
//
// Las coordenadas se redondean a 3 decimales aquí, antes de salir (ADR-040 §4.4).

import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth/context/AuthContext";
import { roundPoint } from "./coordinates";

function authConfig(extra = {}) {
  const token = getStoredToken();
  return {
    ...extra,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

export async function fetchCategories(signal) {
  const { data } = await api.get("/places/categories", { signal });
  return data.categories;
}

export async function fetchNearby({ lat, lng, radius, category, limit }, signal) {
  const point = roundPoint({ lat, lng });
  const { data } = await api.get(
    "/places/nearby",
    authConfig({ signal, params: { ...point, radius, category, limit } })
  );
  return data.places;
}

export async function searchPlaces({ q, lat, lng, category, limit }, signal) {
  const params = { q, category, limit };
  if (Number.isFinite(lat) && Number.isFinite(lng)) Object.assign(params, roundPoint({ lat, lng }));
  const { data } = await api.get("/places/search", authConfig({ signal, params }));
  return data.places;
}

export async function fetchPlace(id, signal) {
  const { data } = await api.get(`/places/${id}`, authConfig({ signal }));
  return data.place;
}

export async function fetchSavedPlaces(signal) {
  const { data } = await api.get("/places/saved", authConfig({ signal }));
  return data.places;
}

export async function savePlace(id) {
  const { data } = await api.post(`/places/${id}/save`, null, authConfig());
  return data.saved;
}

export async function unsavePlace(id) {
  const { data } = await api.delete(`/places/${id}/save`, authConfig());
  return data.saved;
}

export async function reportPlace(id, { reason, details }) {
  const { data } = await api.post(`/places/${id}/report`, { reason, details }, authConfig());
  return data.report;
}

// --- Reseñas (ADR-040 fase 4a; contrato: API_CONTRACT.md §4.25) ---

export async function fetchReviews(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/reviews`, authConfig({ signal }));
  return data;
}

export async function writeReview(placeId, { rating, body }) {
  const { data } = await api.put(`/places/${placeId}/review`, { rating, body }, authConfig());
  return data.review;
}

export async function deleteReview(placeId) {
  const { data } = await api.delete(`/places/${placeId}/review`, authConfig());
  return data.deleted;
}

// Reportar la reseña de otra persona: ruta genérica de reportes (ADR-032).
export async function reportReview(reviewId, { reason, details }) {
  const { data } = await api.post(
    "/reports",
    { target_type: "review", target_id: reviewId, reason, details },
    authConfig()
  );
  return data.report;
}

// Imagen que identifica al lugar (ADR-046): la sube quien lo gestiona. `file` ya viene reducida (<= 5 MB);
// el servidor la vuelve a validar y re-codificar. Devuelve el lugar actualizado.
export async function uploadPlaceImage(placeId, file) {
  const form = new FormData();
  form.append("image", file);
  const { data } = await api.put(`/places/${placeId}/manage/image`, form, authConfig());
  return data.place;
}

export async function removePlaceImage(placeId) {
  const { data } = await api.delete(`/places/${placeId}/manage/image`, authConfig());
  return data.place;
}

// Fotos de la reseña propia (ADR-040 fase 4b; API_CONTRACT.md §4.25). Hasta 3 por reseña.
export async function uploadReviewImages(placeId, files) {
  const form = new FormData();
  files.forEach((file) => form.append("images", file));
  const { data } = await api.post(`/places/${placeId}/review/images`, form, authConfig());
  return data.images;
}

export async function deleteReviewImage(placeId, imageId) {
  const { data } = await api.delete(`/places/${placeId}/review/images/${imageId}`, authConfig());
  return data.deleted;
}

// Compartir un lugar por chat (ADR-040 fase 4c; API_CONTRACT.md §4.10). Solo se comparten
// lugares públicos y a personas con las que ya hay una conversación (la lista de personas
// sale de `GET /api/conversations`).
export async function fetchConversations(signal) {
  const { data } = await api.get("/conversations", authConfig({ signal }));
  return data.conversations;
}

export async function sharePlace(userId, placeId, content) {
  const body = { place_id: placeId };
  if (content) body.content = content;
  const { data } = await api.post(`/users/${userId}/messages`, body, authConfig());
  return data.message;
}

// Publicaciones asociadas a un lugar (ADR-040 fase 4d; API_CONTRACT.md). Exigen sesión: las
// publicaciones no son públicas. Se ven con las mismas reglas que el feed.
export async function fetchPlacePosts(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/posts`, authConfig({ signal }));
  return data.posts;
}

export async function createPlacePost(placeId, content) {
  const { data } = await api.post("/posts", { content, place_id: placeId }, authConfig());
  return data.post;
}

// Planes con amistades (ADR-040 fase 5; API_CONTRACT.md §4.27). Todo exige sesión. La lista
// de amistades (seguimiento mutuo) es a quién se puede invitar; el servidor lo vuelve a
// comprobar al crear o invitar.
export async function fetchFriends(signal) {
  const { data } = await api.get("/users/me/friends", authConfig({ signal }));
  return data.friends;
}

export async function fetchPlans(scope = "upcoming", signal) {
  const { data } = await api.get("/plans", authConfig({ params: { scope }, signal }));
  return data.plans;
}

export async function createPlan(placeId, { title, startsAt, note, userIds }) {
  const body = { title, starts_at: startsAt, user_ids: userIds };
  if (note) body.note = note;
  const { data } = await api.post(`/places/${placeId}/plans`, body, authConfig());
  return data.plan;
}

export async function respondToPlan(planId, status) {
  const { data } = await api.put(`/plans/${planId}/response`, { status }, authConfig());
  return data.plan;
}

export async function cancelPlan(planId) {
  const { data } = await api.delete(`/plans/${planId}`, authConfig());
  return data.plan;
}

export async function leavePlan(planId, userId) {
  const { data } = await api.delete(`/plans/${planId}/members/${userId}`, authConfig());
  return data;
}

// Reclamos de negocio (ADR-040 fase 6; API_CONTRACT.md §4.28). El documento viaja como archivo
// y el servidor lo guarda en un almacenamiento privado; nunca vuelve a descargarse aquí.
export async function fetchMyClaims(signal) {
  const { data } = await api.get("/users/me/claims", { ...authConfig(), signal });
  return data.claims;
}

export async function createClaim(placeId, { businessName, contactPhone, message, document }) {
  const form = new FormData();
  form.append("business_name", businessName);
  if (contactPhone) form.append("contact_phone", contactPhone);
  if (message) form.append("message", message);
  form.append("document", document);
  const { data } = await api.post(`/places/${placeId}/claims`, form, authConfig());
  return data.claim;
}

export async function withdrawClaim(claimId) {
  const { data } = await api.delete(`/claims/${claimId}`, authConfig());
  return data.claim;
}

// Panel de negocio (ADR-040 fase 7; API_CONTRACT.md §4.29). Solo responde a quien gestiona el lugar.
export async function fetchManagePanel(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/manage`, { ...authConfig(), signal });
  return data;
}

export async function updateManagedPlace(placeId, fields) {
  const { data } = await api.patch(`/places/${placeId}/manage`, fields, authConfig());
  return data.place;
}

export async function replyToReview(placeId, reviewId, body) {
  const { data } = await api.put(`/places/${placeId}/reviews/${reviewId}/reply`, { body }, authConfig());
  return data.reply;
}

export async function deleteReviewReply(placeId, reviewId) {
  const { data } = await api.delete(`/places/${placeId}/reviews/${reviewId}/reply`, authConfig());
  return data.deleted;
}

// Reservas (ADR-040 fase 8; API_CONTRACT.md §4.30). El cupo lo decide siempre el servidor.
export async function fetchMyReservations(signal) {
  const { data } = await api.get("/reservations", { ...authConfig(), signal });
  return data.reservations;
}

export async function createReservation(placeId, { startsAt, partySize, note }) {
  const body = { starts_at: startsAt, party_size: partySize };
  if (note) body.note = note;
  const { data } = await api.post(`/places/${placeId}/reservations`, body, authConfig());
  return data.reservation;
}

export async function cancelReservation(reservationId) {
  const { data } = await api.delete(`/reservations/${reservationId}`, authConfig());
  return data.reservation;
}

export async function fetchReservationSettings(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/manage/reservations/settings`, { ...authConfig(), signal });
  return data.settings;
}

export async function saveReservationSettings(placeId, settings) {
  const { data } = await api.put(`/places/${placeId}/manage/reservations/settings`, settings, authConfig());
  return data.settings;
}

export async function fetchManagedReservations(placeId, status, signal) {
  const { data } = await api.get(`/places/${placeId}/manage/reservations`, {
    ...authConfig(),
    params: { status },
    signal,
  });
  return data.reservations;
}

export async function decideReservation(placeId, reservationId, confirm) {
  const action = confirm ? "confirm" : "decline";
  const { data } = await api.post(`/places/${placeId}/manage/reservations/${reservationId}/${action}`, {}, authConfig());
  return data.reservation;
}

// Horario, cierres y huecos libres (ADR-040 fase 9; API_CONTRACT.md §4.31). Hora local de El Salvador.
export async function fetchPlaceHours(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/hours`, { ...authConfig(), signal });
  return data.schedule;
}

export async function fetchAvailability(placeId, date, signal) {
  const { data } = await api.get(`/places/${placeId}/availability`, { ...authConfig(), params: { date }, signal });
  return data.availability;
}

export async function saveHours(placeId, days) {
  const { data } = await api.put(`/places/${placeId}/manage/hours`, { days }, authConfig());
  return data.schedule;
}

export async function addClosure(placeId, date, reason) {
  const body = { date };
  if (reason) body.reason = reason;
  const { data } = await api.post(`/places/${placeId}/manage/closures`, body, authConfig());
  return data.closure;
}

export async function removeClosure(placeId, date) {
  const { data } = await api.delete(`/places/${placeId}/manage/closures/${date}`, authConfig());
  return data.deleted;
}

export async function fetchManageCalendar(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/manage/calendar`, { ...authConfig(), signal });
  return data;
}

// Cotizador (ADR-040 fase 10; API_CONTRACT.md §4.32). El cliente manda artículo y cantidad;
// el precio y el total los calcula siempre el servidor, en centavos enteros.
export async function fetchQuoteItems(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/quote-items`, { ...authConfig(), signal });
  return data.items;
}

export async function createQuote(placeId, { lines, note }) {
  const body = { lines };
  if (note) body.note = note;
  const { data } = await api.post(`/places/${placeId}/quotes`, body, authConfig());
  return data.quote;
}

export async function fetchManageQuoteItems(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/manage/quote-items`, { ...authConfig(), signal });
  return data.items;
}

export async function createQuoteItem(placeId, item) {
  const { data } = await api.post(`/places/${placeId}/manage/quote-items`, item, authConfig());
  return data.item;
}

export async function updateQuoteItem(placeId, itemId, fields) {
  const { data } = await api.patch(`/places/${placeId}/manage/quote-items/${itemId}`, fields, authConfig());
  return data.item;
}

export async function deleteQuoteItem(placeId, itemId) {
  const { data } = await api.delete(`/places/${placeId}/manage/quote-items/${itemId}`, authConfig());
  return data.deleted;
}

export async function fetchManagedQuotes(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/manage/quotes`, { ...authConfig(), signal });
  return data.quotes;
}

// Fase 11 (ADR-040): quien gestiona el lugar acepta o rechaza una cotización pendiente, y la
// cotización se descarga como PDF. El PDF lo arma el servidor con los importes ya guardados.
export async function decideQuote(placeId, quoteId, decision) {
  const { data } = await api.post(
    `/places/${placeId}/manage/quotes/${quoteId}/decision`,
    { decision },
    authConfig()
  );
  return data.quote;
}

export async function downloadQuotePdf(quoteId) {
  const { data } = await api.get(`/quotes/${quoteId}/pdf`, { ...authConfig(), responseType: "blob" });
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cotizacion-${quoteId.slice(0, 8)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Ruta hacia un lugar (ADR-040 fase 13; API_CONTRACT.md §4.33). La ubicación va en el CUERPO, no
// en la URL, para que no quede en los registros de acceso; se redondea aquí y el servidor la
// vuelve a redondear. Nunca se guarda.
export async function fetchRoute(placeId, from, profile, lang = "es") {
  const rounded = roundPoint(from);
  const { data } = await api.post(
    `/places/${placeId}/route`,
    { from_lat: rounded.lat, from_lng: rounded.lng, profile, lang },
    authConfig()
  );
  return data.route;
}

// Estadísticas del lugar para quien lo gestiona (fase 16, ADR-040 §31; API_CONTRACT.md §4.34).
// Solo conteos agregados; `null` en un valor significa «oculto por pocos datos».
export async function fetchManageAnalytics(placeId, days, signal) {
  const { data } = await api.get(`/places/${placeId}/manage/analytics`, { ...authConfig(), params: { days }, signal });
  return data.analytics;
}

// Visita anónima a la ficha (ADR-040 §33; API_CONTRACT.md §4.36). Responde 204 sin cuerpo y no
// devuelve si se contó. Con sesión solo se envía el token para que el servidor NO cuente a quien
// gestiona el lugar; nunca se guarda quién visitó.
export async function recordPlaceVisit(placeId, event, signal) {
  await api.post(`/places/${placeId}/visits`, { event }, authConfig({ signal }));
}

// Pulse del lugar (ADR-040 §32): solo un nivel de actividad reciente, público; `null` si hay poca.
export async function fetchPlacePulse(placeId, signal) {
  const { data } = await api.get(`/places/${placeId}/pulse`, { signal });
  return data.pulse;
}
