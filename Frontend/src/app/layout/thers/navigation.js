/**
 * Modelo único de navegación global de THERS.
 *
 * Sidebar (escritorio), BottomNav (móvil) y el menú de perfil leen de aquí.
 * Una sola lista evita que los destinos se dupliquen y se desincronicen entre
 * los tres componentes (THERS_IMPLEMENTACION_MAESTRA_CLAUDE.md §6.3).
 *
 * Orden, etiquetas e iconos son los de la sidebar de REF-FEED-01, idénticos en
 * las 24 referencias (docs/THERS_REFERENCE_MANIFEST.md §5).
 *
 * `badge` describe qué tipo de indicador dibuja la referencia. Su VALOR lo
 * aporta el contenedor desde datos reales -- nunca el "4" ni el "LIVE" de la
 * maqueta, que son muestra ilustrativa (manifest §6).
 */

/** Destinos primarios, en el orden exacto de la referencia. */
export const PRIMARY_NAV = [
  { id: "home", to: "/feed", icon: "home", labelKey: "nav.home" },
  { id: "search", to: "/search", icon: "search", labelKey: "nav.search" },
  { id: "videos", to: "/videos", icon: "play_circle", labelKey: "nav.videos", badge: "live" },
  // "Cápsulas" se retiró de la barra (pedido del propietario). La ruta `/capsules` sigue existiendo
  // para no romper enlaces guardados.
  // THERS Places (ADR-040, fase 3): catálogo de lugares con mapa. Sustituyó al antiguo destino
  // "Ubicación" (`/radar`, un marcador de posición sin servicio), que se retiró.
  { id: "places", to: "/places", icon: "location_on", labelKey: "nav.places" },
  { id: "messages", to: "/messages", icon: "forum", labelKey: "nav.messages", badge: "count" },
  {
    id: "notifications",
    to: "/notifications",
    icon: "notifications",
    labelKey: "nav.notifications",
    badge: "dot",
  },
];

/**
 * Destinos de la bottom-nav en móvil.
 *
 * ADAPTACIÓN NUEVA, no reproducción: las 24 capturas son de escritorio y
 * ninguna muestra navegación móvil (manifest §4.3). Se limita a cinco
 * destinos primarios; el resto vive en Perfil y en el menú de usuario, según
 * el archivo maestro §6.2.
 */
export const MOBILE_NAV_IDS = ["home", "search", "__create__", "messages", "notifications"];

/**
 * Secciones de Configuración que funcionan. Se retiraron Suscripción, Herramientas (radar),
 * Notificaciones, Audio y Permisos porque no tenían nada configurable detrás (pedido del
 * propietario); sus referencias REF-SET-04..07 y 11 quedan sin pantalla a propósito.
 * `ref` apunta al ID del manifiesto que sirve de referencia canónica.
 */
export const SETTINGS_SECTIONS = [
  { id: "profile", icon: "person", labelKey: "settings.nav.profile", ref: "REF-SET-01" },
  { id: "privacy", icon: "lock", labelKey: "settings.nav.privacy", ref: "REF-SET-02" },
  { id: "security", icon: "shield", labelKey: "settings.nav.security", ref: "REF-SET-03" },
  { id: "links", icon: "link", labelKey: "settings.nav.links", ref: "REF-SET-08" },
  { id: "data", icon: "download", labelKey: "settings.nav.data", ref: "REF-SET-09" },
  { id: "blocked", icon: "block", labelKey: "settings.nav.blocked", ref: "REF-SET-10" },
  { id: "content", icon: "feed", labelKey: "settings.nav.content", ref: "REF-SET-12" },
];

/**
 * Variante de shell por ruta. Las referencias se reparten en dos familias
 * visuales y cada una tiene su ancho de sidebar y su paleta (manifest §2/§5).
 * Devuelve el valor de `data-th-shell` que resuelve los tokens.
 */
export function shellVariantFor(pathname) {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/messages")) return "messages";
  return "social";
}
