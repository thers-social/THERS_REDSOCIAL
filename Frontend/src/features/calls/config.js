// Interruptor de llamadas y videollamadas en la web. Encendido salvo que valga exactamente "false"
// (mismo criterio que VITE_TERO_ENABLED). Como toda VITE_*, queda en el bundle: es un interruptor,
// no un secreto. El servidor tiene el suyo (CALLS_ENABLED) y las claves de LiveKit: con el servidor
// apagado, llamar muestra «Las llamadas no están disponibles ahora».
export const CALLS_ENABLED = import.meta.env.VITE_CALLS_ENABLED !== "false";
