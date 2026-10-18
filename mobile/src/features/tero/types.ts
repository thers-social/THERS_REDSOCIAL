/**
 * Tipos de Tero, la mascota y asistente de THERS (docs/tero/).
 *
 * Fase 1: solo interfaz con datos de ejemplo. Los tipos de mensaje y de
 * contexto anticipan el contrato de `POST /api/tero/chat` (fase 3), que todavía
 * NO existe ni está aprobado (ADR-041 pendiente): cuando el contrato real se
 * apruebe, estos tipos se ajustan a él y no al revés.
 */

/** Estados lógicos del avatar (`TERO_RESEARCH.md`). La fase 2 los mapea a Rive. */
export type TeroMood =
  | 'idle'
  | 'attention'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'error'
  | 'sleeping';

export type TeroSide = 'left' | 'right';

/**
 * Preferencias LOCALES y no sensibles de Tero. Nunca tokens, contraseñas ni datos
 * de otras personas: viven en AsyncStorage, que no está cifrado.
 *
 * `version` y `updatedAt` existen para una futura sincronización con el
 * servidor: permiten migrar el formato y decidir cuál de dos copias es la más
 * reciente sin adivinar.
 */
export type TeroPreferences = {
  version: 1;
  /** Muestra la burbuja flotante sobre las pestañas. */
  showTero: boolean;
  /** Borde de la pantalla al que se pega la burbuja. */
  side: TeroSide;
  /** Altura de la burbuja como fracción (0–1) del espacio disponible. */
  verticalRatio: number;
  /** Animaciones propias de Tero. El "reducir movimiento" del sistema manda igual. */
  animations: boolean;
  /** Reservado: Tero aún no reproduce sonidos. */
  sounds: boolean;
  /** Tero lee en voz alta sus respuestas (ADR-045). Se apaga con el botón de la conversación. */
  speakReplies: boolean;
  /** Voz del sistema elegida para Tero; `null` = la mejor disponible (automática). */
  voiceId: string | null;
  /** Igual, para las respuestas en inglés. */
  voiceIdEn: string | null;
  /** Solo español por ahora: la app móvil no tiene i18n todavía. */
  language: 'es';
  /** ISO 8601 de la última modificación local. */
  updatedAt: string;
};

/**
 * Contexto mínimo de una pregunta: desde qué pantalla y sobre qué entidad.
 * El servidor NO debe confiar en `entityId` (lo revalidará en la fase 4).
 */
export type TeroContext = {
  screen: 'home' | 'tero' | 'post';
  entityType?: 'post';
  entityId?: string;
};

export type TeroMessage = {
  id: string;
  role: 'user' | 'tero';
  text: string;
  createdAt: string;
  /** `true` en las respuestas de ejemplo de la fase 1 (sin IA real). */
  isMock?: boolean;
  /** Acciones que Tero preparó con esta respuesta y esperan confirmación (solo mensajes de Tero). */
  cards?: TeroActionCard[];
  /** Solo en los mensajes de la persona: en camino, entregado o fallido. */
  status?: TeroMessageStatus;
};

export type TeroMessageStatus = 'sending' | 'sent' | 'failed';

/** Acciones que Tero puede PREPARAR (ADR-041 §6.2). Nunca las ejecuta: las confirma la persona. */
export type TeroActionKind = 'follow_user' | 'unfollow_user' | 'update_profile';

/**
 * Una acción que Tero preparó y que NO se ha hecho. `summary` lo redacta el servidor a partir de
 * datos ya validados: lo que se muestra es exactamente lo que se ejecutará al confirmar.
 */
export type TeroActionCard = {
  id: string;
  kind: TeroActionKind;
  summary: string;
  /** ISO 8601. Pasado ese momento el servidor ya no la ejecuta (10 minutos). */
  expiresAt: string;
};

/**
 * Estado de una tarjeta en pantalla. `pending` es el único en que se puede confirmar o cancelar;
 * `confirming`/`cancelling` bloquean los botones mientras la petición está en camino.
 */
export type TeroCardStatus =
  | 'pending'
  | 'confirming'
  | 'cancelling'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'unavailable';

export type TeroCardState = {
  status: TeroCardStatus;
  /** Texto bajo la tarjeta (resultado o motivo). Solo para mostrar. */
  note?: string;
};

/** De dónde salió el texto de una respuesta (`source` del servidor). */
export type TeroReplySource = 'ai' | 'disabled' | 'budget' | 'refused';

export type TeroReply = {
  text: string;
  mood: TeroMood;
  isMock: boolean;
  /** Tarjetas de confirmación que acompañan a la respuesta. Vacío en las de ejemplo. */
  cards?: TeroActionCard[];
  source?: TeroReplySource;
};

export type TeroSummaryMetric = {
  id: string;
  label: string;
  value: number;
  /** Variación respecto del periodo anterior, en porcentaje. */
  delta: number;
};

export type TeroSummary = {
  periodLabel: string;
  metrics: TeroSummaryMetric[];
  highlights: string[];
  isMock: boolean;
};
