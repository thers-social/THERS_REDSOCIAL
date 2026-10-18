import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "@shared/components/Icon";
import Avatar from "@shared/components/Avatar";
import MoodBadge from "./MoodBadge";
import { websiteHref } from "../lib/profileStorage";

/**
 * Identidad del perfil — sección 2 de REF-PROFILE-01.
 *
 * Composición de la referencia: avatar montado sobre la portada (`-mt-16`),
 * nombre y handle, y a la derecha «Editar perfil» (primario), «Compartir
 * perfil» (secundario) y «...» (más opciones). Debajo, biografía, metadatos
 * (ubicación, enlace) y la fila de métricas.
 *
 * PROCEDENCIA DE CADA DATO — el archivo maestro §8.3 exige que todo lo de la
 * cuenta propia salga de la sesión real:
 *
 *  · Nombre, usuario           REALES (GET/PATCH /api/users/me, ADR-002/003)
 *  · Seguidores, Siguiendo     REALES (GET /api/users/me, ADR-007)
 *  · Publicaciones             REAL   (contadas sobre GET /api/posts, ADR-004)
 *  · Bio, ubicación, enlace    REALES (`users`, ADR-015-profile-media.md);
 *                              llegan ya fusionadas en `profile` por Profile.jsx
 *  · Foto de perfil            REAL   (`avatar_url`, ADR-015)
 *
 * NO se reproducen de la maqueta:
 *  · «Miembro desde Noviembre 2024» — `to_public_user` no expone `created_at`
 *    (API_CONTRACT.md §5). No se inventa una fecha de alta.
 *  · La métrica «18 Cápsulas» como valor distinto de «Publicaciones»: en este
 *    dominio una Cápsula ES un post (ADR-004), así que mostrar ambas sería
 *    contar lo mismo dos veces.
 *  · Distintivo de verificación — no existe como funcionalidad (§8.4).
 */
