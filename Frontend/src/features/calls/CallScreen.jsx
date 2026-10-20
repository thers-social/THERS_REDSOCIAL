import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  IoCall,
  IoMic,
  IoMicOff,
  IoVideocam,
  IoVideocamOff,
} from "react-icons/io5";
import Avatar from "@shared/components/Avatar";
import { startRingtone } from "./ringtone";

// Pantalla de llamada: entrante (contestar o rechazar), saliente (llamando...) y en curso (sala de
// LiveKit con micrófono, cámara y colgar). Se dibuja encima de toda la app, así que la persona puede
// navegar sin perder la llamada.

function otherPerson(call) {
  return call.direction === "outgoing" ? call.callee : call.caller;
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function RoundButton({ label, onClick, tone = "neutral", pressed = false, children }) {
  const tones = {
    neutral: pressed ? "bg-white text-neutral-900" : "bg-white/15 text-white hover:bg-white/25",
    danger: "bg-red-600 text-white hover:bg-red-500",
    accept: "bg-green-600 text-white hover:bg-green-500",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={tone === "neutral" ? pressed : undefined}
      className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function Backdrop({ children }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-neutral-950/95 px-6 text-white"
    >
      {children}
    </div>
  );
}

function Identity({ person, subtitle }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar name={person.name} photo={person.avatar_url} size="w-28 h-28" />
      <p className="text-xl font-semibold">{person.name}</p>
      <p className="text-sm text-white/70" aria-live="polite">
        {subtitle}
      </p>
    </div>
  );
}

function Incoming({ call, onAccept, onHangUp }) {
  useEffect(() => startRingtone(), []);
  const person = otherPerson(call);
  return (
    <Backdrop>
      <Identity
        person={person}
        subtitle={call.kind === "video" ? "Videollamada entrante" : "Llamada entrante"}
      />
      <div className="mt-10 flex items-center gap-10">
        <div className="flex flex-col items-center gap-2 text-xs text-white/70">
          <RoundButton label="Rechazar llamada" tone="danger" onClick={onHangUp}>
            <IoCall size={24} className="rotate-[135deg]" />
          </RoundButton>
          Rechazar
        </div>
        <div className="flex flex-col items-center gap-2 text-xs text-white/70">
          <RoundButton label="Contestar llamada" tone="accept" onClick={onAccept}>
            {call.kind === "video" ? <IoVideocam size={24} /> : <IoCall size={24} />}
          </RoundButton>
          Contestar
        </div>
      </div>
    </Backdrop>
  );
}

function Outgoing({ call, onHangUp }) {
  return (
    <Backdrop>
      <Identity
        person={otherPerson(call)}
        subtitle={call.kind === "video" ? "Videollamando..." : "Llamando..."}
      />
      <div className="mt-10 flex flex-col items-center gap-2 text-xs text-white/70">
        <RoundButton label="Cancelar llamada" tone="danger" onClick={onHangUp}>
          <IoCall size={24} className="rotate-[135deg]" />
        </RoundButton>
        Cancelar
      </div>
    </Backdrop>
  );
}

function Active({ call, access, onHangUp }) {
  const isVideo = call.kind === "video";
  const person = otherPerson(call);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const audioHostRef = useRef(null);
  const roomRef = useRef(null);
  const hangUpRef = useRef(onHangUp);
  hangUpRef.current = onHangUp;

  const [connected, setConnected] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(isVideo);
  const [problem, setProblem] = useState(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let cancelled = false;

    room.on(RoomEvent.TrackSubscribed, (track) => {
      const element = track.attach();
      if (track.kind === Track.Kind.Video) {
        element.className = "h-full w-full object-cover";
        remoteVideoRef.current?.replaceChildren(element);
        setHasRemoteVideo(true);
      } else {
        audioHostRef.current?.appendChild(element);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());
      if (track.kind === Track.Kind.Video) setHasRemoteVideo(false);
    });
    // Mi propia cámara se ve en una ventana pequeña (sin sonido: solo el track de video).
    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.kind === Track.Kind.Video && publication.track && localVideoRef.current) {
        publication.track.attach(localVideoRef.current);
      }
    });
    // Si la otra persona se va de la sala, la llamada terminó.
    room.on(RoomEvent.ParticipantDisconnected, () => hangUpRef.current());

    (async () => {
      try {
        await room.connect(access.url, access.token);
        if (cancelled) return;
        setConnected(true);
        room.startAudio().catch(() => {});
      } catch {
        if (!cancelled) setProblem("No pudimos conectar la llamada. Revisa tu conexión.");
        return;
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (isVideo) await room.localParticipant.setCameraEnabled(true);
      } catch {
        if (!cancelled) {
          setMicOn(false);
          setCamOn(false);
          setProblem(
            "No pudimos usar el micrófono o la cámara. Permite el acceso en el navegador para que te escuchen."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      room.disconnect();
      roomRef.current = null;
    };
  }, [access, isVideo]);

  useEffect(() => {
    if (!connected) return undefined;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  async function toggleMic() {
    const next = !micOn;
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch {
      setProblem("No pudimos usar el micrófono. Permite el acceso en el navegador.");
    }
  }

  async function toggleCam() {
    const next = !camOn;
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(next);
      setCamOn(next);
    } catch {
      setProblem("No pudimos usar la cámara. Permite el acceso en el navegador.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Llamada con ${person.name}`}
      className="fixed inset-0 z-[100] flex flex-col bg-neutral-950 text-white"
    >
      <div ref={audioHostRef} className="hidden" />

      <div className="relative flex-1 overflow-hidden">
        <div ref={remoteVideoRef} className="absolute inset-0" />
        {!(isVideo && hasRemoteVideo) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Identity
              person={person}
              subtitle={connected ? formatClock(seconds) : "Conectando..."}
            />
          </div>
        )}
        {isVideo && hasRemoteVideo && (
          <p className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-sm">
            {person.name} · {formatClock(seconds)}
          </p>
        )}
        {isVideo && (
          <video
            ref={localVideoRef}
            muted
            playsInline
            autoPlay
            aria-label="Tu cámara"
            className={`absolute bottom-4 right-4 h-36 w-28 rounded-xl border border-white/20 bg-neutral-800 object-cover shadow-lg [transform:scaleX(-1)] ${
              camOn ? "" : "invisible"
            }`}
          />
        )}
        {problem && (
          <p
            role="alert"
            className="absolute inset-x-4 top-4 mx-auto max-w-md rounded-lg bg-red-600/90 px-4 py-2 text-center text-sm"
          >
            {problem}
          </p>
        )}
      </div>

      <div className="flex items-center justify-center gap-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        <RoundButton
          label={micOn ? "Silenciar micrófono" : "Activar micrófono"}
          pressed={!micOn}
          onClick={toggleMic}
        >
          {micOn ? <IoMic size={24} /> : <IoMicOff size={24} />}
        </RoundButton>
        {isVideo && (
          <RoundButton
            label={camOn ? "Apagar cámara" : "Encender cámara"}
            pressed={!camOn}
            onClick={toggleCam}
          >
            {camOn ? <IoVideocam size={24} /> : <IoVideocamOff size={24} />}
          </RoundButton>
        )}
        <RoundButton label="Colgar" tone="danger" onClick={onHangUp}>
          <IoCall size={24} className="rotate-[135deg]" />
        </RoundButton>
      </div>
    </div>
  );
}

export default function CallScreen({ session, onAccept, onHangUp }) {
  const { call, access, phase } = session;
  if (phase === "incoming") return <Incoming call={call} onAccept={onAccept} onHangUp={onHangUp} />;
  if (phase === "outgoing") return <Outgoing call={call} onHangUp={onHangUp} />;
  return <Active call={call} access={access} onHangUp={onHangUp} />;
}
