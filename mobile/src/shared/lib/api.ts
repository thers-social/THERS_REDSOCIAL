/**
 * Cliente HTTP de la app móvil.
 *
 * Decisiones (THERS_PROMPT_CLAUDE_ANDROID.md §5/§7, ADR-016, ADR-017):
 * - `fetch` nativo, sin axios ni TanStack Query todavía. El encargo pide un
 *   "cliente HTTP pequeño" y no instalar dependencias del roadmap antes de
 *   tener un consumidor real. TanStack Query entra cuando haya feed con caché
 *   y paginación (ROADMAP fase 3), no antes.
 * - URL centralizada en una sola variable (`EXPO_PUBLIC_API_URL`).
 * - Timeout y cancelación obligatorios: sin ellos una petición en una red mala
 *   queda colgada para siempre y la pantalla miente.
 * - Errores traducidos al contrato real del backend: `{"msg": "..."}` con
 *   `400/401/403/409` (API_CONTRACT.md §3). No se inventa un formato nuevo.
 * - SIN reintentos ciegos. Reintentar un POST que crea datos duplica datos.
 *   La única excepción es la renovación de sesión (ADR-017 §4.4): ante un `401`
 *   de una petición autenticada se renueva el token UNA vez y se repite la
 *   petición UNA vez. Es seguro porque un `401` significa que el servidor
 *   rechazó la petición antes de ejecutarla.
 * - Una sola renovación en vuelo: si varias peticiones reciben `401` a la vez,
 *   todas esperan la misma. Renovar en paralelo gastaría el refresh (un solo
 *   uso) dos veces, y el servidor lo tomaría por un robo y cortaría la sesión.
 *
 * Importante: las peticiones nativas de React Native NO pasan por el modelo
 * CORS del navegador (RN docs, "Network"). Si algo falla en el teléfono, se
 * revisa IP/firewall/TLS/`Authorization` -- nunca se toca `CORS(app)` del
 * backend, que existe para el Frontend web.
 */

import type { RefreshResponse } from '@features/auth/types';

import { clearSession, getRefreshToken, getToken, setSession } from './session';

const DEV_FALLBACK_API_URL = 'http://127.0.0.1:5000/api';

/**
 * `EXPO_PUBLIC_*` queda embebida en el bundle y es legible por cualquiera que
 * tenga el APK. Eso está bien para una URL; NUNCA debe usarse para
 * `JWT_SECRET_KEY`, `DATABASE_URL`, `RESEND_API_KEY`, claves S3 ni secretos
 * de LiveKit -- esos viven solo en el servidor (HB-001 §19.1/§20).
 *
 * El fallback a `127.0.0.1` solo sirve para el emulador o web. En un teléfono
 * físico, `127.0.0.1` es el teléfono mismo: hay que definir la IP LAN del
 * equipo de desarrollo (ver docs/mobile/ANDROID_SETUP.md §5).
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEV_FALLBACK_API_URL;

if (!process.env.EXPO_PUBLIC_API_URL) {
  console.warn(
    '[api] EXPO_PUBLIC_API_URL no está definida; usando ' +
      DEV_FALLBACK_API_URL +
      '. En un dispositivo físico eso apunta al propio teléfono: definir la IP ' +
      'LAN del equipo en mobile/.env (ver docs/mobile/ANDROID_SETUP.md §5).',
  );
}

const DEFAULT_TIMEOUT_MS = 15000;
const LOGOUT_TIMEOUT_MS = 5000;

const NETWORK_ERROR_MESSAGE = 'No pudimos conectar con THERS. Revisá tu conexión e intentá de nuevo.';

/** Error de API con el código HTTP y el mensaje que el backend devolvió. */
export class ApiError extends Error {
  readonly status: number;
  /** `true` cuando nunca hubo respuesta (sin red, host inalcanzable, timeout). */
  readonly isNetworkError: boolean;
  /** Cuerpo crudo, para los casos que traen campos extra (p. ej. `email_verified`). */
  readonly body: unknown;

