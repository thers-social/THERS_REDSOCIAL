/**
 * Interruptores de la voz (`ADR-042`). Apagados salvo que valgan exactamente `true`: una función en
 * evolución no debe aparecer en una build por olvidar la variable. Como toda `EXPO_PUBLIC_*`, quedan
 * embebidos en el bundle: son interruptores, no secretos.
 *
 * El servidor tiene el suyo (`VOICE_MESSAGES_ENABLED`): con este encendido y el del servidor apagado,
 * enviar muestra «Las notas de voz no están disponibles ahora».
 */
export const VOICE_ENABLED = process.env.EXPO_PUBLIC_VOICE_ENABLED === 'true';

/** Dictado para Tero (`ADR-042` §1.2): independiente del anterior. */
export const TERO_VOICE_ENABLED = process.env.EXPO_PUBLIC_TERO_VOICE_ENABLED === 'true';
