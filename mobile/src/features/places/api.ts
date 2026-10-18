/**
 * Cliente de THERS Places (contrato: `API_CONTRACT.md` §4.23, §4.24 y §4.25, ADR-040).
 *
 * Todas las llamadas van autenticadas: la app solo muestra estas pantallas con sesión y así
 * el servidor marca `is_saved`. Las coordenadas se redondean a 3 decimales aquí, ANTES de
 * salir (ADR-040 §4.4).
 */

import { request } from '@shared/lib/api';
import { appendMedia, MEDIA_UPLOAD_TIMEOUT_MS } from '@shared/media/mediaForm';
import type { PickedMedia } from '@shared/media/mediaRules';

import { roundPoint, roundPointFine } from './coordinates';
import type { ReportReason } from './placeReasons';
import type { Post } from '@features/posts/types';

import type {
  Availability,
  CalendarDay,
  LatLng,
  ManageAnalytics,
  RoutePlan,
  ManagedPlace,
  ManageStats,
  PlaceCategory,
  PlaceDetail,
  PlanPerson,
  Plan,
  PlaceReview,
  PlaceSummary,
  Quote,
  QuoteItem,
  QuoteUnit,
  Reservation,
  ReservationSettings,
  ReviewReply,
  ReviewSummary,
  Schedule,
  ScheduleDay,
} from './types';

type Query = Record<string, string | number | undefined>;

