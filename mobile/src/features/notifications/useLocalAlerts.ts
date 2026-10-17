/**
 * Avisos locales de THERS en este dispositivo.
 *
 * NO son notificaciones push: no hay Firebase ni servidor que empuje nada. Mientras la app está
 * abierta, se consulta `GET /api/notifications` cada minuto y, por cada aviso nuevo sin leer, se
 * muestra una notificación del sistema (bandeja y banner). Con la app cerrada o muy en segundo
 * plano NO llega nada: eso necesita push reales, que son una fase aparte.
 *
 * Reglas:
 * - Solo con el permiso del sistema concedido y con el interruptor del dispositivo encendido
 *   (`alertPrefs`). Sin permiso no se consulta nada extra.
 * - La primera consulta de la sesión no avisa (ver `planAlerts`).
 * - El permiso se explica y se pide una sola vez, no en cada arranque.
 */

import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';

import { getPermission, requestPermission } from '@features/permissions/permissions';

import { loadAlertsEnabled, markAskedForNotifications, wasAskedForNotifications } from './alertPrefs';
import { planAlerts } from './alertLogic';
import { describeNotification, fetchNotifications } from './api';
import type { AppNotification } from './api';

const POLL_MS = 60_000;
export const ALERTS_CHANNEL_ID = 'thers-avisos';

// Cómo se muestra un aviso si llega con la app abierta: banner y lista, sin sonido ni insignia.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
    name: 'Avisos de THERS',
    description: 'Me gusta, comentarios, seguidores, menciones y novedades de tus lugares.',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

function titleOf(item: AppNotification): string {
  return item.actor?.name ?? item.place?.name ?? 'THERS';
}

async function show(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { target: '/notifications' } },
    trigger: { channelId: ALERTS_CHANNEL_ID },
  });
}

/** Explica el permiso una sola vez y lo pide. Devuelve si quedó concedido. */
async function askOnce(): Promise<boolean> {
  const current = await getPermission('notifications');
  if (current.state === 'granted') return true;
  if (current.state === 'denied' && !current.canAskAgain) return false;
  if (await wasAskedForNotifications()) return false;

  await markAskedForNotifications();
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Avisos de THERS',
      'Podemos avisarte de me gusta, comentarios, seguidores y novedades de tus lugares mientras usas la app. Puedes cambiarlo cuando quieras en Ajustes → Notificaciones.',
      [
        { text: 'Ahora no', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Activar',
          onPress: () => {
            requestPermission('notifications')
              .then((result) => resolve(result.state === 'granted'))
              .catch(() => resolve(false));
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function useLocalAlerts(signedIn: boolean) {
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);

  // Al tocar una notificación se abre la pestaña de avisos.
  useEffect(() => {
    if (!signedIn) return undefined;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = response.notification.request.content.data?.target;
      if (typeof target === 'string') router.push(target as never);
    });
    return () => subscription.remove();
  }, [signedIn, router]);

  useEffect(() => {
    if (!signedIn) {
      seen.current = null;
      return undefined;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (cancelled || AppState.currentState !== 'active') return;
      if (!(await loadAlertsEnabled())) return;
      if ((await getPermission('notifications')).state !== 'granted') return;

      let items: AppNotification[];
      try {
        items = await fetchNotifications();
      } catch {
        return; // Sin red o sesión vencida: se reintenta en el siguiente ciclo.
      }
      if (cancelled) return;

      const plan = planAlerts(items, seen.current);
      seen.current = plan.nextSeen;
      for (const item of plan.individual) {
        await show(titleOf(item), describeNotification(item.type, item.detail));
      }
      if (plan.overflow > 0) {
        await show('THERS', `Tienes ${plan.overflow} avisos nuevos más.`);
      }
    }

    (async () => {
      await ensureChannel();
      await askOnce();
      if (cancelled) return;
      await poll();
      timer = setInterval(() => void poll(), POLL_MS);
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [signedIn]);
}
