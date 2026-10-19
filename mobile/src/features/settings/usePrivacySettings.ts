import { useCallback, useEffect, useState } from 'react';

import { useLanguage } from '@shared/i18n';
import { ApiError } from '@shared/lib/api';

import { fetchPrivacy, patchPrivacy } from './api';
import type { PrivacyPatch, PrivacySettings } from './api';

/**
 * Lee y guarda la privacidad en el SERVIDOR (`GET`/`PATCH /api/users/me/privacy`, `ADR-022`/`023`/`024`).
 * Cada cambio se muestra al instante y, si el servidor lo rechaza, el control vuelve a su valor real.
 * Lo comparten Privacidad y Menciones.
 */
export function usePrivacySettings() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await fetchPrivacy());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('privacy.error.load'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(
    async (patch: PrivacyPatch) => {
      if (!settings || saving) return;
      setSaving(true);
      setError(null);
      const previous = settings;
      setSettings({ ...settings, ...patch });
      try {
        setSettings(await patchPrivacy(patch));
      } catch (e) {
        setSettings(previous);
        setError(e instanceof ApiError ? e.message : t('privacy.error.save'));
      } finally {
        setSaving(false);
      }
    },
    [settings, saving, t],
  );

  return { settings, error, saving, load, update };
}