function withQuery(path: string, query: Query): string {
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

export async function fetchCategories(signal?: AbortSignal): Promise<PlaceCategory[]> {
  const { categories } = await request<{ categories: PlaceCategory[] }>('/places/categories', {
    authenticated: true,
    signal,
  });
  return categories;
}

/** Los mejor valorados (`GET /api/places/top`, ADR-053), opcionalmente de una categoría. Sin ubicación. */
export async function fetchTopPlaces(category?: string, signal?: AbortSignal): Promise<PlaceSummary[]> {
  const { places } = await request<{ places: PlaceSummary[] }>(
    withQuery('/places/top', { category, limit: 8 }),
    { authenticated: true, signal },
  );
  return places;
}

export async function fetchNearby(
  params: { origin: LatLng; radius: number; category?: string; limit: number },
  signal?: AbortSignal,
): Promise<PlaceSummary[]> {
  const point = roundPoint(params.origin);
  const { places } = await request<{ places: PlaceSummary[] }>(
    withQuery('/places/nearby', {
      lat: point.lat,
      lng: point.lng,
      radius: Math.round(params.radius),
      category: params.category,
      limit: params.limit,
    }),
    { authenticated: true, signal },
  );
  return places;
}

export async function searchPlaces(
  params: { q: string; origin?: LatLng; category?: string; limit: number },
  signal?: AbortSignal,
): Promise<PlaceSummary[]> {
  const point = params.origin ? roundPoint(params.origin) : undefined;
  const { places } = await request<{ places: PlaceSummary[] }>(
    withQuery('/places/search', {
      q: params.q,
      lat: point?.lat,
      lng: point?.lng,
      category: params.category,
      limit: params.limit,
    }),
    { authenticated: true, signal },
  );
  return places;
}

export async function fetchPlace(id: string, signal?: AbortSignal): Promise<PlaceDetail> {
  const { place } = await request<{ place: PlaceDetail }>(`/places/${id}`, {
    authenticated: true,
    signal,
  });
  return place;
}

export async function savePlace(id: string): Promise<boolean> {
  const { saved } = await request<{ saved: boolean }>(`/places/${id}/save`, {
    method: 'POST',
    authenticated: true,
  });
  return saved;
}

export async function unsavePlace(id: string): Promise<boolean> {
  const { saved } = await request<{ saved: boolean }>(`/places/${id}/save`, {
    method: 'DELETE',
    authenticated: true,
  });
  return saved;
}

export function reportPlace(
  id: string,
  report: { reason: ReportReason; details?: string },
): Promise<unknown> {
  return request(`/places/${id}/report`, {
    method: 'POST',
    authenticated: true,
    body: report,
  });
}

export function fetchReviews(
  placeId: string,
  signal?: AbortSignal,
): Promise<{ reviews: PlaceReview[]; has_more: boolean; summary: ReviewSummary }> {
  return request(`/places/${placeId}/reviews`, { authenticated: true, signal });
}

export async function writeReview(
  placeId: string,
  review: { rating: number; body: string | null },
): Promise<PlaceReview> {
  const { review: saved } = await request<{ review: PlaceReview }>(`/places/${placeId}/review`, {
    method: 'PUT',
    authenticated: true,
    body: review,
  });
  return saved;
}

export async function deleteReview(placeId: string): Promise<boolean> {
  const { deleted } = await request<{ deleted: boolean }>(`/places/${placeId}/review`, {
    method: 'DELETE',
    authenticated: true,
  });
  return deleted;
}

// Planes con amistades (ADR-040 fase 5; `API_CONTRACT.md` §4.27). El servidor valida de nuevo
// quién es amistad al crear o invitar.
export async function fetchFriends(signal?: AbortSignal): Promise<PlanPerson[]> {
  const { friends } = await request<{ friends: PlanPerson[] }>('/users/me/friends', {
    authenticated: true,
    signal,
  });
  return friends;
}

export async function fetchUpcomingPlans(signal?: AbortSignal): Promise<Plan[]> {
  const { plans } = await request<{ plans: Plan[] }>('/plans?scope=upcoming', {
    authenticated: true,
    signal,
  });
  return plans;
}

export async function createPlan(
  placeId: string,
  plan: { title: string; starts_at: string; note?: string; user_ids: string[] },
): Promise<Plan> {
  const { plan: created } = await request<{ plan: Plan }>(`/places/${placeId}/plans`, {
    method: 'POST',
    authenticated: true,
    body: plan,
  });
  return created;
}

export async function respondToPlan(planId: string, status: 'going' | 'declined'): Promise<Plan> {
  const { plan } = await request<{ plan: Plan }>(`/plans/${planId}/response`, {
    method: 'PUT',
    authenticated: true,
    body: { status },
  });
  return plan;
}

export async function cancelPlan(planId: string): Promise<Plan> {
  const { plan } = await request<{ plan: Plan }>(`/plans/${planId}`, {
    method: 'DELETE',
    authenticated: true,
  });
  return plan;
}

export async function leavePlan(planId: string, userId: string): Promise<void> {
  await request(`/plans/${planId}/members/${userId}`, { method: 'DELETE', authenticated: true });
}

// Publicaciones asociadas a un lugar (fase 4d; `API_CONTRACT.md` §4.26). Para publicar con un
// lugar se usa `createPost(..., placeId)` de `@features/posts/api`.
export async function fetchPlacePosts(placeId: string, signal?: AbortSignal): Promise<Post[]> {
  const { posts } = await request<{ posts: Post[] }>(`/places/${placeId}/posts`, {
    authenticated: true,
    signal,
  });
  return posts;
}

// Reservas de una persona (fase 8; `API_CONTRACT.md` §4.30). El servidor decide el cupo.
export async function fetchMyReservations(signal?: AbortSignal): Promise<Reservation[]> {
  const { reservations } = await request<{ reservations: Reservation[] }>('/reservations', {
    authenticated: true,
    signal,
  });
  return reservations;
}

export async function createReservation(
  placeId: string,
  reservation: { starts_at: string; party_size: number; note?: string },
): Promise<Reservation> {
  const { reservation: created } = await request<{ reservation: Reservation }>(
    `/places/${placeId}/reservations`,
    { method: 'POST', authenticated: true, body: reservation },
  );
  return created;
}

export async function cancelReservation(reservationId: string): Promise<void> {
  await request(`/reservations/${reservationId}`, { method: 'DELETE', authenticated: true });
}

// Horario y disponibilidad (fase 9; §4.31).
export async function fetchSchedule(placeId: string, signal?: AbortSignal): Promise<Schedule> {
  const { schedule } = await request<{ schedule: Schedule }>(`/places/${placeId}/hours`, {
    authenticated: true,
    signal,
  });
  return schedule;
}

export async function fetchAvailability(
  placeId: string,
  date: string,
  signal?: AbortSignal,
): Promise<Availability> {
  const { availability } = await request<{ availability: Availability }>(
    withQuery(`/places/${placeId}/availability`, { date }),
    { authenticated: true, signal },
  );
  return availability;
}

// Cotizador de una persona (fase 10; §4.32). El cliente manda solo `item_id` y `quantity`.
export async function fetchQuoteItems(placeId: string, signal?: AbortSignal): Promise<QuoteItem[]> {
  const { items } = await request<{ items: QuoteItem[] }>(`/places/${placeId}/quote-items`, {
    authenticated: true,
    signal,
  });
  return items;
}

export async function createQuote(
  placeId: string,
  quote: { lines: { item_id: string; quantity: number }[]; note?: string },
): Promise<Quote> {
  const { quote: created } = await request<{ quote: Quote }>(`/places/${placeId}/quotes`, {
    method: 'POST',
    authenticated: true,
    body: quote,
  });
  return created;
}

export async function fetchMyQuotes(signal?: AbortSignal): Promise<Quote[]> {
  const { quotes } = await request<{ quotes: Quote[] }>('/quotes', { authenticated: true, signal });
  return quotes;
}

// --- Panel de negocio (fase 7 en adelante). Todo exige ser gestor; si no, el servidor da 404. ---

export async function fetchManagedPlaces(signal?: AbortSignal): Promise<ManagedPlace[]> {
  const { places } = await request<{ places: ManagedPlace[] }>('/users/me/managed-places', {
    authenticated: true,
    signal,
  });
  return places;
}

export function fetchManage(
  placeId: string,
  signal?: AbortSignal,
): Promise<{ place: PlaceDetail; stats: ManageStats }> {
  return request(`/places/${placeId}/manage`, { authenticated: true, signal });
}

/**
 * Imagen que identifica al lugar (`ADR-046`): la sube quien lo gestiona. `PUT` multipart con el archivo en
 * el campo `image`; el servidor la decodifica por su contenido, la reduce y la guarda sin metadatos.
 */
export async function uploadPlaceImage(placeId: string, media: PickedMedia): Promise<PlaceDetail> {
  const form = new FormData();
  appendMedia(form, 'image', media);
  const { place } = await request<{ place: PlaceDetail }>(`/places/${placeId}/manage/image`, {
    method: 'PUT',
    authenticated: true,
    body: form,
    timeoutMs: MEDIA_UPLOAD_TIMEOUT_MS,
  });
  return place;
}

export async function removePlaceImage(placeId: string): Promise<PlaceDetail> {
  const { place } = await request<{ place: PlaceDetail }>(`/places/${placeId}/manage/image`, {
    method: 'DELETE',
    authenticated: true,
  });
  return place;
}

/** Solo viajan los cuatro campos que un gestor puede cambiar; el servidor ignora el resto. */
export async function updateManagedPlace(
  placeId: string,
  fields: {
    description?: string | null;
    address?: string | null;
    phone?: string | null;
    website?: string | null;
  },
): Promise<PlaceDetail> {
  const { place } = await request<{ place: PlaceDetail }>(`/places/${placeId}/manage`, {
    method: 'PATCH',
    authenticated: true,
    body: fields,
  });
  return place;
}

export async function replyToReview(
  placeId: string,
  reviewId: string,
  body: string,
): Promise<ReviewReply> {
  const { reply } = await request<{ reply: ReviewReply }>(
    `/places/${placeId}/reviews/${reviewId}/reply`,
    { method: 'PUT', authenticated: true, body: { body } },
  );
  return reply;
}

export async function deleteReviewReply(placeId: string, reviewId: string): Promise<void> {
  await request(`/places/${placeId}/reviews/${reviewId}/reply`, {
    method: 'DELETE',
    authenticated: true,
  });
}

export async function fetchReservationSettings(
  placeId: string,
  signal?: AbortSignal,
): Promise<ReservationSettings> {
  const { settings } = await request<{ settings: ReservationSettings }>(
    `/places/${placeId}/manage/reservations/settings`,
    { authenticated: true, signal },
  );
  return settings;
}

export async function saveReservationSettings(
  placeId: string,
  settings: Partial<ReservationSettings>,
): Promise<ReservationSettings> {
  const { settings: saved } = await request<{ settings: ReservationSettings }>(
    `/places/${placeId}/manage/reservations/settings`,
    { method: 'PUT', authenticated: true, body: settings },
  );
  return saved;
}

export async function fetchManagedReservations(
  placeId: string,
  status?: string,
  signal?: AbortSignal,
): Promise<Reservation[]> {
  const { reservations } = await request<{ reservations: Reservation[] }>(
    withQuery(`/places/${placeId}/manage/reservations`, { status, limit: 50 }),
    { authenticated: true, signal },
  );
  return reservations;
}

export async function decideReservation(
  placeId: string,
  reservationId: string,
  decision: 'confirm' | 'decline',
  note?: string,
): Promise<void> {
  await request(`/places/${placeId}/manage/reservations/${reservationId}/${decision}`, {
    method: 'POST',
    authenticated: true,
    body: note ? { note } : {},
  });
}

export async function saveSchedule(placeId: string, days: ScheduleDay[]): Promise<void> {
  await request(`/places/${placeId}/manage/hours`, {
    method: 'PUT',
    authenticated: true,
    body: { days },
  });
}

export async function addClosure(placeId: string, date: string, reason?: string): Promise<void> {
  await request(`/places/${placeId}/manage/closures`, {
    method: 'POST',
    authenticated: true,
    body: { date, ...(reason ? { reason } : {}) },
  });
}

export async function removeClosure(placeId: string, date: string): Promise<void> {
  await request(`/places/${placeId}/manage/closures/${date}`, {
    method: 'DELETE',
    authenticated: true,
  });
}

export async function fetchCalendar(placeId: string, signal?: AbortSignal): Promise<CalendarDay[]> {
  const { days } = await request<{ days: CalendarDay[] }>(`/places/${placeId}/manage/calendar`, {
    authenticated: true,
    signal,
  });
  return days;
}

export async function fetchManagedQuoteItems(
  placeId: string,
  signal?: AbortSignal,
): Promise<QuoteItem[]> {
  const { items } = await request<{ items: QuoteItem[] }>(`/places/${placeId}/manage/quote-items`, {
    authenticated: true,
    signal,
  });
  return items;
}

export type QuoteItemInput = {
  name: string;
  description?: string;
  unit: QuoteUnit;
  unit_price_cents: number;
};

export async function createQuoteItem(placeId: string, item: QuoteItemInput): Promise<void> {
  await request(`/places/${placeId}/manage/quote-items`, {
    method: 'POST',
    authenticated: true,
    body: item,
  });
}

export async function setQuoteItemActive(
  placeId: string,
  itemId: string,
  isActive: boolean,
): Promise<void> {
  await request(`/places/${placeId}/manage/quote-items/${itemId}`, {
    method: 'PATCH',
    authenticated: true,
    body: { is_active: isActive },
  });
}

export async function deleteQuoteItem(placeId: string, itemId: string): Promise<void> {
  await request(`/places/${placeId}/manage/quote-items/${itemId}`, {
    method: 'DELETE',
    authenticated: true,
  });
}

export async function fetchManagedQuotes(placeId: string, signal?: AbortSignal): Promise<Quote[]> {
  const { quotes } = await request<{ quotes: Quote[] }>(
    withQuery(`/places/${placeId}/manage/quotes`, { limit: 50 }),
    { authenticated: true, signal },
  );
  return quotes;
}

/** Fase 11: acepta o rechaza una cotización pendiente y vigente (solo cambia su estado). */
export async function decideQuote(
  placeId: string,
  quoteId: string,
  decision: 'accepted' | 'rejected',
): Promise<Quote> {
  const { quote } = await request<{ quote: Quote }>(
    `/places/${placeId}/manage/quotes/${quoteId}/decision`,
    { method: 'POST', authenticated: true, body: { decision } },
  );
  return quote;
}

/**
 * Ruta hacia un lugar (fase 13; `API_CONTRACT.md` §4.33). La ubicación va en el CUERPO, no en la
 * URL, para que no quede en los registros de acceso. El servidor la vuelve a redondear y no la guarda.
 */
export async function fetchRoute(
  placeId: string,
  from: LatLng,
  profile: 'walk' | 'bike' | 'car',
  signal?: AbortSignal,
  /** `high` solo para recalcular en la navegación en vivo (ADR-040 §30): origen a ~11 m. */
  precision: 'normal' | 'high' = 'normal',
): Promise<RoutePlan> {
  const rounded = precision === 'high' ? roundPointFine(from) : roundPoint(from); // el servidor lo vuelve a redondear
  const { route } = await request<{ route: RoutePlan }>(`/places/${placeId}/route`, {
    method: 'POST',
    authenticated: true,
    body: {
      from_lat: rounded.lat,
      from_lng: rounded.lng,
      profile,
      lang: 'es',
      ...(precision === 'high' ? { precision } : {}),
    },
    signal,
  });
  return route;
}

/** Estadísticas del lugar para quien lo gestiona (fase 16; `API_CONTRACT.md` §4.34). */
export async function fetchManageAnalytics(
  placeId: string,
  days: 7 | 30 | 90,
  signal?: AbortSignal,
): Promise<ManageAnalytics> {
  const { analytics } = await request<{ analytics: ManageAnalytics }>(
    withQuery(`/places/${placeId}/manage/analytics`, { days }),
    { authenticated: true, signal },
  );
  return analytics;
}

// Visita anónima a la ficha (`API_CONTRACT.md` §4.36): 204 sin cuerpo. Con sesión solo se envía el
// token para que el servidor NO cuente a quien gestiona el lugar; nunca se guarda quién visitó.
export async function recordPlaceVisit(placeId: string, event: string, signal?: AbortSignal): Promise<void> {
  await request<void>(`/places/${placeId}/visits`, {
    method: 'POST',
    authenticated: true,
    body: { event },
    signal,
  });
}

// Pulse del lugar (`API_CONTRACT.md` §4.35): público; `level` es null con poca actividad.
export async function fetchPlacePulse(
  placeId: string,
  signal?: AbortSignal,
): Promise<{ level: string | null; window_days: number }> {
  const { pulse } = await request<{ pulse: { level: string | null; window_days: number } }>(
    `/places/${placeId}/pulse`,
    { authenticated: true, signal },
  );
  return pulse;
}
