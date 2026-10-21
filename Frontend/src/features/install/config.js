// Archivos de «Instalar aplicación».
//
// El APK vive en Google Drive (archivo `THERS.apk`, compartido con enlace) y el QR lleva a esa misma
// página: no se aloja en el sitio porque pesa decenas de MB y no conviene meterlo en el repositorio.
// Para cambiar de APK basta con actualizar el archivo en Drive: el enlace y el QR siguen valiendo.
// Si algún día se aloja en el propio dominio, poner aquí la ruta (p. ej. "/downloads/thers.apk") y
// cambiar el QR por el del nuevo enlace.
//
// Si un valor es `null`, la web muestra un aviso en su lugar («Aquí irá el código QR» / «La descarga
// estará disponible muy pronto»).

/** Enlace de descarga del APK de Android. */
export const APK_URL =
  "https://drive.google.com/file/d/1T2bbaLB8N5lWcNSbzrrYccJjOX4mxYFr/view?usp=drive_link";

/** Imagen del código QR (686×686) que apunta a `APK_URL`. Está en `public/downloads/`. */
export const QR_IMAGE_URL = "/downloads/thers-qr.png";
