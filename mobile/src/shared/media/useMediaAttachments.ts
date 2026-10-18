import { useCallback, useRef, useState } from 'react';

import { MediaSelectionError, pickImages, pickVideo } from './pickMedia';
import { canAddVideo, imageRoom } from './mediaRules';
import type { PickedMedia } from './mediaRules';

/**
 * Estado de las fotos o el video que una persona va a adjuntar (ADR-046): la lista, el error de
 * selección y el aviso de «ocupado» mientras el sistema abre el selector. Las fotos y el video son
 * excluyentes (el servidor lo exige igual): con un video no se pueden añadir fotos, y viceversa.
 *
 * `maxImages`: cuántas fotos se permiten (4 en publicaciones, 1 en mensajes).
 */
export function useMediaAttachments({ maxImages }: { maxImages: number }) {
  const [items, setItems] = useState<PickedMedia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Siempre la lista más reciente: el selector es asíncrono y no debe decidir con una copia vieja.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    setPicking(true);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof MediaSelectionError ? caught.message : 'No pudimos abrir tu galería. Inténtalo de nuevo.',
      );
    } finally {
      setPicking(false);
    }
  }, []);

  const addImages = useCallback(
    () =>
      run(async () => {
        const room = imageRoom(maxImages, itemsRef.current);
        if (room <= 0) {
          setError(
            itemsRef.current.some((item) => item.kind === 'video')
              ? 'Quita el video para añadir fotos.'
              : maxImages === 1
                ? 'Solo puedes adjuntar una foto.'
                : `Máximo ${maxImages} fotos.`,
          );
          return;
        }
        const picked = await pickImages(room);
        if (picked.length) setItems((current) => [...current, ...picked]);
      }),
    [maxImages, run],
  );

  const addVideo = useCallback(
    () =>
      run(async () => {
        if (!canAddVideo(itemsRef.current)) {
          setError('Quita lo que ya adjuntaste para añadir un video.');
          return;
        }
        const picked = await pickVideo();
        if (picked) setItems([picked]);
      }),
    [run],
  );

  const remove = useCallback((index: number) => {
    setError(null);
    setItems((current) => current.filter((_, position) => position !== index));
  }, []);

  const clear = useCallback(() => {
    setError(null);
    setItems([]);
  }, []);

  const images = items.filter((item) => item.kind === 'image');
  const video = items.find((item) => item.kind === 'video') ?? null;

  return { items, images, video, error, picking, addImages, addVideo, remove, clear };
}

export type MediaAttachments = ReturnType<typeof useMediaAttachments>;
