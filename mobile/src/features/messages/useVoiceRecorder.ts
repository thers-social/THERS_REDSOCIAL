/**
 * Graba una nota de voz con el micrófono del teléfono (`ADR-042`).
 *
 * Estados: `idle` → `requesting` (pidiendo permiso) → `recording` → `recorded` (lista para
 * escuchar y enviar). El permiso del micrófono se pide SOLO al llamar a `start()`, nunca al abrir
 * el chat, y el micrófono se suelta en cuanto termina, se cancela o la pantalla se cierra: el
 * indicador de «grabando» de Android nunca queda encendido de más.
 *
 * Formato: AAC en `.m4a`, mono a 24 kHz y 48 kb/s. Suena en cualquier dispositivo y el servidor lo
 * vuelve a normalizar; 2 minutos pesan unos 700 KB, muy por debajo del tope de 3 MiB.
 */

import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import type { RecordingOptions } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MAX_VOICE_SECONDS,
  MIN_VOICE_MS,
  permissionProblem,
  recordingProblem,
  voiceFileName,
  voiceMimeFor,
} from './voice';
import type { VoiceErrorKind, VoiceRecording } from './voice';
import { deleteVoiceFile } from './voiceFiles';

const RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 24000,
  numberOfChannels: 1,
  bitRate: 48000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
};

const TICK_MS = 200;

export type VoiceRecorderApi = {
  status: 'idle' | 'requesting' | 'recording' | 'recorded';
  elapsedMs: number;
  recording: VoiceRecording | null;
  error: VoiceErrorKind | null;
  maxSeconds: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Descarta la grabación (en curso o ya lista), BORRA el archivo y suelta el micrófono. */
  clear: () => Promise<void>;
  /** Entrega la grabación a quien la va a enviar: vuelve a `idle` SIN borrar el archivo. */
  release: () => void;
};

export function useVoiceRecorder(): VoiceRecorderApi {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const [status, setStatus] = useState<VoiceRecorderApi['status']>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState<VoiceRecording | null>(null);
  const [error, setError] = useState<VoiceErrorKind | null>(null);

  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const live = useRef(false);
  const mounted = useRef(true);
  const recordingRef = useRef<VoiceRecording | null>(null);
  recordingRef.current = recording;

  const stopTimer = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  /** Deja el audio listo para REPRODUCIR por el altavoz (con `allowsRecording` suena por el auricular en iOS). */
  const playbackMode = useCallback(async () => {
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      // no es crítico
    }
  }, []);

  const stop = useCallback(async () => {
    if (!live.current) return;
    live.current = false;
    stopTimer();
    const durationMs = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } catch {
      // se trata como grabación vacía abajo
    }
    await playbackMode();
    if (!mounted.current) return;

    const uri = recorder.uri;
    const problem = !uri ? 'tooShort' : recordingProblem({ durationMs });
    if (problem || !uri) {
      deleteVoiceFile(uri);
      setError(problem ?? 'generic');
      setElapsedMs(0);
      setStatus('idle');
      return;
    }
    setElapsedMs(durationMs);
    setRecording({ uri, durationMs, mime: voiceMimeFor(uri), name: voiceFileName(uri) });
    setStatus('recorded');
  }, [recorder, stopTimer, playbackMode]);

  const start = useCallback(async () => {
    if (status === 'requesting' || status === 'recording') return;
    deleteVoiceFile(recordingRef.current?.uri);
    setRecording(null);
    setError(null);
    setStatus('requesting');

    try {
      // El permiso se pide AQUÍ, al pulsar grabar: nunca al abrir el chat.
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      const problem = permissionProblem(permission);
      if (problem) {
        setError(problem);
        setStatus('idle');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      await playbackMode();
      if (mounted.current) {
        setError('busy');
        setStatus('idle');
      }
      return;
    }

    live.current = true;
    startedAt.current = Date.now();
    setElapsedMs(0);
    setStatus('recording');
    timer.current = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_VOICE_SECONDS * 1000) void stop();
    }, TICK_MS);
  }, [status, recorder, stop, playbackMode]);

  const clear = useCallback(async () => {
    stopTimer();
    if (live.current) {
      live.current = false;
      try {
        await recorder.stop();
      } catch {
        // ya estaba detenido
      }
      deleteVoiceFile(recorder.uri);
    }
    deleteVoiceFile(recordingRef.current?.uri);
    await playbackMode();
    if (!mounted.current) return;
    setRecording(null);
    setElapsedMs(0);
    setError(null);
    setStatus('idle');
  }, [recorder, stopTimer, playbackMode]);

  const release = useCallback(() => {
    setRecording(null);
    setElapsedMs(0);
    setError(null);
    setStatus('idle');
  }, []);

  // Soltar el micrófono si la pantalla se cierra a mitad de una grabación.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopTimer();
      if (live.current) {
        live.current = false;
        void recorder.stop().catch(() => undefined);
      }
    };
  }, [recorder, stopTimer]);

  return { status, elapsedMs, recording, error, maxSeconds: MAX_VOICE_SECONDS, start, stop, clear, release };
}

export { MIN_VOICE_MS };
