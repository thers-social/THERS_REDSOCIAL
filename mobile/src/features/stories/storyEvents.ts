/**
 * Aviso mínimo de «las historias cambiaron» (se publicó una desde la hoja de Crear): la tira de Inicio
 * ya está montada y solo carga al montarse, así que escucha esto para volver a pedirlas. Sin estado
 * global ni dependencias: una lista de funciones.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onStoriesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceStoriesChanged(): void {
  for (const listener of [...listeners]) listener();
}
