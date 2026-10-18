import { clearTokens, getRefreshToken, saveTokens } from "./sessionTokens.js";

// Renovación automática de la sesión (ADR-017-jwt-session-policy.md §4.4, API_CONTRACT.md §4.16).
//
// El token de acceso dura 15 minutos. Cuando una petición AUTENTICADA responde 401 se pide uno
// nuevo con el refresh token y se repite la petición una sola vez, sin que la persona lo note. Así
// los 33 lugares que ya mandan `Authorization` a mano no cambian.
//
// Reglas del contrato:
//   * Una sola renovación en vuelo: las demás peticiones esperan la misma promesa. El refresh es de
//     UN solo uso; dos llamadas a la vez gastarían el mismo y la segunda revocaría toda la sesión.
//   * Un 401 en la propia renovación significa sesión terminada: se limpia y se avisa, sin reintentos.
//   * Un fallo de red al renovar NO cierra la sesión: se devuelve el error original.

const SKIP_FLAG = "_skipSessionRefresh";
const RETRIED_FLAG = "_sessionRetried";

export const SESSION_EXPIRED = "SESSION_EXPIRED";

function bearer(headers) {
  const value = headers?.Authorization ?? headers?.authorization ?? headers?.get?.("Authorization");
  return typeof value === "string" ? value : null;
}

export function installSessionRefresh(api, { onExpired } = {}) {
  let inFlight = null;

  async function renew() {
    const refresh = getRefreshToken();
    if (!refresh) throw Object.assign(new Error("no refresh"), { code: SESSION_EXPIRED });
    try {
      const res = await api.post("/refresh", null, {
        headers: { Authorization: `Bearer ${refresh}` },
        [SKIP_FLAG]: true,
      });
      saveTokens(res.data.token, res.data.refresh_token);
      return res.data.token;
    } catch (error) {
      if (error?.response?.status === 401) {
        clearTokens();
        onExpired?.();
        throw Object.assign(new Error("session expired"), { code: SESSION_EXPIRED });
      }
      throw error;
    }
  }

  const id = api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const original = error?.config;
      if (
        error?.response?.status !== 401 ||
        !original ||
        original[SKIP_FLAG] ||
        original[RETRIED_FLAG] ||
        !bearer(original.headers) ||
        !getRefreshToken()
      ) {
        return Promise.reject(error);
      }

      inFlight = inFlight || renew().finally(() => { inFlight = null; });
      let newToken;
      try {
        newToken = await inFlight;
      } catch (renewError) {
        if (renewError?.code === SESSION_EXPIRED) {
          error.sessionExpired = true;
          return Promise.reject(error);
        }
        return Promise.reject(error);
      }

      original[RETRIED_FLAG] = true;
      original.headers = original.headers || {};
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    },
  );

  return () => api.interceptors.response.eject(id);
}

// Cierre de sesión en el servidor (revoca la cadena de refresh). Es de mejor esfuerzo: si falla o no
// hay red, la sesión local se cierra igual.
export async function revokeSession(api) {
  const refresh = getRefreshToken();
  if (!refresh) return;
  try {
    await api.post("/logout", null, {
      headers: { Authorization: `Bearer ${refresh}` },
      [SKIP_FLAG]: true,
    });
  } catch {
    /* el cierre local no depende del servidor */
  }
}
