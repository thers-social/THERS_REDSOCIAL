import { useRouter } from 'expo-router';
import { useCallback } from 'react';

/**
 * Abre el perfil de una persona. Es el único sitio que sabe la ruta, para que cada «pastilla» de
 * persona de la app (sugerencias, avisos, menciones, comentarios, miembros de un grupo…) lleve al
 * mismo lugar. Si es tu propio id, `/user/[userId]` ya redirige a tu perfil.
 */
export function useOpenProfile() {
  const router = useRouter();
  return useCallback(
    (userId: string) => router.push({ pathname: '/user/[userId]', params: { userId } }),
    [router],
  );
}
