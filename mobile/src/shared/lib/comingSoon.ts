import { Alert } from 'react-native';

/**
 * Aviso común para lo que el diseño aprobado muestra pero el backend aún no
 * soporta (historias, guardados, grupos…). No se simulan datos: se dice la verdad.
 */
export function comingSoon(feature?: string) {
  Alert.alert('Próximamente', feature ? `${feature} llegará pronto a THERS.` : 'Esta función llegará pronto a THERS.');
}
