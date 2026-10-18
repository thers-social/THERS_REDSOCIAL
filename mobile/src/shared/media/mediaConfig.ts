/**
 * Interruptores de las fotos y videos (ADR-046). Los de fotos en publicaciones y mensajes no existen:
 * el servidor las acepta desde `ADR-039` y no cuestan nada especial. Estos dos sí, y nacen apagados
 * salvo que valgan exactamente `true`: una función que gasta CPU del servidor o dinero no debe aparecer
 * en una build por olvidar la variable. Como toda `EXPO_PUBLIC_*`, quedan embebidos en el bundle: son
 * interruptores, no secretos.
 *
 * El servidor tiene los suyos (`VIDEO_UPLOADS_ENABLED`, `TERO_IMAGES_ENABLED`): con el de la app
 * encendido y el del servidor apagado, enviar muestra un aviso claro y no rompe nada.
 */
export const VIDEO_ENABLED = process.env.EXPO_PUBLIC_VIDEO_ENABLED === 'true';

/** Preguntar a Tero con una imagen (la imagen sale a Anthropic y cuesta por uso). */
export const TERO_IMAGES_ENABLED = process.env.EXPO_PUBLIC_TERO_IMAGES_ENABLED === 'true';
