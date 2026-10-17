/**
 * Configuración del mapa de THERS Places en la app (ADR-040 §4.6).
 *
 * El proveedor de tiles NO está fijo en el código: se define con
 * `EXPO_PUBLIC_MAP_STYLE_URL` (URL de un estilo MapLibre). Cambiar de proveedor es
 * cambiar esa variable.
 *
 * `EXPO_PUBLIC_*` queda EMBEBIDA en el bundle y la puede leer cualquiera que tenga el APK.
 * Una clave de mapas es pública por naturaleza, pero DEBE estar restringida en el panel
 * del proveedor (nunca pongas aquí un secreto). OJO: la app nativa NO envía la cabecera
 * `Origin`, así que la clave de la web (restringida por dominio) no sirve aquí: el móvil
 * necesita su PROPIA clave (ver `mobile/.env.example`).
 *
 * Sin la variable se usa el estilo de demostración de MapLibre y se advierte: no tiene
 * calles y no sirve para publicar.
 */

const DEV_FALLBACK_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

export const IS_DEV_MAP_STYLE = !process.env.EXPO_PUBLIC_MAP_STYLE_URL;

if (IS_DEV_MAP_STYLE) {
  console.warn(
    '[places] EXPO_PUBLIC_MAP_STYLE_URL no está definida; usando el estilo de demostración de ' +
      'MapLibre (' +
      DEV_FALLBACK_STYLE_URL +
      '). Solo sirve para desarrollo: definila en mobile/.env con tu proveedor (ADR-040 D1).',
  );
}

export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? DEV_FALLBACK_STYLE_URL;

/** Centro inicial sin ubicación: San Salvador. Referencia de producto, no la ubicación de nadie. */
export const DEFAULT_CENTER = { lat: 13.6929, lng: -89.2182 } as const;
export const DEFAULT_ZOOM = 12;
export const DEFAULT_RADIUS_METERS = 5000;
