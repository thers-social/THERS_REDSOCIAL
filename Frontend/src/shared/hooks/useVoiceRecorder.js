import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_VOICE_SECONDS,
  pickRecordingMime,
  recordingErrorKind,
  recordingProblem,
  recordingUnavailableReason,
} from "@shared/lib/voice";

const TICK_MS = 200;

function environment() {
  return {
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : true,
    hasMediaRecorder: typeof window !== "undefined" && typeof window.MediaRecorder === "function",
    hasGetUserMedia: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
  };
}

/**
 * Graba una nota de voz con el micrófono (ADR-042).
 *
 * Estados: `idle` → `requesting` (pidiendo permiso) → `recording` → `recorded` (lista para
 * escuchar y enviar). El micrófono se pide SOLO al llamar a `start()` y se suelta (se apagan
 * las pistas) en cuanto termina, se cancela o el componente se desmonta: el icono de
 * «grabando» del navegador nunca queda encendido de más.
 *
 * `unavailable` es la clave del motivo si este navegador no puede grabar (o `null`): la
 * interfaz oculta el botón en vez de mostrar uno que no funciona.
 */
export default function useVoiceRecorder({ maxSeconds = MAX_VOICE_SECONDS } = {}) {
  const [status, setStatus] = useState("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState(null); // { blob, url, durationMs, mime }
  const [error, setError] = useState(null); // clave de `voice.errors.*`

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const cancelledRef = useRef(false);
  const urlRef = useRef(null);

  const unavailable = recordingUnavailableReason(environment());

  const releaseStream = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const revokeUrl = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const clear = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // ya estaba detenido
      }
    }
    releaseStream();
    revokeUrl();
    chunksRef.current = [];
    setRecording(null);
    setElapsedMs(0);
    setError(null);
    setStatus("idle");
  }, [releaseStream, revokeUrl]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (status === "requesting" || status === "recording") return;
    if (unavailable) {
      setError(unavailable);
      return;
    }
    revokeUrl();
    setRecording(null);
    setError(null);
    setStatus("requesting");

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      setError(recordingErrorKind(e));
      setStatus("idle");
      return;
    }

    try {
      const mime = pickRecordingMime((type) => window.MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        releaseStream();
        setError("generic");
        setStatus("idle");
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const type = recorder.mimeType || mime || "audio/webm";
        releaseStream();
        if (cancelledRef.current) return;
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        const problem = recordingProblem({ durationMs, size: blob.size });
        if (problem) {
          setError(problem);
          setElapsedMs(0);
          setStatus("idle");
          return;
        }
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setElapsedMs(durationMs);
        setRecording({ blob, url, durationMs, mime: type });
        setStatus("recorded");
      };

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      // Un trozo por segundo: si algo falla a mitad no se pierde todo lo grabado.
      recorder.start(1000);
      setStatus("recording");
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= maxSeconds * 1000) stop();
      }, TICK_MS);
    } catch (e) {
      stream.getTracks().forEach((track) => track.stop());
      setError(recordingErrorKind(e));
      setStatus("idle");
    }
  }, [status, unavailable, maxSeconds, releaseStream, revokeUrl, stop]);

  // Soltar el micrófono y la URL del blob si la pantalla se cierra a mitad de una grabación.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // ya estaba detenido
        }
      }
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  return { status, elapsedMs, recording, error, unavailable, start, stop, clear, maxSeconds };
}
