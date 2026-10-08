/**
 * Tokens de diseño de THERS, portados para React Native.
 *
 * Origen: `Frontend/src/shared/design/tokens.css` (211 custom properties),
 * documentado en `docs/THERS_DESIGN_SYSTEM.md`. React Native no entiende
 * `var(--th-*)` ni CSS, así que los valores viven aquí como constantes --
 * ADR-016 §2.2 registra esta portabilidad como una de las razones de elegir
 * React Native.
 *
 * REGLAS (ADR-016, CLAUDE.md §5 "Frontend del producto"):
 * - Este archivo es un PORTE, no un Design System nuevo. No se inventan
 *   valores: cada uno existe en `tokens.css`. Si falta uno, se copia de ahí,
 *   no se improvisa.
 * - `Frontend/` sigue siendo la fuente. Si un token cambia allá, se refleja
 *   acá a mano -- son dos aplicaciones independientes, sin código compartido
 *   (CLAUDE.md §2), así que esta duplicación es deliberada y acotada.
 * - No se agrega NativeWind ni otra biblioteca visual: el encargo
 *   (THERS_PROMPT_CLAUDE_ANDROID.md §5) lo prohíbe explícitamente.
 * - El Frontend del producto NO tiene un Design System ratificado por el
 *   Comité Técnico (`DS-001` §1.2 es exclusivo del Handbook). Estos tokens
 *   están autorizados por el propietario del proyecto, no por `HB-001`
 *   §11-12. No extrapolarlos ni ampliarlos sin que el equipo lo ratifique.
 *
 * (Nota de la fase 1 de la integración visual: la paleta de `colors` pasó a
 * oscura según `THERS_CLAUDE_MASTER` §4; la escala tipográfica, el espaciado y
 * los radios siguen siendo el porte de `tokens.css`.)
 *
 * Solo se portó el subconjunto que las pantallas de esta primera entrega
 * (login, perfil) usan de verdad. Portar los 211 de una vez sería adelantar
 * trabajo sin consumidor.
 */

/**
 * Primitivos -- identidad "Obsidian Violet Matrix" (`THERS_CLAUDE_MASTER` §4).
 *
 * A partir de la fase 1 de la integración visual móvil la app es oscura. Los
 * valores nuevos ya no vienen de `tokens.css` (que es claro): vienen de la
 * especificación maestra, autorizada por el propietario del proyecto. Los
 * nombres semánticos de `colors` no cambian, para que las pantallas existentes
 * se recoloreen sin reescribirse.
 */
const primitives = {
  void: '#000000',
  obsidian900: '#0c0e14',
  obsidian850: '#111319',
  obsidian800: '#191b22',
  obsidian750: '#1d1f26',
  obsidian700: '#282a30',
  obsidian600: '#33353b',
  violet900: '#1b1530',
  violet800: '#2e2150',
  violet600: '#6d28d9',
  violet500: '#7c3aed',
  violet400: '#a78bfa',
  violet300: '#ddd6fe',
  gray100: '#e2e2ea',
  gray300: '#cbc3d7',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  white: '#ffffff',
} as const;

/** Semánticos, tema oscuro -- el nivel que las pantallas deben consumir. */
const darkPalette = {
  bg: primitives.obsidian900,
  bgSubtle: primitives.obsidian850,
  surface: primitives.obsidian800,
  surfaceRaised: primitives.obsidian750,
  /** Superficies inmersivas (Reels, visores): negro OLED. */
  immersive: primitives.void,

  border: primitives.obsidian700,
  borderSubtle: primitives.obsidian750,
  borderStrong: primitives.obsidian600,

  /** Relleno de acciones primarias; el texto blanco sobre él cumple contraste AA. */
  brand: primitives.violet500,
  brandHover: primitives.violet600,
  /** Violeta legible como TEXTO sobre fondos oscuros (el relleno `brand` no lo es). */
  brandText: primitives.violet400,
  brandSoft: primitives.violet900,
  brandSoftStrong: primitives.violet800,
  onBrand: primitives.white,
  /** Texto secundario sobre un relleno `brand` (p. ej. la hora de una burbuja propia). */
  onBrandMuted: primitives.violet300,

  fg: primitives.gray100,
  fgSecondary: primitives.gray300,
  fgMuted: primitives.gray400,
  fgDisabled: primitives.gray500,

  dangerAccent: '#dc2626',
  dangerPressed: '#b91c1c',
  dangerFg: '#fca5a5',
  dangerSurface: '#2a1215',
  dangerBorder: '#7f1d1d',

  successAccent: '#10b981',
  successFg: '#6ee7b7',
  successSurface: '#0d2a21',

  /** Telón de modales y hojas inferiores. */
  scrim: 'rgba(0, 0, 0, 0.65)',
} as const;

