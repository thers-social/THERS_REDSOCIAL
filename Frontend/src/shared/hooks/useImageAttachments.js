import { useCallback, useEffect, useRef, useState } from "react";
import { ImageSelectionError, prepareImage } from "@shared/lib/imageAttachments";

/**
 * Estado de las imágenes que una persona va a adjuntar (ADR-039): la lista, la
 * vista previa de cada una, los errores de selección y la liberación de las URL
 * temporales del navegador.
 *
 * `max`: cuántas se permiten (4 en publicaciones, 1 en mensajes).
 * `maxSide`: lado mayor al que se reducen antes de subirlas.
 */
export default function useImageAttachments({ max, maxSide }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  // Copia para liberar las vistas previas al desmontar sin depender del estado
  // que existía al montar.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    },
    []
  );

  const add = useCallback(
    async (fileList) => {
      const incoming = Array.from(fileList || []);
      if (incoming.length === 0) return;

      setError("");
      const room = max - itemsRef.current.length;
      if (room <= 0) {
        setError(max === 1 ? "Solo puedes adjuntar una imagen." : `Máximo ${max} imágenes.`);
        return;
      }
      if (incoming.length > room) {
        setError(max === 1 ? "Solo puedes adjuntar una imagen." : `Máximo ${max} imágenes.`);
      }

      setProcessing(true);
      try {
        for (const file of incoming.slice(0, room)) {
          try {
            const prepared = await prepareImage(file, maxSide);
            const item = {
              id: crypto.randomUUID(),
              file: prepared,
              previewUrl: URL.createObjectURL(prepared),
            };
            setItems((prev) => [...prev, item]);
          } catch (selectionError) {
            if (selectionError instanceof ImageSelectionError) {
              setError(selectionError.message);
            } else {
              throw selectionError;
            }
          }
        }
      } finally {
        setProcessing(false);
      }
    },
    [max, maxSide]
  );

  const remove = useCallback((id) => {
    setError("");
    setItems((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setError("");
    setItems((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, []);

  return { items, files: items.map((item) => item.file), error, processing, add, remove, clear };
}
