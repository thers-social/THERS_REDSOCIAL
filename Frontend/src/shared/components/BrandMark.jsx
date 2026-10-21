import logo from "@/assets/logo_oficial.jpeg";

// Lockup ícono + wordmark reutilizado por Footer y PublicLayout (las partes
// públicas nuevas). Usa el logo oficial, que ya es un círculo negro: el antiguo
// `logo_TH.png` es blanco sobre transparente y sobre fondo claro (pie de página,
// cabecera pública) solo dejaba ver un trazo morado suelto.
export default function BrandMark({ size = "text-xl", iconSize = "w-8 h-8" }) {
  return (
    <span className={`inline-flex items-center gap-2 ${size}`}>
      <img src={logo} alt="" className={`${iconSize} rounded-full object-cover shrink-0`} />
      <span className="font-extrabold tracking-tight text-ink dark:text-ink-dark">THERS</span>
    </span>
  );
}
