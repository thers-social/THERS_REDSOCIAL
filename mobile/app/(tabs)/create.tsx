import { Redirect } from 'expo-router';

/**
 * Ruta de relleno del botón central (T-Rayo). La barra pinta su propio botón y
 * lo lleva a `/create`; si alguien llegara aquí por un enlace, se le redirige.
 */
export default function CreateTab() {
  return <Redirect href="/create" />;
}
