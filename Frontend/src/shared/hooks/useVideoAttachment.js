import { useCallback, useEffect, useRef, useState } from "react";
import { readVideoDuration, videoProblem } from "@shared/lib/videoAttachments";

/**
 * Estado del video que una persona va a adjuntar (ADR-046): el archivo, su vista previa, el error de
 * selección y la liberación de la URL temporal del navegador. Uno solo por publicación o mensaje.
 */
export default function useVideoAttachment() {
  const [item, setItem] = useState(null); // { file, previewUrl, durationSeconds }
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  // Copia para liberar la vista previa al desmontar sin depender del estado que existía al montar.
  const itemRef = useRef(item);
  useEffect(() => {
    itemRef.current = item;
  }, [item]);
  useEffect(
    () => () => {
      if (itemRef.current) URL.revokeObjectURL(itemRef.current.previewUrl);
    },
    []
  );

  const add = useCallback(async (fileList) => {
    const file = Array.from(fileList || [])[0];
    if (!file) return;
    setError("");

    // Tipo y peso se comprueban antes de leer nada.
    const early = videoProblem(file);
    if (early) {
      setError(early);
      return;
    }

    setProcessing(true);
    const previewUrl = URL.createObjectURL(file);
    try {
      const durationSeconds = await readVideoDuration(previewUrl);
      const late = videoProblem(file, durationSeconds);
      if (late) {
        URL.revokeObjectURL(previewUrl);
        setError(late);
        return;
      }
      setItem((previous) => {
        if (previous) URL.revokeObjectURL(previous.previewUrl);
        return { file, previewUrl, durationSeconds };
      });
    } finally {
      setProcessing(false);
    }
  }, []);

  const clear = useCallback(() => {
    setError("");
    setItem((previous) => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
  }, []);

  return { item, file: item?.file ?? null, error, processing, add, clear };
}
