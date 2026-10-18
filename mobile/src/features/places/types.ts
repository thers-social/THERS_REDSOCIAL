/** Tipos de THERS Places en la app. Contrato: `API_CONTRACT.md` §4.23 y §4.24 (ADR-040). */

/** Tarjeta de un lugar compartido por chat (ADR-040 fase 4c); `available:false` = ya no es público. */
export type SharedPlace =
  | { id: string; available: false }
  | {
      id: string;
      available: true;
      name: string;
      category: { slug: string; name: string };
      municipality: string | null;
      department: string | null;
    };

export type PlaceCategory = { id: string; slug: string; name: string };

/** Resumen (lista, `nearby`, búsqueda). `distance_meters` solo con un punto de origen. */
export type PlaceSummary = {
  id: string;
  name: string;
  slug: string;
  category: PlaceCategory;
  latitude: number;
  longitude: number;
  verification_status: string;
  address: string | null;
  /** Siempre `null` hasta que haya fotos de lugares (fase 4b). */
  cover_image_url: string | null;
  is_saved: boolean;
  /** Promedio de reseñas (un decimal), o `null` si no hay ninguna. Lo calcula el servidor. */
  rating_average: number | null;
  reviews_count: number;
  distance_meters?: number;
};

export type PlaceDetail = PlaceSummary & {
  description: string | null;
  municipality: string | null;
  department: string | null;
  phone: string | null;
  website: string | null;
  source: string;
  coordinate_source: string;
  last_verified_at: string | null;
  /** Fases 6 y 8: alguien gestiona el lugar / yo lo gestiono / acepta reservas. */
  is_claimed?: boolean;
  managed_by_me?: boolean;
  accepts_reservations?: boolean;
  /** Fase 13: el servidor tiene proveedor de rutas («Cómo llegar»). */
  routing_available?: boolean;
};

/** Una indicación calle por calle (fase 13). `at` es `[lng, lat]` del punto donde empieza. */
export type RouteStep = {
  instruction: string;
  street: string | null;
  distance_m: number;
  duration_s: number;
  type: number | null;
  at: [number, number];
};

/** Ruta hacia un lugar (fase 13). `coordinates` son pares `[lng, lat]`. */
export type RoutePlan = {
  profile: 'walk' | 'bike' | 'car';
  provider: string;
  distance_m: number;
  duration_s: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  /** Indicaciones calle por calle; vacías si el proveedor no las dio. */
  steps: RouteStep[];
  lang: 'es' | 'en';
};

export type LatLng = { lat: number; lng: number };

/** Estados de la vista; se resuelven en `viewState.ts`. */
export type ViewState = 'loading' | 'offline' | 'error' | 'empty' | 'success';

/** Estado del permiso de ubicación. Rechazarlo no desactiva nada. */
export type LocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'timeout';

export type ReviewImage = { id: string; url: string; width: number; height: number };

/** Reseñas (fase 4a, `API_CONTRACT.md` §4.25). */
export type PlaceReview = {
  id: string;
  rating: number;
  body: string | null;
  created_at: string;
  updated_at: string;
  is_mine: boolean;
  /** Solo en la reseña propia: la moderación pudo ocultarla. */
  hidden?: boolean;
  /** Fotos de la reseña (máx. 3). La app solo las muestra; subirlas se hace desde la web. */
  images: ReviewImage[];
  /** Respuesta pública del negocio (fase 7), o `null`. */
  reply?: ReviewReply | null;
  author: { id: string; username: string; name: string; avatar_url: string | null };
};

export type ReviewSummary = { average: number | null; count: number };

/** Planes con amistades (fase 5, `API_CONTRACT.md` §4.27). */
export type PlanMemberStatus = 'going' | 'invited' | 'declined';

export type PlanPerson = { id: string; username: string; name: string; avatar_url: string | null };

export type Plan = {
  id: string;
  title: string;
  note: string | null;
  starts_at: string;
  status: 'active' | 'cancelled';
  /** `available: false` cuando el lugar ya no es público (solo trae el id). */
  place: { id: string; available: boolean; name?: string };
  creator: PlanPerson;
  my_status: PlanMemberStatus;
  members: (PlanPerson & { status: PlanMemberStatus })[];
  counts: Record<PlanMemberStatus, number>;
};

/** Respuesta pública del negocio a una reseña (fase 7). */
export type ReviewReply = { body: string; created_at: string; updated_at: string };