export type Palette = { [K in keyof typeof darkPalette]: string };

/**
 * Tema claro. Valores del modo claro aprobado en los diseños (Mensajes claro:
 * fondo #f8fafc, superficies blancas, violeta #7c3aed) y los del porte original
 * de `tokens.css`.
 */
const lightPalette: Palette = {
  bg: '#f8fafc',
  bgSubtle: '#f1f5f9',
  surface: '#ffffff',
  surfaceRaised: '#f6f3ff',
  immersive: '#000000',

  border: '#e2e8f0',
  borderSubtle: '#f1f5f9',
  borderStrong: '#cbd5e1',

  brand: '#7c3aed',
  brandHover: '#6d28d9',
  brandText: '#6d28d9',
  brandSoft: '#faf5ff',
  brandSoftStrong: '#f3e8ff',
  onBrand: '#ffffff',
  onBrandMuted: '#ede9fe',

  fg: '#0f172a',
  fgSecondary: '#475569',
  fgMuted: '#64748b',
  fgDisabled: '#94a3b8',

  dangerAccent: '#dc2626',
  dangerPressed: '#b91c1c',
  dangerFg: '#991b1b',
  dangerSurface: '#fef2f2',
  dangerBorder: '#fca5a5',

  successAccent: '#10b981',
  successFg: '#047857',
  successSurface: '#ecfdf5',

  scrim: 'rgba(15, 23, 42, 0.45)',
};

export type ColorScheme = 'light' | 'dark';

const palettes: Record<ColorScheme, Palette> = { dark: darkPalette, light: lightPalette };
let activeScheme: ColorScheme = 'dark';

/** Lo llama `app/_layout.tsx` con el tema del sistema, antes de pintar nada. */
export function setColorScheme(scheme: ColorScheme) {
  activeScheme = scheme;
}

export function getColorScheme(): ColorScheme {
  return activeScheme;
}

/**
 * Colores del tema activo. Se lee en el momento de usarlo (render), no al cargar
 * el módulo, así que las pantallas siguen escribiendo `colors.fg` y no cambian.
 * Para estilos de módulo usar `themedStyles` (`./theme.ts`), no `StyleSheet.create`.
 */
export const colors: Palette = new Proxy({} as Palette, {
  get: (_target, key: string) => palettes[activeScheme][key as keyof Palette],
});

/**
 * Tipografía: UNA sola familia en toda la app, Space Grotesk. Se cargan tres
 * pesos en `app/_layout.tsx`; `themedStyles` asigna el peso según el
 * `fontWeight` de cada estilo (en Android una familia propia no mezcla bien con
 * `fontWeight`), así que las pantallas siguen escribiendo `fontWeight: '700'`.
 */
export const fonts = {
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  bold: 'SpaceGrotesk_700Bold',
  /** Alias de los títulos ya existentes. */
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
} as const;

/** Escala tipográfica -- `--th-text-*`. */
export const fontSize = {
  headlineXl: 40,
  headlineLg: 32,
  headlineMd: 24,
  headlineSm: 20,
  bodyLg: 17,
  bodyMd: 15,
  bodySm: 13,
  labelLg: 14,
  labelMd: 12,
  labelSm: 11,
} as const;

/** Espaciado -- `--th-space-*`. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  10: 40,
} as const;

/** Radios -- `--th-radius-*`. */
export const radius = {
  xs: 4,
  sm: 8,
  input: 12,
  card: 16,
  dialog: 24,
  pill: 9999,
} as const;
