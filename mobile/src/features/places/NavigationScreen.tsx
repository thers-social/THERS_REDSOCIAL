import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { formatDistance } from './coordinates';
import { formatRemaining, maneuverArrow } from './navigation';
import type { LngLat } from './navigation';
import { NavigationMap } from './NavigationMap';
import type { RouteProfile } from './routeFormat';
import type { RoutePlan } from './types';
import { useNavigation } from './useNavigation';

type Props = {
  visible: boolean;
  route: RoutePlan;
  placeId: string;
  placeName: string;
  profile: RouteProfile;
  destination: { lat: number; lng: number };
  onClose: () => void;
};

/** Hora de llegada estimada, «14:35». */
function arrivalClock(secondsFromNow: number): string {
  const when = new Date(Date.now() + secondsFromNow * 1000);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/**
 * Navegación en vivo en pantalla completa (ADR-040 §30). Se monta SOLO mientras está abierta:
 * al cerrarla se deja de leer la ubicación, se apaga la voz y la pantalla vuelve a poder apagarse.
 */
export function NavigationScreen(props: Props) {
  // El hook y su estado viven y mueren con el modal: al cerrarlo se limpia todo.
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose} statusBarTranslucent>
      {props.visible ? <NavigationBody {...props} /> : null}
    </Modal>
  );
}

function NavigationBody({ route: initialRoute, placeId, placeName, profile, destination, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const destinationPoint: LngLat = [destination.lng, destination.lat];
  const nav = useNavigation({ route: initialRoute, placeId, placeName, profile, destination: destinationPoint });
  const [following, setFollowing] = useState(true);
  const { view, route, muted } = nav;
  const next = view.progress?.next ?? null;

  const headline = (() => {
    if (view.status === 'arrived') return { arrow: '⚑', title: `Llegaste a ${placeName}`, detail: null as string | null };
    if (view.status === 'rerouting') return { arrow: '↻', title: 'Recalculando la ruta…', detail: null };
    if (view.status === 'error') return { arrow: '!', title: view.message ?? 'No pudimos seguir tu ubicación', detail: null };
    if (view.status === 'paused') return { arrow: 'Ⅱ', title: 'Navegación en pausa', detail: view.message };
    if (next) return { arrow: maneuverArrow(next.step.type), title: next.step.instruction, detail: `En ${formatDistance(next.distance)}` };
    if (view.status === 'starting') return { arrow: '⌖', title: 'Buscando tu ubicación…', detail: null };
    return { arrow: '↑', title: `Sigue hacia ${placeName}`, detail: null };
  })();

  const remainingSeconds = view.progress?.remainingSeconds ?? route.duration_s;
  const remainingMeters = view.progress?.remainingMeters ?? route.distance_m;

  return (
    <View style={styles.screen}>
      <NavigationMap
        line={route.geometry.coordinates}
        destination={destinationPoint}
        puck={view.puck}
        heading={view.heading}
        following={following}
        onUserMove={() => setFollowing(false)}
      />

      <View style={[styles.banner, { paddingTop: insets.top + space[3] }]} pointerEvents="box-none">
        <View style={styles.bannerCard} accessibilityLiveRegion="polite">
          <Text style={styles.arrow} accessibilityElementsHidden>
            {headline.arrow}
          </Text>
          <View style={styles.bannerText}>
            {headline.detail ? <Text style={styles.bannerDetail}>{headline.detail}</Text> : null}
            <Text style={styles.bannerTitle}>{headline.title}</Text>
            {view.message && view.status === 'navigating' ? <Text style={styles.warning}>{view.message}</Text> : null}
          </View>
        </View>
      </View>

      {!following && view.puck ? (
        <Pressable style={styles.recenter} onPress={() => setFollowing(true)} accessibilityRole="button">
          <Text style={styles.recenterText}>Recentrar</Text>
        </Pressable>
      ) : null}

      {nav.simulation.available ? (
        <View style={[styles.devBar, { top: insets.top + 150 }]}>
          <Text style={styles.devLabel}>Solo desarrollo</Text>
          {nav.simulation.active ? (
            <>
              <Pressable style={styles.devButton} onPress={nav.simulation.detour} accessibilityRole="button">
                <Text style={styles.devText}>Salirme de la ruta</Text>
              </Pressable>
              <Pressable style={styles.devButton} onPress={nav.simulation.stop} accessibilityRole="button">
                <Text style={styles.devText}>Parar simulación</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.devButton} onPress={() => nav.simulation.start(40)} accessibilityRole="button">
              <Text style={styles.devText}>Simular recorrido</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[3] }]}>
        <View style={styles.stats}>
          <View>
            <Text style={styles.statBig}>{formatRemaining(remainingSeconds)}</Text>
            <Text style={styles.muted}>
              {formatDistance(remainingMeters)} · llegas {arrivalClock(remainingSeconds)}
            </Text>
          </View>
          <Pressable
            onPress={() => nav.setMuted(!muted)}
            style={styles.smallButton}
            accessibilityRole="button"
            accessibilityState={{ selected: !muted }}
            accessibilityLabel={muted ? 'Activar la voz' : 'Silenciar la voz'}
          >
            <Text style={styles.smallButtonText}>{muted ? 'Voz: no' : 'Voz: sí'}</Text>
          </Pressable>
        </View>
        <Pressable onPress={onClose} style={styles.finish} accessibilityRole="button" accessibilityLabel="Terminar la navegación">
          <Text style={styles.finishText}>{view.status === 'arrived' ? 'Cerrar' : 'Terminar'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  banner: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space[3] },
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.card,
    backgroundColor: colors.brand,
  },
  arrow: { fontSize: 44, lineHeight: 50, color: '#ffffff', fontWeight: '700', minWidth: 54, textAlign: 'center' },
  bannerText: { flex: 1, gap: 2 },
  bannerDetail: { fontSize: fontSize.bodyMd, color: '#ffffff', opacity: 0.9, fontWeight: '700' },
  bannerTitle: { fontSize: fontSize.bodyLg, color: '#ffffff', fontWeight: '700' },
  warning: { fontSize: fontSize.labelMd, color: '#ffffff', opacity: 0.9, marginTop: space[1] },
  recenter: {
    position: 'absolute',
    right: space[3],
    bottom: 190,
    paddingHorizontal: space[4],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recenterText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg },
  devBar: {
    position: 'absolute',
    left: space[3],
    gap: space[2],
    padding: space[2],
    borderRadius: radius.card,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  devLabel: { fontSize: fontSize.labelSm, color: '#fbbf24', fontWeight: '700' },
  devButton: { paddingHorizontal: space[3], minHeight: 36, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: '#374151' },
  devText: { fontSize: fontSize.labelMd, color: '#ffffff', fontWeight: '700' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  stats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statBig: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  smallButton: {
    paddingHorizontal: space[4],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallButtonText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg },
  finish: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.dangerFg,
  },
  finishText: { fontSize: fontSize.bodyMd, fontWeight: '700', color: '#ffffff' },
}));
