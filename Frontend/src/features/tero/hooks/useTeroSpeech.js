import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectLanguage,
  rankedVoices,
  resolveVoice,
  speechLang,
  speechSupported,
  speechText,
  TERO_PITCH,
  TERO_RATE,
} from "../lib/teroSpeech";

/**
 * Tero habla (ADR-045) con la síntesis de voz del navegador, **en el idioma de la respuesta**: si Tero
 * contesta en inglés, lee con una voz en inglés. `speak(texto)` lee la respuesta ya limpia de Markdown y
 * emoji con la voz elegida para ese idioma (o la mejor disponible); `speaking` es `true` mientras suena
 * (el avatar mueve la boca). `voices` son las voces de cada idioma, de la mejor a la peor. Se calla al
 * desmontar y al ocultar la pestaña. El texto no sale del dispositivo.
 */
export default function useTeroSpeech({ preferredVoices }) {
  const supported = speechSupported(typeof window === "undefined" ? null : window);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState({ es: [], en: [] });
  const mounted = useRef(true);
  const preferredRef = useRef(preferredVoices);
  preferredRef.current = preferredVoices;

  // Las voces se cargan solas y a veces tarde (Chrome las anuncia con `voiceschanged`).
  useEffect(() => {
    if (!supported) return undefined;
    const synth = window.speechSynthesis;
    const load = () => {
      const all = synth.getVoices();
      setVoices({ es: rankedVoices(all, "es"), en: rankedVoices(all, "en") });
    };
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    if (mounted.current) setSpeaking(false);
  }, [supported]);

  /** `voiceName` y `family` fuerzan una voz y un idioma (la vista previa del selector). */
  const speak = useCallback(
    (raw, voiceName, family) => {
      if (!supported) return;
      const text = speechText(raw);
      if (!text) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const language = family ?? detectLanguage(text);
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = speechLang(language);
      const voice = resolveVoice(synth.getVoices(), voiceName ?? preferredRef.current?.[language], language);
      if (voice) utterance.voice = voice;
      utterance.pitch = TERO_PITCH;
      utterance.rate = TERO_RATE;
      utterance.onstart = () => mounted.current && setSpeaking(true);
      utterance.onend = () => mounted.current && setSpeaking(false);
      utterance.onerror = () => mounted.current && setSpeaking(false);
      synth.speak(utterance);
    },
    [supported]
  );

  useEffect(() => {
    mounted.current = true;
    const onHidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onHidden);
      if (supported) window.speechSynthesis.cancel();
    };
  }, [stop, supported]);

  return { supported, speaking, speak, stop, voices };
}
