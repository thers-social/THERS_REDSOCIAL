import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { colors, fontSize } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { fetchPlacePulse } from './api';
import { pulseLabel } from './pulse';

/**
 * Pulse del lugar (ADR-040 §32): una etiqueta de actividad reciente, sin cifras ni quién. Si el
 * servidor no da nivel (poca actividad) o falla, no pinta nada: es un extra de la ficha.
 */
export function PlacePulse({ placeId }: { placeId: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLabel(null);
    fetchPlacePulse(placeId, controller.signal)
      .then((pulse) => setLabel(pulseLabel(pulse.level)))
      .catch(() => {});
    return () => controller.abort();
  }, [placeId]);

  if (!label) return null;
  return (
    <Text style={styles.pulse} accessibilityLabel={`Actividad reciente: ${label}. Últimos 7 días.`}>
      Actividad reciente: {label}
    </Text>
  );
}

const styles = themedStyles(() => ({
  pulse: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
}));
