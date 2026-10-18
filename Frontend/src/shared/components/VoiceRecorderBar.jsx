import { IoClose, IoMic, IoSend, IoStop } from "react-icons/io5";
import { useLanguage } from "@shared/i18n";
import { formatDuration } from "@shared/lib/voice";
import VoiceNotePlayer from "./VoiceNotePlayer";

/**
 * Barra que sustituye al campo de texto mientras se graba o se revisa una nota de voz
 * (ADR-042). Solo dibuja: el estado vive en `useVoiceRecorder` y quien la usa decide qué
 * pasa al enviar.
 *
 *  · grabando: punto rojo, tiempo y tope, «Detener» y «Cancelar»;
 *  · grabada: vista previa para escucharla, «Descartar» y «Enviar». Nada se manda solo.
 */
export default function VoiceRecorderBar({ voice, sending, onSend }) {
  const { t } = useLanguage();
  const { status, elapsedMs, recording, maxSeconds } = voice;

  if (status === "recording" || status === "requesting") {
    return (
      <div className="flex flex-1 items-center gap-3" role="group" aria-label={t("voice.recording")}>
        <button
          type="button"
          onClick={voice.clear}
          aria-label={t("voice.cancel")}
          className="shrink-0 rounded-full p-2 text-muted transition hover:text-ember-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pulse-500"
        >
          <IoClose aria-hidden="true" size={20} />
        </button>
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-ember-500 opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ember-500" />
        </span>
        <span className="text-sm font-medium tabular-nums text-ink dark:text-ink-dark" role="timer" aria-live="off">
          {status === "requesting" ? t("voice.requesting") : formatDuration(elapsedMs)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {t("voice.maxHint", { max: Math.round(maxSeconds / 60) })}
        </span>
        <button
          type="button"
          onClick={voice.stop}
          disabled={status === "requesting"}
          aria-label={t("voice.stop")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ember-600 text-white transition hover:bg-ember-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-500 disabled:opacity-50"
        >
          <IoStop aria-hidden="true" size={16} />
        </button>
      </div>
    );
  }

  if (status === "recorded" && recording) {
    return (
      <div className="flex flex-1 items-center gap-2" role="group" aria-label={t("voice.preview")}>
        <button
          type="button"
          onClick={voice.clear}
          disabled={sending}
          aria-label={t("voice.discard")}
          className="shrink-0 rounded-full p-2 text-muted transition hover:text-ember-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pulse-500 disabled:opacity-40"
        >
          <IoClose aria-hidden="true" size={20} />
        </button>
        <div className="min-w-0 flex-1 rounded-full bg-canvas px-3 py-1.5 dark:bg-canvas-dark">
          <VoiceNotePlayer url={recording.url} durationMs={recording.durationMs} />
        </div>
        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          aria-label={t("voice.send")}
          className="shrink-0 rounded-full bg-pulse-600 p-2.5 text-white transition hover:bg-pulse-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse-500 disabled:opacity-50"
        >
          <IoSend aria-hidden="true" size={16} />
        </button>
      </div>
    );
  }

  return null;
}

/** Botón de micrófono del compositor. No se muestra si el navegador no puede grabar. */
export function VoiceRecordButton({ voice, disabled }) {
  const { t } = useLanguage();
  if (voice.unavailable === "unsupported") return null;
  return (
    <button
      type="button"
      onClick={voice.start}
      disabled={disabled}
      aria-label={t("voice.record")}
      title={voice.unavailable === "insecure" ? t("voice.errors.insecure") : t("voice.record")}
      className="shrink-0 rounded-full p-2 text-muted transition hover:text-pulse-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pulse-500 disabled:opacity-40"
    >
      <IoMic aria-hidden="true" size={20} />
    </button>
  );
}
