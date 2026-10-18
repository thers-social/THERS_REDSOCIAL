// Preguntas a Tero con una imagen (ADR-046), lado navegador.
//
// La imagen se reduce aquí (una foto de móvil pesa varios MB y el modelo cobra por tamaño) y viaja en
// el JSON como base64. El servidor la vuelve a decodificar por su contenido, la reduce otra vez, le quita
// los metadatos y NO la guarda: va al proveedor de IA (Anthropic) y se descarta.

import { ImageSelectionError, prepareImage } from "@shared/lib/imageAttachments";

// Apagado salvo que valga exactamente "true": cuesta por uso y la imagen sale a un tercero. El servidor
// tiene su propio interruptor (TERO_IMAGES_ENABLED); con este encendido y el servidor apagado, Tero
// responde «todavía no puede ver imágenes».
export const TERO_IMAGES_ENABLED = import.meta.env.VITE_TERO_IMAGES_ENABLED === "true";

/** Lado mayor al que se reduce antes de enviarla: lo que el servidor entrega al modelo como máximo. */
export const TERO_IMAGE_MAX_SIDE = 1280;

function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(new ImageSelectionError("No se pudo leer esa imagen. Prueba con otra."));
    reader.readAsDataURL(blob);
  });
}

/** `{ media_type, data }` listo para el campo `image` de `POST /api/tero/chat`. */
export async function imageToPayload(file) {
  const prepared = await prepareImage(file, TERO_IMAGE_MAX_SIDE);
  const data = await readAsBase64(prepared);
  if (!data) throw new ImageSelectionError("No se pudo leer esa imagen. Prueba con otra.");
  return { media_type: prepared.type, data };
}

/** URL `data:` para mostrar la miniatura de lo que se envió. */
export function previewUrl(payload) {
  return payload ? `data:${payload.media_type};base64,${payload.data}` : null;
}
