/**
 * Preferencias de los avisos locales de este dispositivo.
 *
 * AsyncStorage y no SecureStore: no son secretos (mismo criterio que las preferencias de Tero).
 * Import diferido y respaldo en memoria: AsyncStorage es nativo y lanza al importarse en una
 * build anterior a su instalación; así una build vieja sigue funcionando en vez de romper la app.
 */

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

const ENABLED_KEY = 'thers.alerts.enabled';
const ASKED_KEY = 'thers.alerts.asked';

/** Los avisos locales están activos salvo que la persona los haya apagado. */
export async function loadAlertsEnabled(): Promise<boolean> {
  try {
    return (await (await storage()).getItem(ENABLED_KEY)) !== 'false';
  } catch {
    return true;
  }
}

export async function saveAlertsEnabled(enabled: boolean): Promise<void> {
  try {
    await (await storage()).setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // Una preferencia que no se guarda no justifica un error en pantalla.
  }
}

/** ¿Ya se le explicó a la persona (una vez) por qué pedimos el permiso de notificaciones? */
export async function wasAskedForNotifications(): Promise<boolean> {
  try {
    return (await (await storage()).getItem(ASKED_KEY)) === 'true';
  } catch {
    return true;
  }
}

export async function markAskedForNotifications(): Promise<void> {
  try {
    await (await storage()).setItem(ASKED_KEY, 'true');
  } catch {
    // Igual que arriba.
  }
}
