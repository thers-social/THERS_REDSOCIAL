// Configuración del mapa de THERS Places (ADR-040-thers-places.md §4.6).
//
// El proveedor de tiles NO está fijo en el código: se define con VITE_MAP_STYLE_URL (una URL
// de estilo MapLibre/Mapbox GL). Cambiar de proveedor es cambiar esa variable.
//
// Mismo patrón que `shared/lib/api.js`: sin la variable usa un valor de DESARROLLO y lo
// advierte por consola.
//
// OJO: el estilo de demostración de MapLibre NO sirve para producción (es un mapa mundial
// de baja resolución, sin calles). Producción necesita un proveedor con clave y términos que
// permitan este uso; la decisión (D1 del ADR-040) sigue pendiente. Si el proveedor exige una
// clave, va dentro de la URL del estilo: queda en el bundle, así que debe ser una clave
// RESTRINGIDA por dominio, nunca un secreto.

const DEV_FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

export const IS_DEV_MAP_STYLE = !import.meta.env.VITE_MAP_STYLE_URL;

if (IS_DEV_MAP_STYLE) {
  console.warn(
    "[places] VITE_MAP_STYLE_URL no está definida; usando el estilo de demostración de MapLibre " +
      DEV_FALLBACK_STYLE_URL +
      ". Solo sirve para desarrollo: definir VITE_MAP_STYLE_URL con un proveedor real (ADR-040 D1)."
  );
}

export const MAP_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL || DEV_FALLBACK_STYLE_URL;

// Centro inicial cuando no hay ubicación del usuario: San Salvador. Es una referencia
// de producto (la app opera en El Salvador), no una ubicación de la persona.
export const DEFAULT_CENTER = { lat: 13.6929, lng: -89.2182 };
export const DEFAULT_ZOOM = 12;
