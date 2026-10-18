import { useCallback, useEffect, useRef, useState } from "react";
import { IoPause, IoPlay } from "react-icons/io5";
import { useLanguage } from "@shared/i18n";
import { formatDuration } from "@shared/lib/voice";

// Solo suena una nota a la vez: al darle a reproducir en otra, la anterior se pausa.
let playingAudio = null;

/**
 * Reproductor de una nota de voz (ADR-042): botón de reproducir/pausar, barra para
 * moverse y duración. `durationMs` es la que calculó el servidor (o la de la grabación
 * propia): el archivo en streaming no siempre trae una duración fiable, así que no se
 * depende de la que reporta `<audio>`.
 *
 * `mine` solo cambia los colores para que se lea sobre la burbuja de quien la mandó.
 */
export default function VoiceNotePlayer({ url, durationMs, mine = false, className = "" }) {
  const { t } = useLanguage();
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [failed, setFailed] = useState(false);

  const total = Math.max(1, durationMs || 1);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) audio.pause();
      if (playingAudio === audio) playingAudio = null;
    };
  }, []);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (playingAudio && playingAudio !== audio) playingAudio.pause();
    try {
      await audio.play();
      playingAudio = audio;
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  const onSeek = (event) => {
    const audio = audioRef.current;
    const next = Number(event.target.value);
    setPositionMs(next);
    if (audio) audio.currentTime = next / 1000;
  };

  const track = mine ? "accent-white" : "accent-pulse-600";
  const button = mine
    ? "bg-white/20 text-white hover:bg-white/30"
    : "bg-pulse-600 text-white hover:bg-pulse-700";
  const label = mine ? "text-white/80" : "text-muted";

  return (
    <div className={`flex min-w-[12rem] items-center gap-2 ${className}`}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPositionMs(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        onTimeUpdate={(event) => setPositionMs(Math.min(total, event.currentTarget.currentTime * 1000))}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("voice.pause") : t("voice.play")}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse-500 ${button}`}
      >
        {playing ? <IoPause aria-hidden="true" size={16} /> : <IoPlay aria-hidden="true" size={16} />}
      </button>
      <input
        type="range"
        min={0}
        max={total}
        step={100}
        value={positionMs}
        onChange={onSeek}
        aria-label={t("voice.seek")}
        aria-valuetext={`${formatDuration(positionMs)} / ${formatDuration(total)}`}
        className={`h-1 min-w-0 flex-1 cursor-pointer ${track}`}
      />
      <span className={`shrink-0 text-[11px] tabular-nums ${label}`} aria-hidden="true">
        {failed ? t("voice.errors.playback") : formatDuration(playing || positionMs > 0 ? positionMs : total)}
      </span>
    </div>
  );
}
