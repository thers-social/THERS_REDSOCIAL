/**
 * Archivos de las grabaciones de voz en el teléfono (`ADR-042`). Es la voz de una persona: no
 * debe quedarse en la caché una vez enviada o descartada, así que se borra explícitamente.
 */

import { File } from 'expo-file-system';

/** Borra el archivo sin fallar nunca: si ya no existe, no hay nada que limpiar. */
export function deleteVoiceFile(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('file:')) return; // nunca una URL remota
  try {
    new File(uri).delete();
  } catch {
    // ya no existía
  }
}
