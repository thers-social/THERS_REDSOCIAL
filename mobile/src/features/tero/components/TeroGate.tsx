import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { useAuth } from '@features/auth/context/AuthContext';

import { useTero } from '../context/TeroContext';

/**
 * Guarda de las pantallas `app/tero/*`: viven en el Stack raíz, fuera de las
 * pestañas (que son las que ya exigen sesión). Sin sesión se va al login; con
 * Tero apagado, al inicio, aunque alguien llegue por un enlace directo.
 */
export function TeroGate({ children }: { children: ReactNode }) {
  const { user, isRestoring } = useAuth();
  const { enabled } = useTero();

  if (isRestoring) return null;
  if (!user) return <Redirect href="/login" />;
  if (!enabled) return <Redirect href="/home" />;
  return <>{children}</>;
}
