/**
 * Estado de un permiso del sistema y qué se le ofrece a la persona. Lógica pura (sin React
 * Native): probada en `tests/permissions.test.mjs`.
 */

export type PermissionKind = 'notifications' | 'location';

// Fotos NO está aquí a propósito: en Android 13+ el selector del sistema (que usa
// `expo-image-picker`) deja elegir una imagen sin permiso de acceso a la galería.

/**
 * - `granted`: permitido.
 * - `undetermined`: Android todavía no preguntó (se puede pedir con el diálogo del sistema).
 * - `denied` + `canAskAgain`: se negó, pero el sistema aún deja preguntar.
 * - `denied` sin `canAskAgain`: se negó para siempre; solo se cambia desde Ajustes.
 */
export type PermissionState = 'granted' | 'undetermined' | 'denied';

export type PermissionSnapshot = { state: PermissionState; canAskAgain: boolean };

export type PermissionAction = 'request' | 'open-settings' | 'none';

export const PERMISSION_COPY: Record<PermissionKind, { title: string; why: string }> = {
  notifications: {
    title: 'Notificaciones',
    why: 'Para avisarte de me gusta, comentarios, seguidores, mensajes y novedades de tus lugares.',
  },
  location: {
    title: 'Ubicación',
    why: 'Solo cuando pulsas «Usar mi ubicación» o navegas a un lugar. No se guarda.',
  },
};

/** Qué botón mostrar: pedir con el diálogo del sistema, mandar a Ajustes, o nada. */
export function actionFor(snapshot: PermissionSnapshot): PermissionAction {
  if (snapshot.state === 'granted') return 'none';
  if (snapshot.state === 'undetermined' || snapshot.canAskAgain) return 'request';
  return 'open-settings';
}

export function stateLabel(snapshot: PermissionSnapshot): string {
  switch (snapshot.state) {
    case 'granted':
      return 'Permitido';
    case 'undetermined':
      return 'Sin decidir';
    default:
      return snapshot.canAskAgain ? 'No permitido' : 'Bloqueado en Ajustes';
  }
}

export function actionLabel(action: PermissionAction): string | null {
  if (action === 'request') return 'Permitir';
  if (action === 'open-settings') return 'Abrir Ajustes';
  return null;
}
