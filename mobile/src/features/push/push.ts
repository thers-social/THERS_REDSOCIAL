/**
 * Notificaciones push en Android (`ADR-053`): permiso, canal, token de Firebase y registro en el servidor.
 *
 * El token es el de FCM del propio teléfono (`getDevicePushTokenAsync`), no uno de Expo: el servidor
 * envía directo a Firebase. Nada de esto bloquea la app: si no hay permiso, no hay Firebase configurado
 * (falta `google-services.json` en la compilación) o no hay red, simplemente no llegan avisos.
 */

import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { request } from '@shared/lib/api';

const CHANNEL_ID = 'default';
const TOKEN_KEY = 'thers.push_token';

let handlerInstalled = false;

/** Con la app abierta el aviso también se muestra (como en Instagram), sin sonido repetido. */
export function installForegroundHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannel() {
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'THERS',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 100, 200],
    lightColor: '#a855f7',
  });
}

/** Pide permiso (Android 13+ lo exige) y devuelve si quedó concedido. */
async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Registra este teléfono para la cuenta con sesión. Devuelve `true` si quedó registrado. Es seguro
 * llamarlo en cada arranque: el servidor hace un UPSERT por token.
 */
export async function registerPushDevice(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    await ensureChannel();
    if (!(await ensurePermission())) return false;
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (typeof token !== 'string' || token.length === 0) return false;
    await request('/push/devices', {
      method: 'POST',
      authenticated: true,
      body: { token, platform: 'android' },
    });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return true;
  } catch {
    // Sin Firebase en la compilación, sin red o sin Play Services: la app sigue sin avisos push.
    return false;
  }
}

/** Quita este teléfono de la cuenta (cerrar sesión). Mejor esfuerzo: nunca impide cerrar la sesión. */
export async function unregisterPushDevice(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;
    await request('/push/devices', {
      method: 'DELETE',
      authenticated: true,
      body: { token },
      timeoutMs: 4000,
    });
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Sin red: el servidor lo limpia cuando Firebase diga que el token ya no existe.
  }
}