export default function ProfileIdentity({
  user,
  profile,
  stats,
  onEdit,
  onShare,
  onOpenConnections,
  onToggleSuggestions,
  suggestionsOpen = false,
  editButtonRef,
}) {
  const href = websiteHref(profile.website);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef(null);
  const moreTriggerRef = useRef(null);

  // Mismo patrón de cierre que el menú de perfil del Topbar (clic afuera +
  // Escape, devolviendo el foco al disparador) -- un menú real, no un alias
  // del botón de compartir.
  useEffect(() => {
    if (!moreOpen) return undefined;

    function onPointerDown(event) {
      if (moreMenuRef.current?.contains(event.target)) return;
      if (moreTriggerRef.current?.contains(event.target)) return;
      setMoreOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreTriggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  return (
    <div className="relative z-10 -mt-16 px-2 sm:px-6">
      {/* La identidad y las acciones se ponen en fila solo a partir de `xl`.
          Entre 1024 y 1279 el ancho útil de esta columna no alcanza para
          nombre + tres botones, y el nombre acababa partiéndose en dos líneas
          y montándose sobre la portada. Apilarlas evita ese defecto sin
          alterar la composición de escritorio de la referencia. */}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 flex-col items-start gap-5 sm:flex-row sm:items-end">
          {/* `rounded-th-pill`: el anillo debe seguir la silueta circular del
              avatar; un radio de caja dejaba un marco rectangular visible. */}
          <div className="shrink-0 rounded-th-pill ring-4 ring-th-bg">
            <Avatar name={user.name} photo={user.avatar_url} color={profile.accent} size="w-28 h-28 text-3xl" />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5 pb-1">
            {/* `truncate`: un nombre largo nunca debe envolverse hacia arriba
                y taparse con la portada. */}
            <h1 className="truncate text-headline-md text-th-fg-strong sm:text-headline-lg">
              {user.name}
            </h1>
            <p className="truncate text-body-md text-th-fg-muted">@{user.username}</p>
            {profile.mood && <MoodBadge mood={profile.mood} />}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5 pt-2 xl:pt-0">
          <button
            ref={editButtonRef}
            type="button"
            onClick={onEdit}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-th-input bg-th-brand px-5 py-2.5 text-label-lg font-bold text-th-on-brand shadow-th-card transition-colors th-focus-ring hover:bg-th-brand-hover active:scale-[0.98]"
          >
            <Icon name="edit" size={18} />
            Editar perfil
          </button>

          <button
            type="button"
            onClick={onShare}
            aria-label="Compartir perfil"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-th-input border border-th-border bg-th-surface px-4 py-2.5 text-label-lg font-semibold text-th-fg transition-colors th-focus-ring hover:bg-th-surface-subtle"
          >
            <Icon name="ios_share" size={18} />
            <span className="hidden 2xl:inline">Compartir perfil</span>
          </button>

          <button
            type="button"
            onClick={onToggleSuggestions}
            aria-label="Descubrir personas"
            aria-expanded={suggestionsOpen}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-th-input border bg-th-surface text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle ${
              suggestionsOpen ? "border-th-brand text-th-brand-fg" : "border-th-border"
            }`}
          >
            <Icon name="person_add" size={20} />
          </button>

          <div className="relative shrink-0">
            <button
              ref={moreTriggerRef}
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label="Más opciones del perfil"
              className="flex h-11 w-11 items-center justify-center rounded-th-input border border-th-border bg-th-surface text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle"
            >
              <Icon name="more_horiz" size={20} />
            </button>

            {moreOpen && (
              <div
                ref={moreMenuRef}
                role="menu"
                className="absolute right-0 top-12 z-th-overlay w-56 overflow-hidden rounded-th-card border border-th-border bg-th-surface py-2 shadow-th-overlay"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onShare();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-body-md text-th-fg transition-colors th-focus-ring hover:bg-th-surface-subtle"
                >
                  <Icon name="link" size={18} />
                  Copiar enlace del perfil
                </button>
                <Link
                  to="/settings"
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-body-md text-th-fg transition-colors th-focus-ring hover:bg-th-surface-subtle"
                >
                  <Icon name="settings" size={18} />
                  Ir a Configuración
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 flex max-w-3xl flex-col gap-3">
        {profile.bio ? (
          <p className="text-body-lg text-th-fg">{profile.bio}</p>
        ) : (
          <p className="text-body-md italic text-th-fg-subtle">
            Todavía no escribiste una biografía. Se edita desde «Editar perfil».
          </p>
        )}

        {(profile.location || href) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm text-th-fg-muted">
            {profile.location && (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="location_on" size={16} />
                {profile.location}
              </span>
            )}
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1.5 text-th-brand-fg th-focus-ring hover:underline"
              >
                <Icon name="link" size={16} />
                <span className="[overflow-wrap:anywhere]">{profile.website}</span>
              </a>
            )}
          </div>
        )}

        <dl className="mt-1 flex flex-wrap items-center gap-x-8 gap-y-3">
          <Stat value={stats.posts} label="Publicaciones" />
          <Stat value={stats.followers} label="Seguidores" onClick={() => onOpenConnections?.("followers")} />
          <Stat value={stats.following} label="Siguiendo" onClick={() => onOpenConnections?.("following")} />
        </dl>
      </div>
    </div>
  );
}

function Stat({ value, label, onClick }) {
  const body = (
    <>
      <span className="text-headline-sm font-bold tabular-nums text-th-fg-strong">
        {value.toLocaleString("es")}
      </span>
      <span className="text-body-sm text-th-fg-muted">{label}</span>
    </>
  );
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd>
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            aria-label={`Ver ${label.toLowerCase()}, ${value}`}
            className="flex items-baseline gap-1.5 rounded-th-sm th-focus-ring hover:underline"
          >
            {body}
          </button>
        ) : (
          <span className="flex items-baseline gap-1.5">{body}</span>
        )}
      </dd>
    </div>
  );
}
