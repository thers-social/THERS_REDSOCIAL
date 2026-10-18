import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuth } from '@features/auth/context/AuthContext';

import { installForegroundHandler, registerPushDevice } from './push';
import { routeForNotification } from './routes';

/**
 * Conecta las notificaciones push con la sesión (`ADR-053`): registra el teléfono al iniciar sesión y lleva
 * a la pantalla correcta al tocar un aviso, incluso si la app estaba cerrada. Va una sola vez en el layout raíz.
 */
export function usePushNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?.id ?? null;
  // Un aviso que abrió la app en frío se atiende una sola vez.
  const handledColdStart = useRef(false);

  useEffect(() => {
    installForegroundHandler();
  }, []);

  useEffect(() => {
    if (userId) void registerPushDevice();
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;

    const open = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      router.push(routeForNotification(data));
    };

    if (!handledColdStart.current) {
      handledColdStart.current = true;
      const last = Notifications.getLastNotificationResponse();
      if (last) open(last);
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [userId, router]);
}

/** Componente sin interfaz para montar el hook dentro del árbol de proveedores. */
export function PushBridge() {
  usePushNotifications();
  return null;
}
