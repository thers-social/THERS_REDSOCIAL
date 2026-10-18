// Claves y lectura/escritura de la sesión en localStorage. Es un módulo sin React para que lo
// compartan AuthContext (que guarda la sesión) y sessionRefresh (que la renueva) sin importarse
// entre sí. El token de acceso (15 min) y el de refresh (30 días, un solo uso) viven juntos: ver
// ADR-017-jwt-session-policy.md y API_CONTRACT.md §4.16.
export const TOKEN_KEY = "token";
export const REFRESH_KEY = "refresh_token";
export const USER_KEY = "user";

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

// `refresh` puede faltar (sesiones guardadas antes de esta función, o un servidor sin refresh): en
// ese caso solo se actualiza el de acceso y la sesión sigue muriendo a los 15 minutos, como antes.
export function saveTokens(access, refresh) {
  localStorage.setItem(TOKEN_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}
