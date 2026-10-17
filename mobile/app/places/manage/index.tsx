import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fetchManagedPlaces } from '@features/places/api';
import { errorMessage } from '@features/places/manage/ui';
import type { ManagedPlace } from '@features/places/types';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/** Lugares que la persona gestiona (ADR-040 fase 6 los crea al aprobar un reclamo). */
export default function ManagedPlacesScreen() {
  const router = useRouter();
  const [places, setPlaces] = useState<ManagedPlace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setPlaces(await fetchManagedPlaces(signal));
      setError(null);
    } catch (e) {
      if (signal?.aborted) return;
      setError(errorMessage(e, 'No pudimos cargar tus lugares.'));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (error) {
    return (
      <Screen title="Mis negocios" back>
        <StateMessage
          kind="error"
          title="No pudimos cargar tus lugares"
          message={error}
          actionLabel="Reintentar"
          onAction={() => void load()}
        />
      </Screen>
    );
  }
  if (places === null) {
    return (
      <Screen title="Mis negocios" back>
        <StateMessage kind="loading" message="Cargando…" />
      </Screen>
    );
  }
  if (places.length === 0) {
    return (
      <Screen title="Mis negocios" back>
        <StateMessage
          kind="empty"
          title="Todavía no gestionás ningún lugar"
          message="Cuando la moderación apruebe un reclamo tuyo, el lugar aparecerá aquí."
        />
      </Screen>
    );
  }

  return (
    <Screen title="Mis negocios" back>
      <View style={styles.list}>
        {places.map((place) => (
          <Pressable
            key={place.id}
            style={styles.card}
            onPress={() => router.push({ pathname: '/places/manage/[id]', params: { id: place.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Administrar ${place.name}`}
          >
            <Text style={styles.name}>{place.name}</Text>
            <Text style={styles.meta}>
              {place.category.name}
              {place.municipality ? ` · ${place.municipality}` : ''}
            </Text>
            <Text style={styles.meta}>
              {place.reviews_count} reseñas
              {place.rating_average !== null ? ` · ${place.rating_average.toFixed(1)} ★` : ''}
              {place.is_public ? '' : ' · No visible'}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  list: { gap: space[3] },
  card: {
    gap: 2,
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  name: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  meta: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
}));
