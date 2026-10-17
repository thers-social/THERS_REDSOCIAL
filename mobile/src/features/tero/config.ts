/**
 * Interruptor de Tero (`EXPO_PUBLIC_TERO_ENABLED`). Apagado salvo que valga
 * exactamente `true`: una función en vista previa no debe aparecer en una build
 * por olvidar la variable.
 *
 * Como toda `EXPO_PUBLIC_*`, queda embebida en el bundle: es un interruptor, no
 * un secreto.
 */
export const TERO_ENABLED = process.env.EXPO_PUBLIC_TERO_ENABLED === 'true';
