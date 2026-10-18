/**
 * Interruptor de Tero (`EXPO_PUBLIC_TERO_ENABLED`). Encendido salvo que valga
 * exactamente `false`: Tero sale en cualquier build sin depender de recordar la
 * variable; para apagarlo en un entorno se fija a `false`.
 *
 * Como toda `EXPO_PUBLIC_*`, queda embebida en el bundle: es un interruptor, no
 * un secreto.
 */
export const TERO_ENABLED = process.env.EXPO_PUBLIC_TERO_ENABLED !== 'false';

/**
 * Conecta el chat de Tero al servidor real (`POST /api/tero/chat`, ADR-041). Encendido salvo que
 * valga exactamente `false`: con `false` el chat usa las respuestas de ejemplo de la fase 1.
 *
 * Es OTRO interruptor porque el servidor también tiene los suyos (`TERO_ENABLED`,
 * `TERO_AI_ENABLED`...): encender este con el servidor apagado solo muestra «Tero no está
 * disponible», no rompe la app. Tampoco es un secreto: queda embebido en el bundle.
 */
export const TERO_LIVE = process.env.EXPO_PUBLIC_TERO_LIVE !== 'false';
