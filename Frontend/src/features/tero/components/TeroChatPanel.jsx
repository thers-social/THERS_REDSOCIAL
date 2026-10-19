import { useEffect, useId, useRef, useState } from "react";
import { IoClose, IoImageOutline, IoMic, IoRefresh, IoSend, IoTrashOutline, IoVolumeHigh, IoVolumeMute } from "react-icons/io5";
import { useLanguage } from "@shared/i18n";
import { TERO_VOICE_ENABLED } from "@shared/lib/voiceConfig";
import useDictation from "../hooks/useDictation";
import useTeroSpeech from "../hooks/useTeroSpeech";
import { ImageSelectionError } from "@shared/lib/imageAttachments";
import { MAX_MESSAGE_LENGTH } from "../lib/teroChat";
import { TERO_IMAGES_ENABLED, imageToPayload, previewUrl } from "../lib/teroImage";
import {
  VOICE_SAMPLES,
  readSpeakPreference,
  readVoicePreference,
  writeSpeakPreference,
  writeVoicePreference,
} from "../lib/teroSpeech";
import { joinDictation, recognitionLang } from "../lib/teroVoice";
import TeroAvatar from "./TeroAvatar";
import TeroActionCard from "./TeroActionCard";

const SUGGESTIONS = ["whoToFollow", "recommendPlace", "reservePlace", "improveBio", "whatCanYouDo"];

/**
 * Panel de conversación con Tero. Solo dibuja: el estado y las llamadas viven en
 * `useTeroChat`. Accesible: es un diálogo no modal con nombre, Escape lo cierra y
 * devuelve el foco, y las respuestas se anuncian con `aria-live`.
 */