  constructor(
    message: string,
    status: number,
    options: { isNetworkError?: boolean; body?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isNetworkError = options.isNetworkError ?? false;
    this.body = options.body;
  }

  /**
   * `true` si la sesión ya no vale. El backend homogeneiza "sin token", "token
   * inválido" y "token expirado" a `401` con callbacks propios
   * (`app/extensions.py`), así que no hay que distinguir `422` como haría
   * `flask_jwt_extended` por defecto.
   *
   * Desde ADR-017, `request()` ya intentó renovar el access token antes de
   * lanzar esto: si llega acá, la sesión realmente terminó (refresh revocado,
   * expirado o ausente), no un simple access vencido.
   */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

function networkError(): ApiError {
  return new ApiError(NETWORK_ERROR_MESSAGE, 0, { isNetworkError: true });
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Cuerpo `multipart/form-data` (subida de archivos). Excluyente con `body`. React Native fija el
   * `Content-Type` con su boundary: no se escribe a mano. */
  form?: FormData;
  /** Adjunta el `Authorization: Bearer <token>` de SecureStore. */
  authenticated?: boolean;
  timeoutMs?: number;
  /** Permite cancelar desde el llamador (p. ej. al desmontar una pantalla). */
  signal?: AbortSignal;
  /** La respuesta es un archivo: devuelve sus bytes en vez de JSON (los errores siguen siendo JSON). */
  binary?: boolean;
};

/**
 * `fetch` con timeout y cancelación combinados. Un fallo sin respuesta (sin
 * red, host inalcanzable, timeout) se traduce a `ApiError` de red; una
 * cancelación del llamador se propaga tal cual (no es un error a mostrar).
 */
async function fetchWithTimeout(
  path: string,
  init: { method: string; headers: Record<string, string>; body?: string | FormData },
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  try {
    return await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    throw networkError();
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

// --- Renovación de sesión (ADR-017) ----------------------------------------

/**
 * - `ok`: hay un par de tokens nuevo ya guardado.
 * - `invalid`: el servidor rechazó el refresh (revocado, expirado, ya usado) o
 *   no hay ninguno. La sesión local ya se borró: hay que volver al login.
 * - `unavailable`: no se pudo saber (sin red, timeout, `5xx`). La sesión NO se
 *   toca: puede seguir siendo válida (ADR-017 §4.4, perder señal no es logout).
 */
type RefreshOutcome = 'ok' | 'invalid' | 'unavailable';

let refreshInFlight: Promise<RefreshOutcome> | null = null;

async function performRefresh(): Promise<RefreshOutcome> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return 'invalid';

  let response: Response;
  try {
    response = await fetchWithTimeout(
      '/refresh',
      {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${refreshToken}` },
      },
      DEFAULT_TIMEOUT_MS,
    );
  } catch {
    return 'unavailable';
  }

  // Un `5xx` es un problema del servidor, no un veredicto sobre la sesión.
  if (response.status >= 500) return 'unavailable';

  if (!response.ok) {
    // `401` (o cualquier rechazo): el refresh no sirve más. Se limpia todo.
    await clearSession();
    return 'invalid';
  }

  let payload: Partial<RefreshResponse> | null = null;
  try {
    payload = (await response.json()) as Partial<RefreshResponse>;
  } catch {
    payload = null;
  }

  if (!payload?.token || !payload.refresh_token) {
    // El refresh ya se consumió en el servidor pero no llegó el par nuevo:
    // no hay con qué seguir. Se cierra limpio en vez de quedar a medias.
    await clearSession();
    return 'invalid';
  }

  try {
    // El refresh nuevo se persiste ANTES de usar el par (ver session.ts).
    await setSession({ accessToken: payload.token, refreshToken: payload.refresh_token });
  } catch {
    await clearSession();
    return 'invalid';
  }

  return 'ok';
}

/** Una sola renovación en vuelo; los demás llamadores esperan la misma promesa. */
function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Espera a que termine una renovación en curso (si la hay). Lo usa el logout:
 * sin esto, una renovación a medias podría volver a escribir tokens justo
 * después de borrarlos y "resucitar" la sesión.
 */
export async function waitForRefresh(): Promise<void> {
  if (refreshInFlight) await refreshInFlight.catch(() => undefined);
}

/** Traduce el resultado de una renovación a "token listo" o a un `ApiError`. */
async function accessTokenAfterRefresh(): Promise<string> {
  const outcome = await refreshSession();
  if (outcome === 'unavailable') throw networkError();
  if (outcome === 'invalid') throw new ApiError('Tu sesión expiró. Volvé a iniciar sesión.', 401);

  const token = await getToken();
  if (!token) throw new ApiError('No hay sesión activa', 401);
  return token;
}

/**
 * Avisa al servidor del cierre de sesión (`POST /api/logout`, ADR-017 §4.6).
 * Es "mejor esfuerzo": con un timeout corto y sin lanzar nunca. Si no hay red,
 * el logout local ocurre igual y la sesión del servidor expira sola.
 */
export async function revokeSessionOnServer(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetchWithTimeout(
      '/logout',
      {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${refreshToken}` },
      },
      LOGOUT_TIMEOUT_MS,
    );
    return response.ok;
  } catch {
    return false;
  }
}

// --- Petición pública ------------------------------------------------------

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    form,
    authenticated = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    binary = false,
  } = options;

