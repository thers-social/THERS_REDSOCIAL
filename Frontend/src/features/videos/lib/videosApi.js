// Cliente HTTP de Reels (contrato: API_CONTRACT.md §4.40, ADR-043-A).

import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";

function authConfig(extra = {}) {
  return { ...extra, headers: { Authorization: `Bearer ${getStoredToken()}` } };
}

/** Reels que puedes ver (listos Y aprobados). `{videos, has_more}`; 404 si el módulo está apagado. */
export async function fetchFeed({ limit = 10, offset = 0, author } = {}, signal) {
  const { data } = await api.get(
    "/videos",
    authConfig({ params: { limit, offset, ...(author ? { author } : {}) }, signal }),
  );
  return data;
}

/** Los propios, con su estado. */
export async function fetchMine(signal) {
  const { data } = await api.get("/videos/mine", authConfig({ signal }));
  return data.videos;
}

/** Reserva una subida directa a Mux. Devuelve `{id, status, upload_url}`. */
export async function reserveUpload({ caption, idempotencyKey }) {
  const body = {};
  if (caption && caption.trim()) body.caption = caption.trim();
  const { data } = await api.post(
    "/videos/uploads",
    body,
    // La clave viaja en el encabezado `Idempotency-Key`; `authConfig` no sirve aquí porque
    // reemplazaría los encabezados.
    { headers: { Authorization: `Bearer ${getStoredToken()}`, "Idempotency-Key": idempotencyKey } },
  );
  return data.video;
}

/**
 * Sube el archivo DIRECTO a Mux (no pasa por Flask), con progreso. La URL viene del servidor y es de
 * un solo uso; no lleva credenciales de THERS, por eso no se manda el JWT.
 */
export function uploadToMux(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("upload_failed")));
    request.onerror = () => reject(new Error("upload_failed"));
    request.send(file);
  });
}

export async function deleteVideo(id) {
  await api.delete(`/videos/${id}`, authConfig());
}
