import { StyleSheet } from 'react-native';

import { fonts, getColorScheme } from './tokens';
import type { ColorScheme } from './tokens';

/**
 * Valor que depende del tema activo y se calcula una vez por tema, la primera
 * vez que se lee (durante el render). Es el reemplazo de las constantes de
 * módulo que usaban `colors` y quedaban fijas al cargar.
 */
export function themed<T extends object>(make: () => T): T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  const resolve = (): T => (cache[getColorScheme()] ??= make());
  return new Proxy({} as T, {
    get: (_target, key) => (resolve() as Record<string | symbol, unknown>)[key],
    has: (_target, key) => key in resolve(),
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor: (_target, key) => ({
      enumerable: true,
      configurable: true,
      value: (resolve() as Record<string | symbol, unknown>)[key],
    }),
  });
}

type Style = Record<string, unknown>;

/** Asigna la familia tipográfica según el peso y quita `fontWeight` (ver `fonts`). */
function withFont(style: Style): Style {
  if (style.fontFamily || (!('fontSize' in style) && !('fontWeight' in style))) return style;
  const weight = String(style.fontWeight ?? '400');
  const family = ['700', '800', '900', 'bold'].includes(weight)
    ? fonts.bold
    : ['500', '600'].includes(weight)
      ? fonts.medium
      : fonts.regular;
  const { fontWeight: _weight, ...rest } = style;
  return { ...rest, fontFamily: family };
}

/** `StyleSheet.create` que se recalcula al cambiar de tema y aplica la tipografía única. */
export function themedStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  make: () => T,
): T {
  return themed(() => {
    const raw = make() as unknown as Record<string, Style>;
    const withFonts = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, withFont(v)]));
    return StyleSheet.create(withFonts) as unknown as T;
  });
}
