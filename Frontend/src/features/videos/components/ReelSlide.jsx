import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@shared/components/Avatar";
import Icon from "@shared/components/Icon";
import { followLabel } from "@features/feed/lib/socialApi";
import ReelComments from "./ReelComments";
import ReelPlayer from "./ReelPlayer";
import { canPlay, formatClock, formatCount, progressFraction, seekTarget } from "../lib/reelsLogic";

const SEEK_STEP_SECONDS = 5;
const SCRUB_RESOLUTION = 1000;
const DOUBLE_TAP_MS = 280;

function RailButton({ icon, label, count, active = false, activeClass = "", onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active || undefined}
      className="group flex flex-col items-center gap-1 text-white lg:text-th-fg"
    >
      <span
        className={`grid h-12 w-12 place-items-center rounded-full bg-black/40 backdrop-blur transition-transform group-active:scale-90 lg:bg-th-surface-subtle ${
          active ? activeClass : ""
        }`}
      >
        <Icon name={icon} size={28} fill={active ? 1 : 0} />
      </span>
      {count !== undefined && <span className="text-label-md font-semibold drop-shadow lg:drop-shadow-none">{count}</span>}
    </button>
  );
}

/**
 * Un Reel a pantalla completa (ADR-055): video, acciones, barra de progreso y comentarios.
 *
 * `active`: es el Reel que ocupa la pantalla (el único que suena y avanza). `near`: está al lado, así
 * que su reproductor ya está montado y preparado, pero en pausa. Los demás son un marco vacío: nunca
 * hay más de tres reproductores a la vez.
 */