/** Tarjeta del lugar que viaja en reservas y cotizaciones (`API_CONTRACT.md` §4.26). */
export type PlaceCard = { id: string; available: boolean; name?: string };

/** Panel de negocio (fase 7, `API_CONTRACT.md` §4.29). */
export type ManagedPlace = {
  id: string;
  name: string;
  municipality: string | null;
  department: string | null;
  category: { slug: string; name: string };
  is_public: boolean;
  rating_average: number | null;
  reviews_count: number;
};

export type ManageStats = {
  saves: number;
  reviews: number;
  rating_average: number | null;
  reviews_without_reply: number;
  upcoming_plans: number;
};

/** Reservas (fase 8, `API_CONTRACT.md` §4.30). */
export type ReservationStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled';

export type Reservation = {
  id: string;
  starts_at: string;
  party_size: number;
  note: string | null;
  status: ReservationStatus;
  decision_note: string | null;
  created_at: string;
  place: PlaceCard;
  /** Solo en la bandeja del negocio. */
  user?: PlanPerson;
};

export type ReservationSettings = { enabled: boolean; capacity: number; max_party_size: number };

/** Horario, cierres y disponibilidad (fase 9, `API_CONTRACT.md` §4.31). */
export type HourInterval = { opens: string; closes: string };
export type ScheduleDay = { weekday: number; intervals: HourInterval[] };
export type Closure = { date: string; reason: string | null };
export type Schedule = { timezone: string; days: ScheduleDay[]; closures: Closure[] };

export type Availability = {
  date: string;
  accepts_reservations: boolean;
  /** `true`: el lugar no cargó su horario y se ofrece el horario por defecto (`ADR-051`). */
  default_hours?: boolean;
  max_party_size?: number;
  slots: { starts_at: string; seats_left: number }[];
};

export type CalendarDay = {
  date: string;
  closed: boolean;
  closure_reason: string | null;
  intervals: HourInterval[];
  reservations: { pending: number; confirmed: number; people: number };
};

/** Cotizador (fase 10, `API_CONTRACT.md` §4.32). Todo el dinero llega como texto del servidor. */
export type Money = { cents: number; amount: string; currency: string };
export type QuoteUnit = 'person' | 'unit' | 'hour';

export type QuoteItem = {
  id: string;
  name: string;
  description: string | null;
  unit: QuoteUnit;
  unit_price: Money;
  is_active: boolean;
};

export type QuoteStatus = 'pending' | 'accepted' | 'rejected';

export type Quote = {
  id: string;
  /** Fase 11: el negocio la acepta o rechaza; no cobra ni cambia el total. */
  status: QuoteStatus;
  decided_at: string | null;
  total: Money;
  note: string | null;
  valid_until: string;
  created_at: string;
  reservation_id: string | null;
  place: PlaceCard;
  lines: { name: string; unit: QuoteUnit; unit_price: Money; quantity: number; line_total: Money }[];
  /** Solo en la bandeja del negocio. */
  user?: { id: string; username: string; name: string };
};

/** Estadísticas del panel de negocio (fase 16, ADR-040 §31). Solo conteos; `null` = oculto por pocos datos. */
export type ManageAnalytics = {
  range: { days: number; from: string; to: string; previous_from: string; previous_to: string; timezone: string };
  min_count: number;
  hidden: ('saves' | 'plans' | 'visits')[];
  series: ({ date: string } & Record<'views' | 'reviews' | 'reservations' | 'quotes' | 'posts' | 'saves' | 'plans', number | null>)[];
  totals: {
    reviews: number;
    rating_average: number | null;
    reservations: { requested: number; confirmed: number; declined: number; cancelled: number; pending: number; people_confirmed: number };
    quotes: { requested: number; accepted: number; rejected: number; pending: number; accepted_value: Money };
    // Visitas anónimas (ADR-040 §33): `null` si el periodo suma menos del mínimo.
    visits: { views: number; phone: number; website: number; directions: number; conversion_percent: number | null } | null;
    posts: number;
    saves: number | null;
    plans: number | null;
  };
  previous: Record<'views' | 'reviews' | 'reservations' | 'quotes' | 'posts' | 'saves' | 'plans', number | null>;
  change: Record<'views' | 'reviews' | 'reservations' | 'quotes' | 'posts' | 'saves' | 'plans', number | null>;
};
