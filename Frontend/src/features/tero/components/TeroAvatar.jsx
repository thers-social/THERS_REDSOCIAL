import "../tero.css";

// Paleta propia de la mascota (cyan, aqua, azul y lavanda con rostro oscuro),
// autorizada por el propietario del proyecto el 2026-10-08. Es SOLO de Tero: el
// resto de la interfaz usa los tokens `th-` y sigue el tema claro/oscuro. Los mismos
// valores que mobile/src/features/tero/design/teroColors.ts.
const C = {
  cyan: "#22d3ee",
  aqua: "#2dd4bf",
  blue: "#3b82f6",
  lavender: "#c4b5fd",
  face: "#0b1220",
  eye: "#e0f2fe",
  cheek: "#f0abfc",
};

const LINE = { stroke: C.eye, strokeWidth: 3.5, strokeLinecap: "round", fill: "none" };

function Eyes({ mood }) {
  if (mood === "happy") {
    return (
      <>
        <path d="M36 56 Q 40 50, 44 56" {...LINE} />
        <path d="M56 56 Q 60 50, 64 56" {...LINE} />
      </>
    );
  }
  if (mood === "sleeping") {
    return (
      <>
        <path d="M36 56 Q 40 59, 44 56" {...LINE} />
        <path d="M56 56 Q 60 59, 64 56" {...LINE} />
      </>
    );
  }
  if (mood === "error") {
    return (
      <>
        <path d="M37 52 L43 58 M43 52 L37 58" {...LINE} strokeWidth={3} />
        <path d="M57 52 L63 58 M63 52 L57 58" {...LINE} strokeWidth={3} />
      </>
    );
  }
  // Ojos redondos: en «pensando» miran hacia arriba; en «curioso», más grandes.
  const cy = mood === "thinking" ? 51 : 55;
  const r = mood === "attention" ? 6 : 4.5;
  return (
    <>
      <circle cx={40} cy={cy} r={r} fill={C.eye} />
      <circle cx={60} cy={cy} r={r} fill={C.eye} />
    </>
  );
}

function Mouth({ mood }) {
  if (mood === "speaking") return <ellipse className="tero-mouth" cx={50} cy={68} rx={5} ry={4} fill={C.lavender} />;
  if (mood === "error") return <path d="M44 70 Q 50 65, 56 70" {...LINE} strokeWidth={3} />;
  if (mood === "thinking" || mood === "sleeping") return <path d="M46 68 L54 68" {...LINE} strokeWidth={3} />;
  return <path d={mood === "happy" ? "M42 65 Q 50 74, 58 65" : "M44 66 Q 50 71, 56 66"} {...LINE} strokeWidth={3} />;
}

// Parpadean solo los ojos abiertos y redondos.
const BLINKS = new Set(["idle", "attention", "listening", "speaking"]);

/**
 * Avatar de Tero. ÚNICO punto de la web que sabe cómo se dibuja y se mueve la mascota.
 * El movimiento es CSS puro (transform/opacity): se detiene solo con «reducir
 * movimiento» del sistema (ver tero.css) y con `animated={false}`.
 *
 * Estados (`mood`): idle, attention, listening, thinking, speaking, happy, error, sleeping.
 */
export default function TeroAvatar({ size = 56, mood = "idle", animated = true, className = "" }) {
  const uid = "teroBody";
  return (
    <span
      className={`tero-avatar ${animated ? "tero-animated" : ""} tero-mood-${mood} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 100 100" focusable="false">
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={C.cyan} />
            <stop offset="0.55" stopColor={C.aqua} />
            <stop offset="1" stopColor={C.blue} />
          </linearGradient>
        </defs>
        <g className="tero-body">
          {/* Copete: el rasgo del tero. */}
          <path d="M50 22 C 56 6, 72 2, 82 8 C 70 10, 62 15, 58 24 Z" fill={C.lavender} />
          <circle cx={50} cy={56} r={38} fill={`url(#${uid})`} />
          <ellipse cx={50} cy={58} rx={27} ry={22} fill={C.face} />
          <Mouth mood={mood} />
          <circle cx={31} cy={66} r={3.5} fill={C.cheek} opacity={0.55} />
          <circle cx={69} cy={66} r={3.5} fill={C.cheek} opacity={0.55} />
          {mood === "listening" ? (
            <path d="M84 46 Q 90 56, 84 66" {...LINE} stroke={C.lavender} strokeWidth={3} />
          ) : null}
          {/* `key` por estado: al cambiar de cara se vuelve a montar y entra con un fundido. */}
          <g key={mood} className={`tero-eyes ${BLINKS.has(mood) ? "tero-blinks" : ""}`}>
            <Eyes mood={mood} />
          </g>
          {mood === "thinking" ? (
            <g className="tero-dots" fill={C.lavender}>
              <circle cx={14} cy={20} r={3} />
              <circle cx={24} cy={14} r={3} />
              <circle cx={34} cy={10} r={3} />
            </g>
          ) : null}
        </g>
      </svg>
    </span>
  );
}