export default function ReelSlide({
  video,
  active,
  near,
  muted,
  currentUserId,
  onMutedChange,
  onLike,
  onSave,
  onShare,
  onFollow,
  onCommentsCountChange,
  onExpired,
}) {
  const videoRef = useRef(null);
  const rangeRef = useRef(null);
  const clockRef = useRef(null);
  const scrubbing = useRef(false);
  const tapTimer = useRef(null);
  const lastTap = useRef(0);
  const flashTimer = useRef(null);
  const [userPaused, setUserPaused] = useState(false);
  const [flash, setFlash] = useState(null); // "play" | "pause" | "heart"
  const [commentsOpen, setCommentsOpen] = useState(false);
  // El reproductor carga el HLS de forma asíncrona: cuando el video está listo se reanuda solo si
  // sigue siendo el activo y la persona no lo pausó.
  const activeRef = useRef(active);
  const userPausedRef = useRef(false);
  activeRef.current = active;
  userPausedRef.current = userPaused;

  const mine = String(video.author.id) === String(currentUserId);
  const playable = canPlay(video);

  const showFlash = useCallback((kind) => {
    setFlash(kind);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 650);
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
      setUserPaused(false);
      showFlash("play");
    } else {
      el.pause();
      setUserPaused(true);
      showFlash("pause");
    }
  }, [showFlash]);

  const seekBy = useCallback((delta) => {
    const el = videoRef.current;
    if (el) el.currentTime = seekTarget(el.currentTime, delta, el.duration);
  }, []);

  // Reproduce solo el Reel activo; al salir de pantalla se pausa y vuelve al inicio, como en TikTok.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    if (active) {
      el.play().catch(() => {
        // El navegador bloquea el sonido sin gesto previo: se reintenta en silencio.
        if (!el.muted) {
          el.muted = true;
          onMutedChange(true);
          el.play().catch(() => {});
        }
      });
    } else {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {
        /* sin metadatos todavía */
      }
      setUserPaused(false);
      setCommentsOpen(false);
    }
    // `onMutedChange` es estable en la página; `muted` se aplica aparte para no reiniciar el video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, near, playable]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const resume = () => {
      if (activeRef.current && !userPausedRef.current && el.paused) el.play().catch(() => {});
    };
    el.addEventListener("canplay", resume);
    return () => el.removeEventListener("canplay", resume);
  }, [near, playable]);

  // Barra de progreso: se escribe directo en el DOM cada fotograma (sin re-renderizar el Reel).
  useEffect(() => {
    if (!active) return undefined;
    let frame;
    const tick = () => {
      const el = videoRef.current;
      if (el && !scrubbing.current) {
        const duration = el.duration || (video.duration_ms || 0) / 1000;
        if (rangeRef.current) rangeRef.current.value = String(Math.round(progressFraction(el.currentTime, duration) * SCRUB_RESOLUTION));
        if (clockRef.current) clockRef.current.textContent = `${formatClock(el.currentTime)} / ${formatClock(duration)}`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, video.duration_ms]);

  // Atajos del Reel activo (las flechas arriba/abajo las maneja la página).
  useEffect(() => {
    if (!active || commentsOpen) return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const tag = event.target?.tagName;
      // Con el foco en un campo o botón, esa tecla es suya (escribir, activar, mover el control).
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || event.target?.isContentEditable) return;
      if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-SEEK_STEP_SECONDS);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(SEEK_STEP_SECONDS);
      } else if (event.key.toLowerCase() === "m") {
        onMutedChange(!muted);
      } else if (event.key.toLowerCase() === "l") {
        onLike(video);
        showFlash("heart");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, commentsOpen, muted, video, togglePlay, seekBy, onMutedChange, onLike, showFlash]);

  useEffect(
    () => () => {
      clearTimeout(tapTimer.current);
      clearTimeout(flashTimer.current);
    },
    [],
  );

  // Un toque pausa o reanuda; dos toques seguidos dan «me gusta» (nunca lo quitan).
  function handleTap() {
    if (commentsOpen) {
      setCommentsOpen(false);
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (!video.liked_by_me) onLike(video);
      showFlash("heart");
    } else {
      lastTap.current = now;
      tapTimer.current = setTimeout(togglePlay, DOUBLE_TAP_MS);
    }
  }

  function handleScrub(event) {
    const el = videoRef.current;
    if (!el) return;
    const duration = el.duration || (video.duration_ms || 0) / 1000;
    const fraction = Number(event.target.value) / SCRUB_RESOLUTION;
    el.currentTime = fraction * duration;
    if (clockRef.current) clockRef.current.textContent = `${formatClock(el.currentTime)} / ${formatClock(duration)}`;
  }

  const followText = followLabel(video.author.follow_pending ? "pending" : "none", false);
  const showFollow = !mine && !video.author.is_following;

  return (
    <section aria-label={`Reel de @${video.author.username}`} className="flex h-full w-full items-center justify-center">
      <div className="relative flex h-full w-full items-end justify-center gap-3 lg:w-auto">
        <div className="relative h-full w-full overflow-hidden bg-black lg:aspect-[9/16] lg:w-auto lg:rounded-th-card">
          {near && playable ? (
            <ReelPlayer
              hlsUrl={video.playback.hls_url}
              caption={video.caption}
              width={video.width}
              height={video.height}
              videoRef={videoRef}
              muted={muted}
              onExpired={() => onExpired(video.id)}
            />
          ) : (
            !playable && <p className="grid h-full place-items-center text-body-sm text-white/70">No disponible.</p>
          )}

          <button
            type="button"
            onClick={handleTap}
            aria-label={userPaused ? "Reanudar Reel" : "Pausar Reel"}
            className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none"
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

          {flash && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
              <span className="grid h-20 w-20 place-items-center rounded-full bg-black/45 text-white">
                <Icon name={flash === "heart" ? "favorite" : flash === "play" ? "play_arrow" : "pause"} size={44} fill={1} />
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => onMutedChange(!muted)}
            aria-label={muted ? "Activar sonido" : "Silenciar"}
            className="absolute right-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur"
          >
            <Icon name={muted ? "volume_off" : "volume_up"} size={22} />
          </button>

          <div className="pointer-events-none absolute bottom-14 left-4 right-20 z-20 flex flex-col gap-2 text-white lg:right-4">
            <div className="pointer-events-auto flex items-center gap-2">
              <Link to={`/user/${video.author.id}`} className="flex min-w-0 items-center gap-2">
                <Avatar name={video.author.name || video.author.username} photo={video.author.avatar_url} size="w-9 h-9" />
                <span className="truncate text-label-lg font-bold drop-shadow">@{video.author.username}</span>
              </Link>
              {showFollow && (
                <button
                  type="button"
                  onClick={() => onFollow(video.author)}
                  disabled={video.author.follow_pending}
                  className="shrink-0 rounded-th-pill border border-white/80 px-3 py-1 text-label-md font-bold disabled:opacity-70"
                >
                  {followText}
                </button>
              )}
            </div>
            {video.caption && <p className="line-clamp-3 break-words text-body-md drop-shadow">{video.caption}</p>}
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 px-3 pb-2 text-white">
            <input
              ref={rangeRef}
              type="range"
              min={0}
              max={SCRUB_RESOLUTION}
              step={1}
              defaultValue={0}
              onInput={handleScrub}
              onPointerDown={() => {
                scrubbing.current = true;
              }}
              onPointerUp={() => {
                scrubbing.current = false;
              }}
              onBlur={() => {
                scrubbing.current = false;
              }}
              aria-label="Posición del video"
              className="h-5 min-w-0 flex-1 cursor-pointer accent-white"
            />
            <span ref={clockRef} className="w-20 shrink-0 text-right text-label-md tabular-nums drop-shadow">
              0:00 / {formatClock((video.duration_ms || 0) / 1000)}
            </span>
          </div>

          {commentsOpen && (
            <ReelComments
              videoId={video.id}
              count={video.comments_count}
              onClose={() => setCommentsOpen(false)}
              onCountChange={(delta) => onCommentsCountChange(video.id, delta)}
            />
          )}
        </div>

        <div className="absolute bottom-16 right-3 z-20 flex flex-col items-center gap-4 lg:static lg:pb-4">
          <RailButton
            icon="favorite"
            label={video.liked_by_me ? "Quitar me gusta" : "Me gusta"}
            count={formatCount(video.likes_count)}
            active={video.liked_by_me}
            activeClass="!text-[#ff3b5c]"
            onClick={() => onLike(video)}
          />
          <RailButton
            icon="chat_bubble"
            label="Comentarios"
            count={formatCount(video.comments_count)}
            active={commentsOpen}
            onClick={() => setCommentsOpen((open) => !open)}
          />
          <RailButton
            icon="bookmark"
            label={video.saved_by_me ? "Quitar de guardados" : "Guardar"}
            active={video.saved_by_me}
            onClick={() => onSave(video)}
          />
          <RailButton icon="share" label="Compartir" onClick={() => onShare(video)} />
        </div>
      </div>
    </section>
  );
}
