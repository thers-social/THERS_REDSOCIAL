import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  detectLanguage,
  isPremiumVoice,
  rankedVoices,
  resolveVoice,
  speechLangFor,
  speechText,
  TERO_PITCH,
  TERO_RATE,
} from './teroSpeech';
import type { SpeechFamily, SpeechVoice } from './teroSpeech';
import { useAppActive } from './useAppActive';

/** Voz elegida por idioma de la respuesta; `null` = automática. */
export type TeroVoiceChoice = { es: string | null; en: string | null };

/** Voces del sistema ya normalizadas; la lista se pide una sola vez por sesión. */
let voicesCache: Promise<SpeechVoice[]> | null = null;

export function loadSystemVoices(): Promise<SpeechVoice[]> {
  voicesCache ??= Speech.getAvailableVoicesAsync()
    .then((voices) =>
      voices.map((voice) => ({
        id: voice.identifier,
        name: voice.name,
        lang: voice.language,
        premium: isPremiumVoice({ id: voice.identifier, name: voice.name, quality: voice.quality }),
      })),
    )
    .catch(() => []);
  return voicesCache;
}

/** Las voces del teléfono en un idioma, de la mejor a la peor, para el selector de los ajustes. */
export async function loadVoices(family: SpeechFamily): Promise<SpeechVoice[]> {
  return rankedVoices(await loadSystemVoices(), family);
}

/**
 * Tero habla (ADR-045). `speak(texto)` lee la respuesta con la voz del sistema, ya limpia de Markdown y
 * emoji, **en el idioma de la respuesta** (si Tero contesta en inglés, con una voz en inglés). Usa la voz
 * elegida en los ajustes para ese idioma o, si no hay, la mejor disponible. `speaking` es `true` mientras
 * suena (el avatar mueve la boca). Se calla solo al salir de la pantalla y al pasar a segundo plano.
 */
export function useTeroSpeech(choice?: TeroVoiceChoice) {
  const [speaking, setSpeaking] = useState(false);
  const active = useAppActive();
  const choiceRef = useRef(choice);
  choiceRef.current = choice;

  const stop = useCallback(() => {
    void Speech.stop();
    setSpeaking(false);
  }, []);

  /** `voiceId` y `family` fuerzan una voz y un idioma (la vista previa de los ajustes). */
  const speak = useCallback(async (raw: string, voiceId?: string | null, family?: SpeechFamily) => {
    const text = speechText(raw);
    if (!text) return;
    void Speech.stop();
    const language = family ?? detectLanguage(text);
    const voices = await loadSystemVoices();
    const voice = resolveVoice(voices, voiceId ?? choiceRef.current?.[language], language)?.id;
    Speech.speak(text, {
      language: speechLangFor(language),
      voice,
      pitch: TERO_PITCH,
      rate: TERO_RATE,
      onStart: () => setSpeaking(true),
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }, []);

  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(() => () => void Speech.stop(), []);

  return { speaking, speak, stop };
}
