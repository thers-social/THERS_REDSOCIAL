import Icon from "@shared/components/Icon";

/**
 * Compositor del Feed — sección 3 de REF-FEED-01.
 *
 * Reproduce la tarjeta de la referencia: avatar, campo de texto y barra de
 * acciones con Foto, Cápsula, Audio, Lugar y Publicar, en ese orden.
 *
 * ESTADO REAL DE CADA ACCIÓN: «Publicar» y «Foto» están conectadas
 * (POST /api/posts, ADR-004; imágenes, ADR-039): ambas abren el compositor, que
 * es donde se eligen las fotos. Cápsula, Audio y Lugar están dibujadas en la
 * referencia pero no tienen endpoint: se muestran deshabilitadas con una
 * explicación accesible, en vez de simular que funcionan (archivo maestro §9.4
 * y §7.1: "disabled tiene explicación accesible cuando sea necesaria").
 */
export default function FeedComposer({ currentUser, onOpenComposer }) {
  const firstName = (currentUser?.name || "").split(" ")[0];

  const actions = [
    { id: "capsule", icon: "layers", label: "Cápsula" },
    { id: "audio", icon: "graphic_eq", label: "Audio" },
    { id: "place", icon: "near_me", label: "Lugar" },
  ];

  return (
    <section className="flex flex-col gap-4 rounded-th-card border border-th-border bg-th-surface p-4 shadow-th-card">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-th-pill bg-th-brand text-label-md font-bold text-th-on-brand">
          {initialsOf(currentUser)}
        </span>

        <button
          type="button"
          onClick={onOpenComposer}
          className="min-h-[44px] flex-1 rounded-th-input px-3 py-2.5 text-left text-body-md text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle"
        >
          ¿Qué quieres expresar, {firstName}?
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-th-border-subtle pt-3">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onOpenComposer}
            className="flex min-h-[44px] items-center gap-1.5 rounded-th-input px-2.5 py-2 text-label-lg text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle"
          >
            <Icon name="image" size={20} />
            <span className="hidden sm:inline">Foto</span>
            <span className="sr-only sm:hidden">Foto</span>
          </button>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled
              aria-describedby={`composer-${action.id}-hint`}
              className="flex min-h-[44px] items-center gap-1.5 rounded-th-input px-2.5 py-2 text-label-lg text-th-fg-subtle opacity-60"
            >
              <Icon name={action.icon} size={20} />
              <span className="hidden sm:inline">{action.label}</span>
              <span id={`composer-${action.id}-hint`} className="sr-only">
                {action.label}: todavía no disponible, falta soporte en el servidor
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onOpenComposer}
          className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-th-pill bg-th-brand px-5 py-2.5 text-label-lg font-bold text-th-on-brand shadow-th-card transition-colors th-focus-ring hover:bg-th-brand-hover active:scale-[0.98]"
        >
          <span>Publicar</span>
          <Icon name="send" size={18} />
        </button>
      </div>
    </section>
  );
}

function initialsOf(user) {
  const source = user?.name || user?.username || "";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
