import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { colors } from '@shared/design/tokens';
import { setTimeLanguage } from '@shared/lib/time';

import { loadLanguage, saveLanguage } from './languageStore';
import { en } from './locales/en';
import { es } from './locales/es';
import type { MessageKey } from './locales/es';
import { detectLanguage, translateFrom } from './translate';
import type { Language, MessageParams } from './translate';

export { LANGUAGES } from './translate';
export type { Language, MessageKey };

const DICTIONARIES: Record<Language, Record<string, string>> = { es, en };

type Translate = (key: MessageKey, params?: MessageParams) => string;
type LanguageState = { language: Language; setLanguage: (next: Language) => void; t: Translate };

const LanguageContext = createContext<LanguageState | null>(null);

// El idioma actual, para el código que no es un componente (p. ej. un `Alert` suelto). Lo fija el
// proveedor al renderizar.
let currentLanguage: Language = 'es';

/** Traduce con el idioma actual desde fuera de un componente. Dentro de uno, usa `useLanguage().t`. */
export function translateNow(key: MessageKey, params?: MessageParams): string {
  return translateFrom(DICTIONARIES, currentLanguage, key, params);
}

function deviceLanguage(): Language {
  try {
    return detectLanguage(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'es';
  }
}

/**
 * Idioma de la app (español o inglés). Se monta una vez en `app/_layout.tsx`, por encima de todo.
 * Mientras se lee el idioma guardado (milisegundos) solo se pinta el fondo, para que no se vea un
 * parpadeo del idioma equivocado. Sin elección guardada se usa el del teléfono.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLanguage().then((stored) => {
      if (!cancelled) setLanguageState(stored ?? deviceLanguage());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    void saveLanguage(next);
  }, []);

  // Se fija durante el render (y no en un efecto) para que las fechas de los primeros hijos ya salgan
  // en el idioma correcto; es idempotente.
  if (language) {
    setTimeLanguage(language);
    currentLanguage = language;
  }

  const value = useMemo<LanguageState | null>(
    () =>
      language
        ? { language, setLanguage, t: (key, params) => translateFrom(DICTIONARIES, language, key, params) }
        : null,
    [language, setLanguage],
  );

  if (!value) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageState {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage debe usarse dentro de <LanguageProvider>');
  return context;
}
