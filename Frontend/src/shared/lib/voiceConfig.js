// Interruptor de las notas de voz en la web (ADR-042). Apagado salvo que valga exactamente
// "true": una función en evolución no debe aparecer en una build por olvidar la variable.
// Como toda VITE_*, queda en el bundle: es un interruptor, no un secreto. El servidor tiene el
// suyo (VOICE_MESSAGES_ENABLED); con este encendido y el servidor apagado, enviar muestra
// «Las notas de voz no están disponibles ahora».
export const VOICE_ENABLED = import.meta.env.VITE_VOICE_ENABLED === "true";

// Dictado para Tero (ADR-042 §1.2): independiente del anterior.
export const TERO_VOICE_ENABLED = import.meta.env.VITE_TERO_VOICE_ENABLED === "true";
