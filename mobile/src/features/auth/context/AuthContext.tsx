/**
 * Estado de sesión de la app móvil.
 *
 * Equivalente de `Frontend/src/features/auth/context/AuthContext.jsx`, con dos
 * diferencias deliberadas:
 * - los tokens (access y refresh, ADR-017) van a SecureStore, no a
 *   `localStorage` (THERS_PROMPT §7);
 * - el `user` NO se cachea en disco: se restaura siempre desde
 *   `GET /api/users/me`, que es la fuente de verdad (`API_CONTRACT.md` §4.2).
 *
 * Contexto/estado mínimo a propósito: el encargo (§5) pide no agregar otra
 * biblioteca de estado global sin necesidad demostrada. Zustand/Redux entran
 * si aparece un problema real, no por anticipación.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { unregisterPushDevice } from '@features/push/push';
import { ApiError, request, revokeSessionOnServer, waitForRefresh } from '@shared/lib/api';
import { clearSession, getRefreshToken, getToken, setSession } from '@shared/lib/session';

import { getGoogleCredential } from '../lib/googleSignIn';
import { isTwoFactorChallenge } from '../types';
import type { LoginResponse, TwoFactorVerifyResponse, User } from '../types';

/** Resultado de `login`: una sesión abierta, o falta el segundo factor (`ADR-026`). */
export type LoginResult = { status: 'authenticated' } | { status: 'two_factor' };

/**
 * Resultado de `loginWithGoogle`. `profileCompleted` es `false` para una cuenta recién creada con
 * Google: faltan teléfono, país y fecha de nacimiento (`ADR-012`), y hay que completarlos.
 */
export type GoogleLoginResult =
  | { status: 'authenticated'; profileCompleted: boolean }
  | { status: 'two_factor' };

/** Resultado de `verifyTwoFactor`: para avisar si se gastó un código de recuperación. */
export type TwoFactorOutcome = { usedRecoveryCode: boolean; recoveryCodesRemaining: number };

