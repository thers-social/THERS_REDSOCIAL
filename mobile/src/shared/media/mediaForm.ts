/**
 * Adjuntar archivos del teléfono a un `FormData` (ADR-046).
 *
 * OJO: el `fetch` de Expo SDK 57 NO acepta el formato clásico de React Native `{uri, name, type}` (falla
 * con «Unsupported FormDataPart implementation» y la app lo ve como falta de red). El archivo se sube como
 * un `File` de expo-file-system, que es un Blob de verdad (mismo criterio que las notas de voz, ADR-042).
 */

import { File } from 'expo-file-system';

import type { PickedMedia } from './mediaRules';

export function appendMedia(form: FormData, field: string, media: Pick<PickedMedia, 'uri' | 'name'>): void {
  form.append(field, new File(media.uri) as unknown as Blob, media.name);
}

/** Tiempo de espera de una subida con archivos (la red del móvil y el servidor re-codifican). */
export const MEDIA_UPLOAD_TIMEOUT_MS = 90_000;
