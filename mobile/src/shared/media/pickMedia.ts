/**
 * Selector de fotos y videos de la galería (ADR-046): envuelve `expo-image-picker` y devuelve la forma
 * normalizada de `mediaRules`. En Android moderno el sistema usa su selector propio (Photo Picker), que
 * no pide ningún permiso: la app solo recibe lo que la persona elige.
 *
 * Solo la galería: no se abre la cámara ni se pide el micrófono.
 */

import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import type { ImagePickerAsset } from 'expo-image-picker';

import { fileNameFor, mediaProblem, resolveMimeType } from './mediaRules';
import type { MediaKind, PickedMedia } from './mediaRules';

/** Calidad de la foto que entrega el selector: ya viene reducida, y el servidor la vuelve a reducir. */
const IMAGE_QUALITY = 0.8;

export class MediaSelectionError extends Error {}

function normalize(asset: ImagePickerAsset, kind: MediaKind): PickedMedia {
  const mimeType = resolveMimeType(kind, asset.mimeType, asset.uri) as string;
  return {
    uri: asset.uri,
    kind,
    name: fileNameFor(kind, mimeType),
    mimeType,
    width: asset.width,
    height: asset.height,
    size: typeof asset.fileSize === 'number' ? asset.fileSize : sizeOf(asset.uri),
    durationMs: kind === 'video' && typeof asset.duration === 'number' ? Math.round(asset.duration) : null,
  };
}

/** Peso real del archivo en el teléfono cuando el selector no lo informa. */
function sizeOf(uri: string): number | null {
  try {
    const size = new File(uri).size;
    return typeof size === 'number' ? size : null;
  } catch {
    return null;
  }
}

/** Elige hasta `limit` fotos. Devuelve `[]` si la persona cancela. Lanza `MediaSelectionError` con un texto apto para mostrar. */
export async function pickImages(limit: number): Promise<PickedMedia[]> {
  if (limit <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: IMAGE_QUALITY,
    exif: false,
  });
  if (result.canceled) return [];
  const picked: PickedMedia[] = [];
  for (const asset of result.assets.slice(0, limit)) {
    const media = normalize(asset, 'image');
    const problem = mediaProblem(media);
    if (problem) throw new MediaSelectionError(problem);
    picked.push(media);
  }
  return picked;
}

/** Elige UNA foto y la devuelve con su contenido en base64 (para Tero, que la recibe dentro del JSON). */
export async function pickImageBase64(): Promise<(PickedMedia & { base64: string }) | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.6,
    base64: true,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  if (!asset.base64) throw new MediaSelectionError('No pudimos leer esa foto. Prueba con otra.');
  return { ...normalize(asset, 'image'), base64: asset.base64 };
}

/** Elige UN video. Devuelve `null` si la persona cancela. */
export async function pickVideo(): Promise<PickedMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    // Pista para el sistema (algunos selectores la respetan); la comprobación real es la de abajo y la del servidor.
    videoMaxDuration: 60,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const media = normalize(result.assets[0], 'video');
  const problem = mediaProblem(media);
  if (problem) throw new MediaSelectionError(problem);
  return media;
}
