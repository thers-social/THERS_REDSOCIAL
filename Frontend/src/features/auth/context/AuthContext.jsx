import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@shared/lib/api";

const AuthContext = createContext(undefined);

const TOKEN_KEY = "token";
const USER_KEY = "user";

// Punto único de lectura del token para cualquier feature que necesite
// llamar a un endpoint autenticado fuera de este contexto (ej. features/feed
// para GET/POST /api/posts) -- evita que otras features dupliquen la clave
// de localStorage ("token") o el detalle de dónde vive.
export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// El backend ya devuelve `username` real (ADR-002, API_CONTRACT.md §4). Este
// fallback solo cubre sesiones guardadas en localStorage antes de ese cambio,
// que no tienen la columna todavía -- no es la fuente principal.
function withUsername(user) {
  return {
    ...user,
    username: user.username || user.email.split("@")[0],
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fuente de verdad de la identidad: GET /api/users/me (API_CONTRACT.md
  // §4.2, ADR-002). Un token inválido/expirado (401) o un usuario que ya no
  // existe (404) limpian la sesión local vía logout().
  const loadCurrentUser = async () => {
    setIsLoading(true);
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      setUser(null);
      setIsLoading(false);
      return null;
    }

    try {
      const res = await api.get("/users/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const currentUser = withUsername(res.data.user);
      localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      setUser(currentUser);
      return currentUser;
    } catch {
      logout();
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCurrentUser();
  }, []);

  // Guarda la sesión a partir de una respuesta `{token, user}`. Lo comparten
  // los tres caminos que la producen (login, Google y verificación de 2FA) --
  // tenerlo en un solo lugar evita que uno de ellos olvide persistir algo.
  const storeSession = (data) => {
    const loggedInUser = withUsername(data.user);
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(loggedInUser));
    setUser(loggedInUser);
    return loggedInUser;
  };

  // Desde ADR-026-two-factor-authentication.md, `POST /api/login` tiene DOS
  // respuestas posibles con 200: la sesión de siempre, o un desafío de segundo
  // factor (`two_factor_required`). En el segundo caso **no hay token todavía**
  // y no se guarda nada -- la sesión no existe hasta que el código valide.
  //
  // Se devuelve un objeto discriminado en vez de lanzar una excepción: que la
  // cuenta tenga 2FA no es un error, es el camino normal del login para esa
  // persona.
  const login = async (data) => {
    const res = await api.post("/login", data);

    if (res.data.two_factor_required) {
      return { twoFactorRequired: true, twoFactorToken: res.data.two_factor_token };
    }

    return { twoFactorRequired: false, user: storeSession(res.data) };
  };

  // Segundo paso del login con 2FA. `code` puede ser un TOTP de la app
  // autenticadora o un código de recuperación -- el backend acepta los dos y no
  // distingue cuál falló, así que acá tampoco se adivina.
  const verifyTwoFactor = async (twoFactorToken, code) => {
    const res = await api.post("/2fa/verify", {
      two_factor_token: twoFactorToken,
      code,
    });

    return {
      user: storeSession(res.data),
      // Para poder avisar "usaste un código de recuperación, te quedan N" en
      // vez de dejarlo pasar inadvertido.
      usedRecoveryCode: res.data.used_recovery_code,
      recoveryCodesRemaining: res.data.recovery_codes_remaining,
    };
  };

  // "Continuar con Google" (ADR-012-google-sign-in.md) -- mismo contrato de
  // respuesta que login() (`{token, user}`), así que reutiliza exactamente
  // el mismo manejo de sesión. `credential` es el ID Token que Google
  // Identity Services le entregó a GoogleSignInButton.jsx, reenviado tal
  // cual -- este contexto nunca lo interpreta, solo lo reenvía al backend,
  // que es quien lo verifica de verdad.
  const loginWithGoogle = async (credential) => {
    const res = await api.post("/auth/google", { credential });

    // Google autenticó la identidad, pero si la cuenta tiene 2FA ese segundo
    // factor también aplica acá -- si no, "Continuar con Google" sería una
    // puerta que lo saltea (ADR-026 §Seguridad).
    if (res.data.two_factor_required) {
      return { twoFactorRequired: true, twoFactorToken: res.data.two_factor_token };
    }

    return { twoFactorRequired: false, user: storeSession(res.data) };
  };

  // El registro no inicia sesión (el backend no lo hace -- API_CONTRACT.md §4.1
  // solo documenta 201 con el `user` creado, sin `token`), por eso no toca el
  // estado de sesión de este contexto.
  const register = async (data) => {
    const res = await api.post("/register", data);
    return res.data.user;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  // Edición de perfil (name/username/phone/country_code/birth_date):
  // persistida por el backend (ADR-003, API_CONTRACT.md §4.2). La respuesta
  // de PATCH /api/users/me reemplaza `user` por completo -- misma fuente de
  // verdad que login()/loadCurrentUser(), nunca un merge parcial local.
  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` });

  const applyUser = (rawUser) => {
    const updatedUser = withUsername(rawUser);
    localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
    setUser(updatedUser);
    return updatedUser;
  };

  const updateProfile = async (patch) => {
    const res = await api.patch("/users/me", patch, { headers: authHeaders() });
    return applyUser(res.data.user);
  };

  // Vuelve a pedir el perfil SIN pasar por `isLoading` (a diferencia de
  // loadCurrentUser, que desmontaría las rutas protegidas con un spinner). Lo usa
  // Tero tras confirmar una acción que cambió el perfil (ADR-041). Un fallo no
  // cierra la sesión: es una resincronización de fondo.
  const refreshUser = async () => {
    try {
      const res = await api.get("/users/me", { headers: authHeaders() });
      return applyUser(res.data.user);
    } catch {
      return null;
    }
  };

  // Foto de perfil / portada (ADR-015-profile-media.md, API_CONTRACT.md).
  // `kind`: "avatar" | "cover". multipart/form-data con el campo `file`; el
  // navegador fija el boundary del Content-Type por sí solo.
  const uploadProfileImage = async (kind, file) => {
    const body = new FormData();
    body.append("file", file);
    const res = await api.post(`/users/me/${kind}`, body, {
      headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    });
    return applyUser(res.data.user);
  };

  const removeProfileImage = async (kind) => {
    const res = await api.delete(`/users/me/${kind}`, { headers: authHeaders() });
    return applyUser(res.data.user);
  };

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    verifyTwoFactor,
    loginWithGoogle,
    register,
    logout,
    loadCurrentUser,
    refreshUser,
    updateProfile,
    uploadProfileImage,
    removeProfileImage,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth debe usarse dentro de un AuthProvider");
  }
  return context;
}
