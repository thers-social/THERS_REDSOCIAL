/**
 * Interruptor de llamadas en la app. Encendido salvo que valga exactamente `false` (mismo criterio que
 * `EXPO_PUBLIC_TERO_ENABLED`). Es un interruptor, no un secreto: queda embebido en el bundle. El
 * servidor tiene el suyo (`CALLS_ENABLED`) y las claves de LiveKit: con el servidor apagado, llamar
 * muestra «Las llamadas no están disponibles ahora».
 */
export const CALLS_ENABLED = process.env.EXPO_PUBLIC_CALLS_ENABLED !== 'false';
