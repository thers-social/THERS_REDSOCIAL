import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '@features/auth/context/AuthContext';

import { TERO_ENABLED } from '../config';
import { defaultPreferences, updatePreferences } from '../lib/preferences';
import { localPreferencesStore } from '../lib/preferencesStore';
import type { TeroPreferencesStore } from '../lib/preferencesStore';
import type { TeroPreferences } from '../types';

type PreferencesPatch = Partial<Omit<TeroPreferences, 'version' | 'updatedAt' | 'language'>>;

type TeroState = {
  /** `EXPO_PUBLIC_TERO_ENABLED`. Si es `false`, Tero no se muestra en ningún lado. */
  enabled: boolean;
  preferences: TeroPreferences;
  /** `true` cuando ya se leyeron las preferencias de la cuenta actual. */
  ready: boolean;
  update: (patch: PreferencesPatch) => void;
  reset: () => Promise<void>;
};

const TeroStateContext = createContext<TeroState | null>(null);

/**
 * Estado de Tero para toda la app: se monta una vez en `app/_layout.tsx`, debajo
 * de `AuthProvider`, porque lo leen tanto la burbuja de las pestañas como las
 * pantallas `app/tero/*` del Stack raíz.
 *
 * Las preferencias son por cuenta: al cambiar de usuario se recargan, y al
 * cerrar sesión vuelven a los valores por defecto en memoria (lo guardado en el
 * teléfono se conserva para la próxima vez que esa cuenta entre).
 */
export function TeroProvider({
  children,
  store = localPreferencesStore,
}: {
  children: ReactNode;
  store?: TeroPreferencesStore;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [preferences, setPreferences] = useState<TeroPreferences>(() => defaultPreferences());
  const [readyFor, setReadyFor] = useState<string | null>(null);

  useEffect(() => {
    if (!TERO_ENABLED || !userId) {
      setPreferences(defaultPreferences());
      setReadyFor(null);
      return;
    }
    let cancelled = false;
    store.load(userId).then((loaded) => {
      if (cancelled) return;
      setPreferences(loaded);
      setReadyFor(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, store]);

  const update = useCallback(
    (patch: PreferencesPatch) => {
      setPreferences((current) => {
        const next = updatePreferences(current, patch);
        if (userId) void store.save(userId, next);
        return next;
      });
    },
    [userId, store],
  );

  const reset = useCallback(async () => {
    if (userId) await store.clear(userId);
    setPreferences(defaultPreferences());
  }, [userId, store]);

  const value = useMemo<TeroState>(
    () => ({
      enabled: TERO_ENABLED,
      preferences,
      ready: userId !== null && readyFor === userId,
      update,
      reset,
    }),
    [preferences, readyFor, userId, update, reset],
  );

  return <TeroStateContext.Provider value={value}>{children}</TeroStateContext.Provider>;
}

export function useTero(): TeroState {
  const value = useContext(TeroStateContext);
  if (!value) throw new Error('useTero debe usarse dentro de <TeroProvider>');
  return value;
}
