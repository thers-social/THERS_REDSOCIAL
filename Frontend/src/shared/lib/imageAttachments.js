// Preparación en el navegador de las imágenes que se adjuntan a publicaciones y
// mensajes (ADR-039).
//
// El servidor vuelve a validar y re-codificar TODO (por contenido, nunca por lo
// que diga el navegador), así que esto no es una barrera de seguridad: es
// experiencia de uso. Una foto de móvil pesa fácilmente más de los 5 MB que
// acepta el servidor; reducirla aquí evita un error inútil y ahorra datos
// móviles al subir.

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Solo se re-codifica si hace falta: una imagen pequeña y ya liviana se sube tal cual.
const REENCODE_ABOVE_BYTES = 1.5 * 1024 * 1024;

export class ImageSelectionError extends Error {}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Valida y, si hace falta, reduce una imagen. Devuelve un `File` listo para
 * subir. Lanza `ImageSelectionError` con un mensaje apto para mostrar.
 */
export async function prepareImage(file, maxSide) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new ImageSelectionError("Solo se permiten imágenes JPEG, PNG o WebP.");
  }

  let bitmap;
  try {
    // `from-image`: respeta la orientación EXIF de las fotos del móvil.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageSelectionError("No se pudo leer esa imagen. Prueba con otra.");
  }

  try {
    const longSide = Math.max(bitmap.width, bitmap.height);
    const needsResize = longSide > maxSide;
    if (!needsResize && file.size <= REENCODE_ABOVE_BYTES) {
      return file;
    }

    const scale = needsResize ? maxSide / longSide : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // WebP si el navegador lo soporta; si no, `toBlob` devuelve PNG (pesado), y se
    // cae a JPEG.
    let blob = await canvasToBlob(canvas, "image/webp", 0.85);
    let extension = "webp";
    if (!blob || blob.type !== "image/webp") {
      blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
      extension = "jpg";
    }

    if (!blob) {
      throw new ImageSelectionError("No se pudo preparar esa imagen. Prueba con otra.");
    }
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new ImageSelectionError("La imagen pesa demasiado. El máximo es 5 MB.");
    }

    const baseName = (file.name || "foto").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.${extension}`, { type: blob.type });
  } finally {
    bitmap.close?.();
  }
}
