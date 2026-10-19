import { Alert } from 'react-native';

import { translateNow } from '@shared/i18n';

/**
 * Aviso común para lo que el diseño aprobado muestra pero el backend aún no
 * soporta (historias destacadas, atajos de IA…). No se simulan datos: se dice la verdad.
 * `feature` ya viene traducido por quien llama.
 */
export function comingSoon(feature?: string) {
  Alert.alert(
    translateNow('coming.title'),
    feature ? translateNow('coming.feature', { feature }) : translateNow('coming.generic'),
  );
}
