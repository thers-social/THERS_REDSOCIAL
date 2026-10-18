/**
 * «Continuar con Google» en Android (`ADR-012`, `docs/mobile/ANDROID_SETUP.md` §6).
 *
 * Se pide a Google un ID Token y se lo entrega TAL CUAL al backend (`POST /api/auth/google`), que lo
 * verifica criptográficamente; la app nunca interpreta ni envía el email o el nombre por su cuenta.
 *
 * El backend acepta UNA sola audiencia: el Web client ID de `GOOGLE_CLIENT_ID`. Por eso se configura
 * ese mismo valor como `webClientId` (serverClientId): así el `aud` del token es el que el servidor
 * espera. Además, en Google Cloud Console debe existir un cliente OAuth de tipo **Android** en el
 * MISMO proyecto que ese Web client, con el paquete `com.thers.app` y el SHA-1 de la keystore con la
 * que se firma la app. Sin él, Google responde `DEVELOPER_ERROR` y esta pantalla lo explica.
 *
 * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` es un identificador público (queda en el bundle, igual que en
 * la web): no es un secreto. Sin la variable el botón no se muestra: no se dibuja un control que no
 * hace nada.
 */

import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';

/** `true` si este dispositivo y esta compilación pueden ofrecer «Continuar con Google». */
export const isGoogleSignInAvailable = Platform.OS === 'android' && GOOGLE_WEB_CLIENT_ID.length > 0;

export type GoogleSignInFailure = 'cancelled' | 'in_progress' | 'play_services' | 'config' | 'failed';

export class GoogleSignInError extends Error {
  readonly reason: GoogleSignInFailure;

  constructor(reason: GoogleSignInFailure, message: string) {
    super(message);
    this.name = 'GoogleSignInError';
    this.reason = reason;
  }
}

let configured = false;

function configureOnce() {
  if (configured) return;
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  configured = true;
}

/**
 * Abre el selector de cuentas de Google y devuelve el ID Token. Lanza `GoogleSignInError`:
 * `cancelled` cuando la persona cierra el selector (no es un error que mostrar).
 */
export async function getGoogleCredential(): Promise<string> {
  if (!isGoogleSignInAvailable) {
    throw new GoogleSignInError('config', 'Continuar con Google no está disponible en esta versión de la app.');
  }

  try {
    configureOnce();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Cierra la sesión local de Google ANTES de pedir cuenta: así siempre se ofrece el selector y no
    // se reutiliza en silencio la última cuenta (la sesión de THERS es la del servidor, no esta).
    await GoogleSignin.signOut().catch(() => {});

    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      throw new GoogleSignInError('cancelled', 'Inicio con Google cancelado.');
    }
    const idToken = response.data.idToken;
    if (!idToken) {
      throw new GoogleSignInError('failed', 'Google no devolvió una credencial. Inténtalo de nuevo.');
    }
    return idToken;
  } catch (error) {
    if (error instanceof GoogleSignInError) throw error;
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        throw new GoogleSignInError('cancelled', 'Inicio con Google cancelado.');
      }
      if (error.code === statusCodes.IN_PROGRESS) {
        throw new GoogleSignInError('in_progress', 'Ya hay un inicio con Google en curso.');
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new GoogleSignInError(
          'play_services',
          'Este teléfono necesita Google Play Services actualizado para usar Google.',
        );
      }
      // Sin datos sensibles: solo el código. `10`/`DEVELOPER_ERROR` = falta el cliente OAuth Android
      // (paquete + SHA-1) en Google Cloud Console.
      console.warn(`[google] error al iniciar sesión: ${String(error.code)}`);
      throw new GoogleSignInError(
        'config',
        'Google no está configurado para esta versión de la app. Usa tu correo y contraseña.',
      );
    }
    console.warn('[google] error inesperado al iniciar sesión');
    throw new GoogleSignInError('failed', 'No se pudo iniciar con Google. Inténtalo de nuevo.');
  }
}
