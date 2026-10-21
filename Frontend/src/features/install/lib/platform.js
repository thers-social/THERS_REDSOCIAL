/**
 * En qué tipo de dispositivo se abre la web, para decidir qué ofrece «Instalar aplicación»:
 *  - `android`: puede instalar el APK, así que se le ofrece descargarlo.
 *  - `ios`: la app de THERS es solo para Android; se le avisa en vez de darle un archivo inútil.
 *  - `desktop`: es una computadora; se le muestra un código QR para escanearlo con el celular.
 *
 * Se decide por el DISPOSITIVO y no por el ancho de la ventana: una ventana angosta en una
 * computadora sigue siendo una computadora y necesita el QR, no una descarga que no puede instalar.
 */
export function detectPlatform(userAgent = "", maxTouchPoints = 0) {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  // iPadOS 13+ se presenta como un Mac: lo delata la pantalla táctil.
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "desktop";
}

export function currentPlatform() {
  if (typeof navigator === "undefined") return "desktop";
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
}
