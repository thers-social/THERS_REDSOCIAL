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
};

export type TeroReply = {
  text: string;
  mood: TeroMood;
  isMock: boolean;
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