export default function TeroChatPanel({ chat, onClose }) {
  const { t, language } = useLanguage();
  const { messages, cardStates, mood, pending, error, inputError, send, confirm, cancel, clear } = chat;
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const titleId = useId();

  // Imagen adjunta a la pregunta (ADR-046): una sola, ya reducida y en base64.
  const imageInputRef = useRef(null);
  const [attached, setAttached] = useState(null);
  const [imageError, setImageError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const chooseImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImageError("");
    setPreparing(true);
    try {
      setAttached(await imageToPayload(file));
    } catch (error) {
      setImageError(error instanceof ImageSelectionError ? error.message : t("tero.image.failed"));
    } finally {
      setPreparing(false);
    }
  };

  // La voz de Tero (ADR-045): lee sus respuestas con la síntesis del navegador, salvo que se silencie.
  const [voiceNames, setVoiceNames] = useState(() => {
    const storage = typeof window === "undefined" ? null : window.localStorage;
    return { es: readVoicePreference(storage, "es"), en: readVoicePreference(storage, "en") };
  });
  const speech = useTeroSpeech({ preferredVoices: voiceNames });
  const [speakOn, setSpeakOn] = useState(() =>
    readSpeakPreference(typeof window === "undefined" ? null : window.localStorage)
  );
  const spokenId = useRef(messages.at(-1)?.id); // lo que ya estaba al abrir el panel no se vuelve a leer
  const { speak, stop: stopSpeech } = speech;
  useEffect(() => {
    const last = messages.at(-1);
    if (!last || last.id === spokenId.current) return;
    spokenId.current = last.id;
    if (last.role === "tero" && speakOn) speak(last.text);
  }, [messages, speakOn, speak]);
  const chooseVoice = (family, name) => {
    const next = name || null;
    setVoiceNames((current) => ({ ...current, [family]: next }));
    writeVoicePreference(typeof window === "undefined" ? null : window.localStorage, next, family);
    speak(VOICE_SAMPLES[family], next, family);
  };
  const toggleSpeech = () => {
    stopSpeech();
    const next = !speakOn;
    setSpeakOn(next);
    writeSpeakPreference(typeof window === "undefined" ? null : window.localStorage, next);
  };

  // Dictado (ADR-042 §1.2): lo dicho va al campo para que la persona lo revise; nunca se envía solo.
  // Dictar no borra lo que ya había escrito: se guarda el texto de partida y se le añade lo dictado.
  const dictationBase = useRef("");
  const dictation = useDictation({
    lang: recognitionLang(language),
    onTranscript: (text) => setDraft(joinDictation(dictationBase.current, text)),
  });
  const dictationAvailable = TERO_VOICE_ENABLED && dictation.unavailable !== "unsupported";
  const toggleDictation = () => {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    stopSpeech();
    dictationBase.current = draft;
    dictation.start();
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Lleva la conversación al último mensaje al llegar uno nuevo.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, pending]);

  const submit = async (event) => {
    event?.preventDefault();
    if (pending) return;
    stopSpeech();
    dictation.stop();
    const text = draft;
    const image = attached;
    const ok = await send(text, { image });
    if (ok) {
      setDraft("");
      setAttached(null);
    }
    inputRef.current?.focus();
  };

  const onKeyDown = (event) => {
    // Enter envía; Mayús+Enter hace salto de línea.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  const retry = (message) => send(message.text, { retryId: message.id, image: message.image ?? null });

  const suggest = async (key) => {
    if (pending) return;
    await send(t(`tero.suggestions.${key}`));
  };

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      className="tero-panel-enter fixed inset-x-3 bottom-[calc(var(--th-bottomnav-h)+env(safe-area-inset-bottom)+76px)] z-50 flex max-h-[min(36rem,calc(100dvh-8rem))] flex-col overflow-hidden rounded-3xl border border-th-border bg-th-surface shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[24rem] lg:bottom-24 lg:right-6"
    >
      <header className="flex items-center gap-3 border-b border-th-border-subtle px-4 py-3">
        <TeroAvatar size={40} mood={speech.speaking && !pending ? "speaking" : mood} />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-bold text-th-fg-strong">
            {t("tero.name")}
          </h2>
          <p className="truncate text-xs text-th-fg-muted">
            {pending ? t("tero.thinking") : t("tero.tagline")}
          </p>
        </div>
        {speech.supported ? (
          <button
            type="button"
            onClick={toggleSpeech}
            aria-pressed={speakOn}
            aria-label={speakOn ? t("tero.speech.on") : t("tero.speech.off")}
            title={speakOn ? t("tero.speech.on") : t("tero.speech.off")}
            className="rounded-full p-2 text-th-fg-muted hover:bg-th-surface-subtle hover:text-th-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-th-brand"
          >
            {speakOn ? <IoVolumeHigh aria-hidden="true" size={18} /> : <IoVolumeMute aria-hidden="true" size={18} />}
          </button>
        ) : null}
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={clear}
            aria-label={t("tero.clear")}
            title={t("tero.clear")}
            className="rounded-full p-2 text-th-fg-muted hover:bg-th-surface-subtle hover:text-th-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-th-brand"
          >
            <IoTrashOutline aria-hidden="true" size={18} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("tero.close")}
          className="rounded-full p-2 text-th-fg-muted hover:bg-th-surface-subtle hover:text-th-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-th-brand"
        >
          <IoClose aria-hidden="true" size={20} />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <div className="py-2">
            <p className="text-sm text-th-fg">{t("tero.welcome")}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => suggest(key)}
                    className="rounded-full border border-th-border-strong px-3 py-1.5 text-sm text-th-fg hover:bg-th-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-th-brand"
                  >
                    {t(`tero.suggestions.${key}`)}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-th-fg-muted">{t("tero.privacyNote")}</p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className={`tero-msg-enter flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${message.role === "user" ? "" : "w-full"}`}>
              <div
                className={`whitespace-pre-wrap break-words rounded-2xl text-sm ${
                  message.image ? "p-[3px]" : "px-3.5 py-2"
                } ${
                  message.role === "user"
                    ? "bg-[#5b21b6] text-white dark:bg-[#4c1d95]"
                    : "bg-th-surface-subtle text-th-fg"
                } ${message.status === "failed" ? "opacity-70" : ""}`}
              >
                {message.image && (
                  <img
                    src={previewUrl(message.image)}
                    alt={t("tero.image.sent")}
                    className="max-h-40 w-auto rounded-[13px]"
                  />
                )}
                {message.image && message.text ? (
                  <span className="block px-2.5 pb-1 pt-1.5">{message.text}</span>
                ) : (
                  message.text
                )}
              </div>
              {message.status === "failed" ? (
                <button
                  type="button"
                  onClick={() => retry(message)}
                  disabled={pending}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-th-danger-fg hover:underline disabled:opacity-50"
                >
                  <IoRefresh aria-hidden="true" size={14} />
                  {t("tero.retry")}
                </button>
              ) : null}
              {message.cards?.map((card) => (
                <TeroActionCard
                  key={card.id}
                  card={card}
                  state={cardStates[card.id] ?? { status: "pending" }}
                  onConfirm={confirm}
                  onCancel={cancel}
                />
              ))}
            </div>
          </div>
        ))}

        {error ? (
          <p role="alert" className="rounded-xl bg-th-danger-surface px-3 py-2 text-sm text-th-danger-fg">
            {t(`tero.errors.${error}`)}
          </p>
        ) : null}
      </div>

      <form onSubmit={submit} className="border-t border-th-border-subtle p-3">
        <div className="flex items-end gap-2">
          <label htmlFor={`${titleId}-input`} className="sr-only">
            {t("tero.inputLabel")}
          </label>
          <textarea
            id={`${titleId}-input`}
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH + 200}
            placeholder={t("tero.placeholder")}
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-th-border-strong bg-th-bg px-3 py-2 text-sm text-th-fg placeholder:text-th-fg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-th-brand"
          />
          {TERO_IMAGES_ENABLED ? (
            <>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={chooseImage}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={pending || preparing || attached !== null}
                aria-label={t("tero.image.attach")}
                title={t("tero.image.attach")}
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-th-border-strong text-th-fg transition hover:bg-th-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-th-brand disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IoImageOutline aria-hidden="true" size={18} />
              </button>
            </>
          ) : null}
          {dictationAvailable ? (
            <button
              type="button"
              onClick={toggleDictation}
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? t("tero.voice.stop") : t("tero.voice.start")}
              title={dictation.unavailable === "insecure" ? t("tero.voice.errors.insecure") : undefined}
              disabled={pending}
              className={`flex h-10 w-10 flex-none items-center justify-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-th-brand disabled:cursor-not-allowed disabled:opacity-50 ${
                dictation.listening
                  ? "border-th-danger-accent bg-th-danger-surface text-th-danger-fg"
                  : "border-th-border-strong text-th-fg hover:bg-th-surface-subtle"
              }`}
            >
              <IoMic aria-hidden="true" size={18} />
            </button>
          ) : null}
          <button
            type="submit"
            disabled={pending || preparing || (!draft.trim() && !attached)}
            aria-label={t("tero.send")}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-th-brand text-th-on-brand transition hover:bg-th-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-th-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IoSend aria-hidden="true" size={18} />
          </button>
        </div>
        {attached ? (
          <div className="mt-2 flex items-center gap-2">
            <img src={previewUrl(attached)} alt={t("tero.image.preview")} className="h-14 w-14 rounded-xl border border-th-border object-cover" />
            <button
              type="button"
              onClick={() => setAttached(null)}
              disabled={pending}
              className="text-xs font-semibold text-th-danger-fg hover:underline disabled:opacity-50"
            >
              {t("tero.image.remove")}
            </button>
          </div>
        ) : null}
        {TERO_IMAGES_ENABLED && (attached || preparing) ? (
          <p className="mt-1 text-[11px] text-th-fg-muted">{preparing ? t("tero.image.preparing") : t("tero.image.privacy")}</p>
        ) : null}
        {imageError ? (
          <p role="alert" className="mt-1 text-xs text-th-danger-fg">
            {imageError}
          </p>
        ) : null}
        {inputError ? (
          <p role="alert" className="mt-1 text-xs text-th-danger-fg">
            {t(`tero.input.${inputError}`, { max: MAX_MESSAGE_LENGTH })}
          </p>
        ) : null}
        {dictationAvailable && dictation.listening ? (
          <p role="status" className="mt-1 text-xs font-medium text-th-fg">
            {t("tero.voice.listening")}
          </p>
        ) : null}
        {dictationAvailable && dictation.error ? (
          <p role="alert" className="mt-1 text-xs text-th-danger-fg">
            {t(`tero.voice.errors.${dictation.error}`)}
          </p>
        ) : null}
        {dictationAvailable ? (
          <p className="mt-1 text-[11px] text-th-fg-muted">{t("tero.voice.privacy")}</p>
        ) : null}
        {speech.supported && speakOn
          ? ["es", "en"].map((family) =>
              speech.voices[family].length > 1 ? (
                <label key={family} className="mt-2 flex items-center gap-2 text-[11px] text-th-fg-muted">
                  <span className="flex-none">{t(`tero.speech.voice.${family}`)}</span>
                  <select
                    value={voiceNames[family] ?? ""}
                    onChange={(event) => chooseVoice(family, event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-th-border-strong bg-th-bg px-2 py-1 text-xs text-th-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-th-brand"
                  >
                    <option value="">{t("tero.speech.auto")}</option>
                    {speech.voices[family].slice(0, 12).map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null
            )
          : null}
      </form>
    </section>
  );
}
