import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { fetchConversations } from './api';

const REFRESH_MS = 30000;

/**
 * Total de mensajes sin leer, para el contador de la pestaña «Mensajes». Consulta
 * `GET /api/conversations` (el servidor no tiene un contador aparte) cada 30 s y
 * solo con la app en primer plano; un fallo de red deja el último valor.
 */
export function useUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const items = await fetchConversations(controller.signal);
        if (!cancelled) setCount(items.reduce((sum, item) => sum + item.unread_count, 0));
      } catch {
        // Sin red o sesión vencida: se conserva el valor anterior.
      }
    }

    void load();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled]);

  return count;
}
