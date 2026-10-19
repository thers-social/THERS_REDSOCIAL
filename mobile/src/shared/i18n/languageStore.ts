// Dónde se guarda el idioma elegido: en el teléfono (AsyncStorage, no SecureStore: no es un secreto) y
// NO por cuenta, porque la pantalla de acceso, que no tiene cuenta, también se traduce. Mismo patrón
// que las preferencias de Tero: import diferido y respaldo en memoria, para que un dev-client viejo
// sin el módulo nativo siga funcionando (sin recordar el idioma) en vez de romper la app.

import { isLanguage } from './translate';
import type { Language } from './translate';

const KEY = 'thers.language';

type KeyValue = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const memory = new Map<string, string>();
const memoryStorage: KeyValue = {
  getItem: async (key) => memory.get(key) ?? null,
  setItem: async (key, value) => {
    memory.set(key, value);
  },
};

let storagePromise: Promise<KeyValue> | null = null;

function storage(): Promise<KeyValue> {
  storagePromise ??= import('@react-native-async-storage/async-storage')
    .then((module) => module.default as KeyValue)
    .catch(() => memoryStorage);
  return storagePromise;
}

/** El idioma guardado, o `null` si nunca se eligió (o si el valor guardado no es válido). */
export async function loadLanguage(): Promise<Language | null> {
  try {
    const raw = await (await storage()).getItem(KEY);
    return isLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function saveLanguage(language: Language): Promise<void> {
  try {
    await (await storage()).setItem(KEY, language);
  } catch {
    // Sin almacenamiento el idioma sigue aplicado hasta cerrar la app; no se rompe nada.
  }
}
