// Núcleo del sistema de idiomas: funciones puras, sin React ni alias de rutas, para poder probarlas
// con `node --test` (`tests/i18n.test.mjs`). Los diccionarios viven en `locales/` y el proveedor de
// React en `index.tsx`.

export type Language = 'es' | 'en';

/** Idiomas que ofrece la app. El nombre de cada uno se escribe en su propio idioma. */
export const LANGUAGES: readonly { id: Language; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
];

export const DEFAULT_LANGUAGE: Language = 'es';

export type MessageParams = Record<string, string | number>;

export function isLanguage(value: unknown): value is Language {
  return value === 'es' || value === 'en';
}

/** Idioma inicial según el del teléfono (`es-SV`, `en-US`…). Lo que no sea inglés se queda en español. */
export function detectLanguage(locale: string | null | undefined): Language {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LANGUAGE;
}

/** Sustituye `{nombre}` por su valor. Un `{x}` sin valor se deja tal cual para que se note. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Busca `key` en el idioma pedido; si falta, en el español (idioma de origen) y, si tampoco está, la
 * propia clave: una traducción olvidada se ve como `settings.title` en pantalla y no rompe nada.
 */
export function translateFrom(
  dictionaries: Record<Language, Record<string, string>>,
  language: Language,
  key: string,
  params?: MessageParams,
): string {
  const template = dictionaries[language]?.[key] ?? dictionaries[DEFAULT_LANGUAGE]?.[key] ?? key;
  return interpolate(template, params);
}
