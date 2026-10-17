/**
 * Lectura y petición de los permisos del sistema que usa THERS (notificaciones y ubicación).
 * Una sola puerta de entrada: las pantallas no hablan con `expo-notifications` ni
 * `expo-location` directamente para esto.
 *
 * Fotos no aparece porque no hace falta: el selector del sistema de Android deja elegir una
 * imagen sin permiso de galería.
 */

import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import type { PermissionKind, PermissionSnapshot, PermissionState } from './permissionState';

type ExpoPermission = { granted: boolean; canAskAgain: boolean; status: string };

function snapshotOf(result: ExpoPermission): PermissionSnapshot {
  let state: PermissionState;
  if (result.granted) state = 'granted';
  else if (result.status === 'undetermined') state = 'undetermined';
  else state = 'denied';
  return { state, canAskAgain: result.canAskAgain };
}

export async function getPermission(kind: PermissionKind): Promise<PermissionSnapshot> {
  const result =
    kind === 'notifications'
      ? await Notifications.getPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
  return snapshotOf(result);
}

/** Abre el diálogo del sistema (si Android todavía deja preguntar) y devuelve el estado final. */
export async function requestPermission(kind: PermissionKind): Promise<PermissionSnapshot> {
  const result =
    kind === 'notifications'
      ? await Notifications.requestPermissionsAsync()
      : await Location.requestForegroundPermissionsAsync();
  return snapshotOf(result);
}

/** Ajustes de THERS en el sistema: la única forma de cambiar un permiso bloqueado. */
export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}
