import { Share } from 'react-native';

/**
 * Comparte un perfil con el menú de compartir del sistema. El enlace usa el esquema de la app
 * (`thers://user/<id>`, resuelto por Expo Router): abre el perfil solo en teléfonos con THERS
 * instalada; no hay todavía una página web pública de perfiles.
 */
export function profileLink(userId: string): string {
  return `thers://user/${userId}`;
}

export async function shareProfile(person: { id: string; name: string; username: string }) {
  await Share.share({
    message: `${person.name} (@${person.username}) en THERS\n${profileLink(person.id)}`,
  });
}
