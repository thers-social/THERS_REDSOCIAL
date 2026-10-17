import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';

import { fetchManage } from '@features/places/api';
import { ManageAnalytics } from '@features/places/manage/ManageAnalytics';
import { ManageOverview } from '@features/places/manage/ManageOverview';
import { ManageQuotes } from '@features/places/manage/ManageQuotes';
import { ManageReservations } from '@features/places/manage/ManageReservations';
import { ManageReviews } from '@features/places/manage/ManageReviews';
import { ManageSchedule } from '@features/places/manage/ManageSchedule';
import { errorMessage } from '@features/places/manage/ui';
import type { ManageStats, PlaceDetail } from '@features/places/types';
import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

type State =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; place: PlaceDetail; stats: ManageStats };

/**
 * Panel de negocio de un lugar (ADR-040 fases 7 a 10). Quien no gestiona el lugar recibe el
 * mismo 404 que un lugar inexistente: se muestra «no disponible» sin revelar cuál de los dos es.
 */
export default function ManagePlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      try {
        const data = await fetchManage(id, signal);
        setState({ status: 'ready', place: data.place, stats: data.stats });
      } catch (e) {
        if (signal?.aborted) return;
        if (e instanceof ApiError && e.status === 404) setState({ status: 'not_found' });
        else setState({ status: 'error', message: errorMessage(e, 'No pudimos cargar el panel.') });
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <Screen title="Mi negocio" back>
        <StateMessage kind="loading" message="Cargando el panel…" />
      </Screen>
    );
  }
  if (state.status === 'not_found') {
    return (
      <Screen title="Mi negocio" back>
        <StateMessage
          kind="empty"
          title="Panel no disponible"
          message="No gestionás este lugar o ya no está disponible."
        />
      </Screen>
    );
  }
  if (state.status === 'error') {
    return (
      <Screen title="Mi negocio" back>
        <StateMessage
          kind="error"
          title="No pudimos cargar el panel"
          message={state.message}
          actionLabel="Reintentar"
          onAction={() => void load()}
        />
      </Screen>
    );
  }

  const { place, stats } = state;
  return (
    <Screen title="Mi negocio" back>
      <Text style={styles.name} accessibilityRole="header">
        {place.name}
      </Text>
      <Text style={styles.category}>{place.category.name}</Text>

      <ManageOverview
        key={place.address ?? 'x'}
        place={place}
        stats={stats}
        onSaved={(updated) => setState({ status: 'ready', place: updated, stats })}
      />
      <ManageAnalytics placeId={place.id} />
      <ManageReviews placeId={place.id} onChanged={() => void load()} />
      <ManageReservations placeId={place.id} onChanged={() => void load()} />
      <ManageSchedule placeId={place.id} />
      <ManageQuotes placeId={place.id} />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  name: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg },
  category: { fontSize: fontSize.bodyMd, color: colors.fgMuted, marginBottom: space[2] },
}));
