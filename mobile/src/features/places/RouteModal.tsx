import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { formatDistance } from './coordinates';
import { formatDuration, ROUTE_ATTRIBUTION, stepTitle } from './routeFormat';
import { RouteMap } from './RouteMap';
import type { LatLng, RoutePlan, RouteStep } from './types';

type Props = {
  visible: boolean;
  route: RoutePlan;
  origin: LatLng;
  destination: LatLng;
  placeName: string;
  onClose: () => void;
};

/**
 * La ruta en pantalla completa: un mapa que se puede acercar y mover (el de la ficha está dentro
 * de una pantalla con scroll, que se queda los gestos) y la lista de indicaciones calle por calle.
 * Tocar una indicación lleva el mapa a ese punto, para ver la calle de cerca.
 */
export function RouteModal({ visible, route, origin, destination, placeName, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: string } | null>(null);

  function goTo(step: RouteStep, index: number) {
    setFocus({ lng: step.at[0], lat: step.at[1], key: `${index}-${Date.now()}` });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              Ruta a {placeName}
            </Text>
            <Text style={styles.muted}>
              {formatDuration(route.duration_s)} · {formatDistance(route.distance_m)}
            </Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar la ruta" hitSlop={12}>
            <Text style={styles.close}>Cerrar</Text>
          </Pressable>
        </View>

        <View style={styles.map}>
          <RouteMap line={route.geometry.coordinates} origin={origin} destination={destination} focus={focus} />
        </View>

        <Text style={styles.hint}>Pellizcá o tocá dos veces el mapa para acercarlo. Tocá una indicación para verla de cerca.</Text>

        <FlatList
          style={styles.list}
          data={route.steps}
          keyExtractor={(_, index) => String(index)}
          contentContainerStyle={{ paddingBottom: insets.bottom + space[4] }}
          ListEmptyComponent={<Text style={styles.muted}>Esta ruta no trae indicaciones calle por calle.</Text>}
          ListFooterComponent={<Text style={styles.attribution}>{ROUTE_ATTRIBUTION}</Text>}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => goTo(item, index)}
              style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${index + 1}. ${item.instruction}, ${formatDistance(item.distance_m)}`}
            >
              <Text style={styles.number}>{index + 1}</Text>
              <View style={styles.stepText}>
                <Text style={styles.instruction}>{item.instruction}</Text>
                <Text style={styles.muted}>
                  {stepTitle(item)} · {formatDistance(item.distance_m)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  headerText: { flex: 1 },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  close: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  map: { flex: 2, marginHorizontal: space[4], borderRadius: radius.card, overflow: 'hidden' },
  hint: { fontSize: fontSize.labelMd, color: colors.fgMuted, paddingHorizontal: space[4], paddingTop: space[2] },
  list: { flex: 2, paddingHorizontal: space[4], marginTop: space[2] },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stepPressed: { opacity: 0.6 },
  number: {
    width: 28,
    height: 28,
    borderRadius: 14,
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
    fontSize: fontSize.labelMd,
    fontWeight: '700',
    color: '#ffffff',
    backgroundColor: colors.brand,
  },
  stepText: { flex: 1, gap: 2 },
  instruction: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  attribution: { fontSize: fontSize.labelSm, color: colors.fgMuted, paddingTop: space[3] },
}));