  const baseHeaders: Record<string, string> = { Accept: binary ? 'application/pdf, application/json' : 'application/json' };
  // `FormData` (notas de voz, ADR-042) puede venir como `body` o en `form`: viaja tal cual y SIN
  // `Content-Type` (lo fija React Native con el `boundary`). Con JSON se serializa como siempre.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) baseHeaders['Content-Type'] = 'application/json';
  const serializedBody =
    form ?? (body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body));

  const send = (accessToken: string | null) =>
    fetchWithTimeout(
      path,
      {
        method,
        headers: accessToken ? { ...baseHeaders, Authorization: `Bearer ${accessToken}` } : baseHeaders,
        body: serializedBody,
      },
      timeoutMs,
      signal,
    );

  let sentToken: string | null = null;
  if (authenticated) {
    sentToken = await getToken();
    // Sin access token pero con refresh (p. ej. se perdió la escritura del
    // access): se recupera con una renovación en vez de exigir login.
    if (!sentToken) {
      if (!(await getRefreshToken())) {
        // Mismo resultado que daría el servidor, sin gastar la ida y vuelta.
        throw new ApiError('No hay sesión activa', 401);
      }
      sentToken = await accessTokenAfterRefresh();
    }
  }

  let response = await send(sentToken);

  // `401` en una petición autenticada: el access expiró (o fue revocado).
  // Se renueva UNA vez y se repite UNA vez. Si otra petición ya renovó
  // mientras tanto (el token guardado cambió), se reutiliza ese en vez de
  // gastar otro refresh.
  if (authenticated && response.status === 401) {
    const current = await getToken();
    const nextToken = current && current !== sentToken ? current : await accessTokenAfterRefresh();
    response = await send(nextToken);
  }

  if (response.status === 204) return undefined as T;

  if (binary && response.ok) return new Uint8Array(await response.arrayBuffer()) as T;

  // El backend responde JSON incluso en los errores, incluidos `404`/`500`,
  // gracias al manejador global (`app/interfaces/error_handlers.py`). Igual se
  // tolera un cuerpo no-JSON: podría venir de un proxy o portal cautivo.
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const msg =
      payload && typeof payload === 'object' && typeof (payload as any).msg === 'string'
        ? (payload as any).msg
        : 'Ocurrió un error inesperado. Intentá de nuevo.';
    throw new ApiError(msg, response.status, { body: payload });
  }

  return payload as T;
}
