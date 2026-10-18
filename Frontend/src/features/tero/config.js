// Interruptor de Tero en la web (ADR-041). Encendido salvo que valga exactamente
// "false": Tero sale en cualquier build sin tener que acordarse de la variable, y
// quien quiera apagarlo en un entorno la fija a "false". Como toda VITE_*, queda en
// el bundle: es un interruptor, no un secreto. El servidor tiene los suyos
// (TERO_ENABLED, TERO_AI_ENABLED...): con el servidor apagado solo muestra
// «Tero no está disponible».
export const TERO_ENABLED = import.meta.env.VITE_TERO_ENABLED !== "false";
