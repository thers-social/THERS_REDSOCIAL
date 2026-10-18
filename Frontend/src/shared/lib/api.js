import axios from "axios";

const DEV_FALLBACK_API_URL = "http://127.0.0.1:5000/api";

if (!import.meta.env.VITE_API_URL) {
  console.warn(
    "[api] VITE_API_URL no está definida; usando el valor de desarrollo local " +
    DEV_FALLBACK_API_URL + ". Definir VITE_API_URL en Frontend/.env para otros entornos."
  );
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || DEV_FALLBACK_API_URL
});

// Traduce errores de axios a un mensaje entendible para el usuario, siguiendo
// el contrato de error documentado en API_CONTRACT.md (400/401/409/429,
// body {"msg": "..."}). Nunca expone detalles internos (stack traces, texto
// crudo del error de red).
//
// `t` es la función de shared/i18n (useLanguage().t) -- se recibe como
// parámetro en vez de importar el contexto acá para que este módulo siga
// siendo un cliente HTTP puro, sin depender de React. El texto que devuelve
// el propio backend (`data.msg`) no se traduce: es contenido que no
// controlamos desde el Frontend.
export function getErrorMessage(error, t) {
  if (!error.response) {
    return t("errors.network");
  }

  const { status, data } = error.response;

  if (status === 429) {
    // Rate limiting (ADR-027-rate-limiting.md). Se construye el mensaje acá en
    // vez de usar el `msg` del backend porque ese texto no puede incluir la
    // espera ya formateada -- y decir "demasiados intentos" sin decir cuánto
    // esperar deja a la persona reintentando a ciegas.
    //
    // `retry_after_seconds` viaja en el body además del header `Retry-After`
    // justamente para esto: leer headers desde axios es posible pero el body ya
    // está a mano en todos los llamadores.
    const seconds = Number(data?.retry_after_seconds) || 0;
    if (seconds >= 60) {
      return t("errors.tooManyAttemptsMinutes", { minutes: Math.ceil(seconds / 60) });
    }
    return t("errors.tooManyAttemptsSeconds", { seconds: Math.max(1, seconds) });
  }

  if (status === 401) {
    // Una sesión que terminó (refresh vencido o revocado) no es una contraseña incorrecta.
    if (error.sessionExpired) return t("errors.sessionExpired");
    return t("errors.invalidCredentials");
  }

  if (status === 403) {
    // Cubre, entre otros, POST /api/login con una cuenta todavía sin
    // verificar (ADR-011-mandatory-email-verification.md) -- Login.jsx ya
    // distingue ese caso específico por su cuerpo (`email_verified: false`)
    // para redirigir a la pantalla de verificación en vez de mostrar este
    // mensaje genérico, así que este branch solo cubre cualquier otro 403.
    return (data && data.msg) || t("errors.unexpected");
  }

  if (status === 409) {
    return (data && data.msg) || t("errors.emailInUse");
  }

  if (status === 400) {
    return (data && data.msg) || t("errors.checkData");
  }

  return t("errors.unexpected");
}