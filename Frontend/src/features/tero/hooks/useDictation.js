import { useCallback, useEffect, useRef, useState } from "react";
import {
  dictationErrorKind,
  dictationUnavailableReason,
  speechRecognitionCtor,
  transcriptFromResults,
} from "../lib/teroVoice";

/**
 * Dictado para Tero con el reconocimiento de voz del navegador (ADR-042 §1.2).
 *
 * El navegador (Chrome → Google, Safari → Apple) convierte la voz en texto; THERS no recibe
 * el audio. `onTranscript(text)` se llama con lo dicho hasta ahora (parcial o final) y quien lo usa
 * lo pone en el campo de texto: NUNCA se envía solo.
 *
 * El micrófono se pide SOLO al llamar a `start()`. `listening` es `true` mientras escucha y se
 * apaga solo al callar la persona, al detenerlo o al desmontar el componente.
 */
export default function useDictation({ lang, onTranscript }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null); // clave de `tero.voice.errors.*`
  const recognitionRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const unavailable = dictationUnavailableReason(typeof window === "undefined" ? null : window);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // ya estaba detenido
      }
    }
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current) return;
    if (unavailable) {
      setError(unavailable);
      return;
    }
    const Ctor = speechRecognitionCtor(window);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      onTranscriptRef.current?.(transcriptFromResults(event.results));
    };
    recognition.onerror = (event) => {
      const kind = dictationErrorKind(event.error);
      if (kind) setError(kind);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    setError(null);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setError("generic");
    }
  }, [lang, unavailable]);

  // Soltar el micrófono si el panel se cierra a mitad de un dictado.
  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onend = null;
        recognition.onresult = null;
        recognition.onerror = null;
        try {
          recognition.abort();
        } catch {
          // ya estaba detenido
        }
        recognitionRef.current = null;
      }
    },
    []
  );

  return { listening, error, unavailable, start, stop };
}
