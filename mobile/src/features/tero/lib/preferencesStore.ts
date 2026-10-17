/**
 * Dónde se guardan las preferencias de Tero.
 *
 * - AsyncStorage y NO SecureStore: no son secretos, y SecureStore es para tokens
 *   (`@shared/lib/session.ts`). Por lo mismo, acá NUNCA van tokens, contraseñas
 *   ni datos de otras personas: AsyncStorage no está cifrado.
 * - Detrás de una interfaz (`TeroPreferencesStore`): una sincronización futura
 *   con el servidor es otra implementación, sin tocar las pantallas.
 * - Import diferido y con respaldo en memoria: AsyncStorage es un módulo nativo
 *   y lanza al importarse si la build instalada en el teléfono es anterior a su
 *   instalación. Así un dev-client viejo sigue funcionando (sin recordar las
 *   preferencias) en vez de romper toda la app.
 */

import { parsePreferences, preferencesKey } from './preferences';
import type { TeroPreferences } from '../types';

export interface TeroPreferencesStore {
  load(userId: string): Promise<TeroPreferences>;
  save(userId: string, preferences: TeroPreferences): Promise<void>;
  clear(userId: string): Promise<void>;
}

type KeyValue = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const memory = new Map<string, string>();

const memoryStorage: KeyValue = {
  getItem: async (key) => memory.get(key) ?? null,
  setItem: async (key, value) => {
    memory.set(key, value);
  },
  removeItem: async (key) => {
    memory.delete(key);
  },
};

let storagePromise: Promise<KeyValue> | null = null;

function storage(): Promise<KeyValue> {
  storagePromise ??= import('@react-native-async-storage/async-storage')
    .then((module) => module.default as KeyValue)
    .catch(() => {
      console.warn(
        '[tero] AsyncStorage no está en esta build nativa; las preferencias de Tero no se ' +
          'recordarán al cerrar la app. Recompilar el dev-client (npm run android).',
      );
      return memoryStorage;
    });
  return storagePromise;
}

export const localPreferencesStore: TeroPreferencesStore = {
  async load(userId) {
    try {
      const raw = await (await storage()).getItem(preferencesKey(userId));
      return parsePreferences(raw);
    } catch {
      return parsePreferences(null);
    }
  },
  async save(userId, preferences) {
    try {
      await (await storage()).setItem(preferencesKey(userId), JSON.stringify(preferences));
    } catch {
      // Una preferencia que no se guarda no justifica un error en pantalla: el
      // estado en memoria sigue valiendo durante la sesión.
    }
  },
  async clear(userId) {
    try {
      await (await storage()).removeItem(preferencesKey(userId));
    } catch {
      // Ídem.
    }
  },
};