type AuthState = {
  user: User | null;
  /** `true` mientras se restaura la sesión al arrancar: evita parpadear el login. */
  isRestoring: boolean;
  /**
   * `true` si hay una sesión guardada pero no se pudo comprobar (sin red, o el
   * servidor no respondió). La sesión NO está cerrada: la app debe ofrecer
   * reintentar, no mandar al login.
   */
  restoreFailed: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  /**
   * «Continuar con Google» (`POST /api/auth/google`, `ADR-012`): sirve para registrarse y para
   * entrar. Lanza `GoogleSignInError` (`reason: 'cancelled'` si la persona cierra el selector) o
   * `ApiError` si el servidor rechaza la credencial.
   */
  loginWithGoogle: () => Promise<GoogleLoginResult>;
  /**
   * `true` si el login pidió el segundo factor y falta verificarlo. El token de
   * desafío NO sale de este contexto: ni por parámetros de ruta ni a disco (no
   * es una sesión, y vive solo 5 minutos). Se pierde al cerrar la app, y eso es
   * lo correcto: se vuelve a iniciar sesión.
   */
  hasPendingTwoFactor: boolean;
  /** Completa el login con un TOTP de 6 dígitos o un código de recuperación. */
  verifyTwoFactor: (code: string) => Promise<TwoFactorOutcome>;
  /** Abandona el segundo factor y descarta el desafío. */
  cancelTwoFactor: () => void;
  logout: () => Promise<void>;
  /** Vuelve a pedir `GET /api/users/me`. Devuelve `false` si la sesión ya no vale. */
  refreshUser: () => Promise<boolean>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [pendingTwoFactorToken, setPendingTwoFactorToken] = useState<string | null>(null);

  /**
   * Única lectura de la identidad actual. `request()` ya renueva el access
   * token por su cuenta ante un `401` (ADR-017); si aún así llega un `401`, la
   * sesión de verdad terminó (refresh revocado, expirado o ausente) y se limpia:
   * quedarse con un `user` en memoria sin sesión produce pantallas que mienten.
   *
   * Cualquier OTRO fallo (sin red, timeout, `5xx`) **no** cierra la sesión: el
   * token puede seguir siendo válido y el usuario estar sin cobertura, o el
   * servidor caído un momento. Cerrar sesión ahí haría que perder señal
   * equivalga a un logout. Se marca `restoreFailed` para que la app ofrezca
   * reintentar en vez de mostrar el login.
   */
  const loadCurrentUser = useCallback(async (): Promise<boolean> => {
    try {
      // El backend envuelve al usuario: `{"user": {...}}` (API_CONTRACT.md §4.2),
      // igual que `login`. Guardar la respuesta cruda dejaba todos los campos en
      // `undefined` al restaurar la sesión.
      const { user: current } = await request<{ user: User }>('/users/me', {
        authenticated: true,
      });
      setUser(current);
      setRestoreFailed(false);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        await clearSession();
        setUser(null);
        setRestoreFailed(false);
        return false;
      }
      setRestoreFailed(true);
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Hay sesión si existe cualquiera de los dos tokens: sin access pero con
      // refresh, `request()` lo recupera renovando.
      const hasSession = (await getToken()) !== null || (await getRefreshToken()) !== null;
      if (hasSession) await loadCurrentUser();
      if (!cancelled) setIsRestoring(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [loadCurrentUser]);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    // `.trim()` solo en el email, igual que el backend (`auth_routes.py`): un
    // espacio final de autocompletado hacía que `find_by_email()` no coincida.
    // La contraseña NUNCA se normaliza -- alteraría su valor real.
    const data = await request<LoginResponse>('/login', {
      method: 'POST',
      body: { email: email.trim(), password },
    });

    // Cuenta con 2FA: el servidor responde 200 SIN sesión. No se guarda nada en
    // SecureStore y no hay `user`: solo se recuerda el desafío, en memoria.
    if (isTwoFactorChallenge(data)) {
      setPendingTwoFactorToken(data.two_factor_token);
      return { status: 'two_factor' };
    }

    // Los tokens se persisten ANTES de publicar el user: si `setSession` falla,
    // no se deja la app "logueada" con una sesión que no sobrevive al cierre.
    await setSession({ accessToken: data.token, refreshToken: data.refresh_token });
    setPendingTwoFactorToken(null);
    setRestoreFailed(false);
    setUser(data.user);
    return { status: 'authenticated' };
  }, []);

  const loginWithGoogle = useCallback(async (): Promise<GoogleLoginResult> => {
    // El ID Token sale de Google tal cual y va al servidor, que lo verifica (firma, `iss`, `aud`,
    // `exp`). La app no manda email ni nombre: nunca se confía en lo que diga el cliente.
    const credential = await getGoogleCredential();
    const data = await request<LoginResponse>('/auth/google', {
      method: 'POST',
      body: { credential },
    });

    if (isTwoFactorChallenge(data)) {
      setPendingTwoFactorToken(data.two_factor_token);
      return { status: 'two_factor' };
    }

    await setSession({ accessToken: data.token, refreshToken: data.refresh_token });
    setPendingTwoFactorToken(null);
    setRestoreFailed(false);
    setUser(data.user);
    return { status: 'authenticated', profileCompleted: data.user.profile_completed };
  }, []);

  const verifyTwoFactor = useCallback(
    async (code: string): Promise<TwoFactorOutcome> => {
      if (!pendingTwoFactorToken) {
        throw new ApiError('La verificación expiró. Iniciá sesión de nuevo.', 401);
      }

      // Endpoint público (no `authenticated`): todavía no hay sesión. Solo se
      // recorta el código: el servidor normaliza mayúsculas, guiones y espacios
      // de los códigos de recuperación (`ADR-026`), y un TOTP son solo dígitos.
      const data = await request<TwoFactorVerifyResponse>('/2fa/verify', {
        method: 'POST',
        body: { two_factor_token: pendingTwoFactorToken, code: code.trim() },
      });

      await setSession({ accessToken: data.token, refreshToken: data.refresh_token });
      setPendingTwoFactorToken(null);
      setRestoreFailed(false);
      setUser(data.user);

      return {
        usedRecoveryCode: data.used_recovery_code,
        recoveryCodesRemaining: data.recovery_codes_remaining,
      };
    },
    [pendingTwoFactorToken],
  );

  const cancelTwoFactor = useCallback(() => setPendingTwoFactorToken(null), []);

  const logout = useCallback(async () => {
    // ADR-017 §4.6: el logout limpia los DOS lados. Primero se espera a una
    // renovación en curso (si no, podría reescribir tokens justo después de
    // borrarlos), se revoca la sesión en el servidor (mejor esfuerzo: sin red
    // igual se cierra localmente) y por último se borra el almacenamiento.
    // El access token ya emitido sigue siendo válido hasta expirar (<= 15 min):
    // el backend no tiene lista de revocación de access tokens.
    await waitForRefresh();
    // Antes de revocar la sesión: el servidor necesita el token de acceso para quitar este teléfono (ADR-053).
    await unregisterPushDevice();
    await revokeSessionOnServer();
    await clearSession();
    setUser(null);
    setRestoreFailed(false);
    setPendingTwoFactorToken(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isRestoring,
      restoreFailed,
      login,
      loginWithGoogle,
      hasPendingTwoFactor: pendingTwoFactorToken !== null,
      verifyTwoFactor,
      cancelTwoFactor,
      logout,
      refreshUser: loadCurrentUser,
    }),
    [
      user,
      isRestoring,
      restoreFailed,
      login,
      loginWithGoogle,
      pendingTwoFactorToken,
      verifyTwoFactor,
      cancelTwoFactor,
      logout,
      loadCurrentUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return context;
}
