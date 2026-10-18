import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "@shared/components/Icon";
import LanguageSwitcher from "@shared/components/LanguageSwitcher";
import { useLanguage } from "@shared/i18n";

/**
 * Topbar global — 64px de alto en las 24 referencias.
 *
 * Composición de REF-FEED-01: buscador a la izquierda (max-w-md), acciones
 * rápidas y avatar de sesión a la derecha. Se desplaza con `--th-sidebar-w`,
 * la misma variable que usa la sidebar, para que nunca haya un offset
 * discrepante (archivo maestro §6.1).
 *
 * El buscador es un formulario real que navega a /search?q=..., no un input
 * decorativo: el archivo maestro §6.3 prohíbe dejar navegación sin destino.
 */
export default function Topbar({
  currentUser,
  hasUnreadNotifications = false,
  onOpenMobileNav,
  onLogout,
  theme,
  onToggleTheme,
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  // Cierre del menú: clic fuera y Escape, devolviendo el foco al disparador
  // (archivo maestro §7.3).
  useEffect(() => {
    if (!menuOpen) return undefined;

    function onPointerDown(event) {
      if (menuRef.current?.contains(event.target)) return;
      if (triggerRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function handleSearch(event) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <header className="fixed inset-x-0 top-0 z-th-sticky flex h-th-topbar items-center justify-between gap-4 border-b border-th-border bg-th-surface-translucent px-4 shadow-th-card backdrop-blur-xl lg:left-th-sidebar lg:px-th-gutter">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label={t("nav.openMenu")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-th-pill text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-raised hover:text-th-fg-strong lg:hidden"
        >
          <Icon name="menu" size={24} />
        </button>

        <form role="search" onSubmit={handleSearch} className="w-full max-w-md">
          <label htmlFor="th-global-search" className="sr-only">
            {t("nav.searchAria")}
          </label>
          <div className="relative flex items-center">
            <Icon
              name="search"
              size={20}
              className="pointer-events-none absolute left-4 text-th-fg-subtle"
            />
            <input
              id="th-global-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("nav.searchPlaceholder")}
              className="w-full rounded-th-pill border border-transparent bg-th-surface-raised py-2 pl-11 pr-4 text-body-sm text-th-fg placeholder:text-th-fg-muted transition-all th-focus-ring focus:border-th-brand focus:bg-th-surface"
            />
          </div>
        </form>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Link
          to="/places"
          aria-label={t("nav.places")}
          className="hidden h-10 w-10 items-center justify-center rounded-th-pill text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-raised hover:text-th-fg-strong sm:flex"
        >
          <Icon name="bolt" size={20} />
        </Link>

        <Link
          to="/notifications"
          aria-label={t("nav.notifications")}
          className="relative flex h-10 w-10 items-center justify-center rounded-th-pill text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-raised hover:text-th-fg-strong"
        >
          <Icon name="notifications" size={20} />
          {/* Mismo criterio que el punto de Sidebar (item.badge === "dot"):
              solo se dibuja con un valor real, nunca como adorno fijo. */}
          {hasUnreadNotifications && (
            <span
              className="absolute right-2 top-2 h-2 w-2 rounded-th-pill bg-th-danger-accent"
              role="status"
              aria-label={t("nav.hasUnread")}
            />
          )}
        </Link>

        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("nav.profileMenuAria")}
            className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-th-pill bg-th-brand text-label-md font-bold text-th-on-brand th-focus-ring"
          >
            {currentUser?.avatar_url ? (
              <img src={currentUser.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initialsOf(currentUser)
            )}
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              className="absolute right-0 top-12 w-60 overflow-hidden rounded-th-card border border-th-border bg-th-surface py-2 shadow-th-overlay"
            >
              <div className="border-b border-th-border-subtle px-4 pb-2">
                <p className="truncate text-label-lg font-semibold text-th-fg-strong">
                  {currentUser?.name}
                </p>
                <p className="truncate text-body-sm text-th-fg-muted">@{currentUser?.username}</p>
              </div>

              <MenuLink to="/profile" icon="person" onSelect={() => setMenuOpen(false)}>
                {t("nav.viewProfile")}
              </MenuLink>
              <MenuLink to="/settings" icon="settings" onSelect={() => setMenuOpen(false)}>
                {t("nav.settings")}
              </MenuLink>
              <MenuLink to="/help" icon="help" onSelect={() => setMenuOpen(false)}>
                {t("nav.help")}
              </MenuLink>

              <button
                type="button"
                role="menuitem"
                onClick={onToggleTheme}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-body-md text-th-fg transition-colors th-focus-ring hover:bg-th-surface-subtle"
              >
                <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} size={18} />
                {theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
              </button>

              <div className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="text-body-md text-th-fg">{t("language.label")}</span>
                <LanguageSwitcher />
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={onLogout}
                className="mt-1 flex w-full items-center gap-3 border-t border-th-border-subtle px-4 pb-1 pt-3 text-left text-body-md text-th-danger-accent transition-colors th-focus-ring hover:bg-th-danger-surface"
              >
                <Icon name="logout" size={18} />
                {t("nav.logout")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuLink({ to, icon, children, onSelect }) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-3 px-4 py-2 text-body-md text-th-fg transition-colors th-focus-ring hover:bg-th-surface-subtle"
    >
      <Icon name={icon} size={18} />
      {children}
    </Link>
  );
}

function initialsOf(user) {
  const source = user?.name || user?.username || "";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
