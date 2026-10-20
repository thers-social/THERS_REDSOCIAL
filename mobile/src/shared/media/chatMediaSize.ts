import { Dimensions } from 'react-native';

/**
 * Lado del cuadrado de toda foto o video dentro de un chat: el mismo con o sin texto. Es una medida fija
 * (no un porcentaje del contenedor) para que no cambie según cómo se acomode la burbuja; en un teléfono
 * angosto se encoge para que quepa.
 */
export const CHAT_MEDIA_SIZE = Math.min(260, Math.round(Dimensions.get('window').width * 0.7));
