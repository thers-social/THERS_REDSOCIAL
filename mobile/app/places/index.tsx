import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { fetchCategories } from '@features/places/api';
import { CategoryChips } from '@features/places/CategoryChips';
import { DEFAULT_CENTER, DEFAULT_RADIUS_METERS, IS_DEV_MAP_STYLE } from '@features/places/mapConfig';
import { PlaceCard } from '@features/places/PlaceCard';
import { PlacesMap } from '@features/places/PlacesMap';
import type { LatLng, PlaceCategory } from '@features/places/types';
import { useGeolocation } from '@features/places/useGeolocation';
import { usePlaces } from '@features/places/usePlaces';
import { LOCATION_NOTICE_TEXT, locationNotice } from '@features/places/viewState';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * THERS Places en la app (ADR-040, fase 3): mapa arriba, lista debajo.
 *
 * La ubicación de la persona es OPCIONAL y solo se pide con el botón de la mira
 * (ADR-040 §6). Sin ella, todo funciona buscando, moviendo el mapa o filtrando.
 * Requiere una build nativa: MapLibre no funciona en Expo Go.
 */
export default function Places() {
  const router = useRouter();

  const [categories, setCategories] = useState<PlaceCategory[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<LatLng>({ ...DEFAULT_CENTER });
  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS_METERS);
  const [pending, setPending] = useState<{ center: LatLng; radius: number } | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: string } | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  const geo = useGeolocation();
  const results = usePlaces({ origin, radius, category, query });

  // Categorías: el filtro es opcional, si fallan la pantalla sigue funcionando.
  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Al compartir la ubicación, la consulta y el mapa se centran en ella.
  useEffect(() => {
    if (!geo.point) return;
    setOrigin(geo.point);
    setRadius(DEFAULT_RADIUS_METERS);
    setPending(null);
    setFocus({ ...geo.point, key: `geo-${geo.point.lat}-${geo.point.lng}` });
  }, [geo.point]);

  const open = (id: string) => router.push({ pathname: '/places/[id]', params: { id } });
  const notice = locationNotice(geo.status);

  return (
    <Screen title="Lugares" back scroll={false} withBottomInset={false}>
      <View style={styles.controls}>
        <View style={styles.searchRow}>
          <View style={styles.inputBox}>
            <Icon name="search" size={18} color={colors.fgMuted} />
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar un lugar por nombre…"
              placeholderTextColor={colors.fgDisabled}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              maxLength={80}
              accessibilityLabel="Buscar lugares"
              clearButtonMode="while-editing"
            />
          </View>
          <Pressable
            onPress={() => void geo.request()}
            disabled={geo.status === 'requesting'}
            style={styles.locate}
            accessibilityRole="button"
            accessibilityLabel="Usar mi ubicación"
          >
            <Icon name="locate" size={20} color={geo.status === 'granted' ? colors.brandText : colors.fg} />
          </Pressable>
        </View>
        <CategoryChips categories={categories} value={category} onChange={setCategory} />
        {notice ? <Banner tone="info">{LOCATION_NOTICE_TEXT[notice]}</Banner> : null}
      </View>

      <View style={styles.mapBox}>
        {mapFailed ? (
          <View style={styles.mapFailed}>
            <Text style={styles.mapFailedTitle}>No pudimos mostrar el mapa</Text>
            <Text style={styles.mapFailedBody}>
              La lista de lugares sigue funcionando. Revisá tu conexión e intentá de nuevo más tarde.
            </Text>
          </View>
        ) : (
          <PlacesMap
            places={results.places}
            center={DEFAULT_CENTER}
            focus={focus}
            userPoint={geo.point}
            onSelect={open}
            onViewportChange={setPending}
            onFailed={() => setMapFailed(true)}
          />
        )}
        {pending && !results.isSearch && !mapFailed ? (
          <Pressable
            style={styles.searchHere}
            onPress={() => {
              setOrigin(pending.center);
              setRadius(pending.radius);
              setPending(null);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.searchHereText}>Buscar en esta zona</Text>
          </Pressable>
        ) : null}
        {IS_DEV_MAP_STYLE && !mapFailed ? (
          <Text style={styles.devBadge}>Mapa de demostración (solo desarrollo)</Text>
        ) : null}
      </View>

      <View style={styles.listBox}>
        {results.viewState === 'success' ? (
          <FlatList
            data={results.places}
            keyExtractor={(place) => place.id}
            renderItem={({ item }) => <PlaceCard place={item} onPress={open} />}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        ) : results.viewState === 'loading' ? (
          <StateMessage kind="loading" message="Buscando lugares…" />
        ) : results.viewState === 'offline' ? (
          <StateMessage
            kind="error"
            title="Sin conexión"
            message="Revisá tu conexión a internet e intentá de nuevo."
            actionLabel="Reintentar"
            onAction={results.reload}
          />
        ) : results.viewState === 'error' ? (
          <StateMessage
            kind="error"
            title="No pudimos cargar los lugares"
            message={results.error ?? undefined}
            actionLabel="Reintentar"
            onAction={results.reload}
          />
        ) : results.isSearch ? (
          <StateMessage
            kind="empty"
            title="Sin resultados"
            message="No encontramos lugares con ese nombre. Revisá la escritura o probá otra palabra."
          />
        ) : (
          <StateMessage
            kind="empty"
            title="No hay lugares en esta zona"
            message="Probá con otra categoría, ampliá la zona o mové el mapa."
          />
        )}
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  controls: { gap: space[2], paddingHorizontal: space[4], paddingBottom: space[2] },
  searchRow: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontSize: fontSize.bodyMd, color: colors.fg, paddingVertical: 0 },
  locate: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mapBox: {
    height: 260,
    marginHorizontal: space[4],
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  mapFailed: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[4], gap: space[2] },
  mapFailedTitle: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  mapFailedBody: { fontSize: fontSize.bodySm, color: colors.fgMuted, textAlign: 'center' },
  searchHere: {
    position: 'absolute',
    top: space[2],
    alignSelf: 'center',
    paddingHorizontal: space[4],
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  searchHereText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg },
  devBadge: {
    position: 'absolute',
    left: space[2],
    bottom: space[6],
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.xs,
    fontSize: fontSize.labelSm,
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  listBox: { flex: 1, marginTop: space[2] },
  list: { paddingHorizontal: space[4], paddingBottom: space[6] },
}));
