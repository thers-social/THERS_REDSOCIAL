import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError } from '@shared/lib/api';

import { fetchRoute } from './api';
import {
  arrivalText,
  bearingDegrees,
  buildRouteIndex,
  hasArrived,
  haversineMeters,
  INITIAL_OFF_ROUTE,
  MAX_ACCURACY_M,
  nextAnnouncement,
  pointAtAlong,
  progressAt,
  snapToRoute,
  stepStarts,
  updateOffRoute,
} from './navigation';
import type { LngLat, OffRouteState, Progress, RouteIndex } from './navigation';
import type { RouteProfile } from './routeFormat';
import type { RoutePlan } from './types';

const KEEP_AWAKE_TAG = 'thers-navigation';
const SPEECH_LANGUAGE = 'es-MX';
/** Lecturas a más de esto de la ruta se dibujan donde están, no pegadas a la línea. */
const SNAP_DRAW_M = 30;
const SIMULATION_STEP_MS = 1000;
const M_PER_DEG_LAT = 111194.9;

export type NavStatus = 'starting' | 'navigating' | 'rerouting' | 'arrived' | 'paused' | 'error';

export type NavView = {
  status: NavStatus;
  /** Posición real (solo vive aquí, en memoria; nunca se guarda ni se envía). */
  position: LngLat | null;
  /** Dónde dibujar el punto: pegado a la ruta si va por ella. */
  puck: LngLat | null;
  heading: number | null;
  progress: Progress | null;
  /** Aviso para mostrar (error de permiso, recalculo que falló...). */
  message: string | null;
};

type Params = {
  route: RoutePlan;
  placeId: string;
  placeName: string;
  profile: RouteProfile;
  destination: LngLat;
};

/**
 * Navegación en vivo (ADR-040 §30). Mientras la pantalla de navegación está abierta: lee la
 * posición, calcula el avance sobre la ruta, habla cada maniobra, mantiene la pantalla encendida y
 * recalcula si la persona se sale. Todo el cálculo es local; la red solo se usa para recalcular.
 *
 * - Solo con la app abierta: al pasar a segundo plano se deja de leer la ubicación.
 * - La posición exacta no se guarda ni se envía; un recalculo manda el origen a ~11 m.
 * - En desarrollo (`__DEV__`) hay una simulación que recorre la ruta sin salir a caminar.
 */
export function useNavigation({ route: initialRoute, placeId, placeName, profile, destination }: Params) {
  const [route, setRoute] = useState<RoutePlan>(initialRoute);
  const [view, setView] = useState<NavView>({
    status: 'starting',
    position: null,
    puck: null,
    heading: null,
    progress: null,
    message: null,
  });
  const [muted, setMutedState] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const mounted = useRef(true);
  const mutedRef = useRef(false);
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const routeRef = useRef(initialRoute);
  const engine = useRef({
    index: null as RouteIndex | null,
    starts: [] as number[],
    hint: 0,
    announced: new Set<string>(),
    offRoute: INITIAL_OFF_ROUTE as OffRouteState,
    started: false,
    arrived: false,
    rerouting: false,
    heading: null as number | null,
    lastPosition: null as LngLat | null,
  });
  const sim = useRef({ timer: null as ReturnType<typeof setInterval> | null, along: 0, offsetEastM: 0 });

  const speak = useCallback((text: string) => {
    if (mutedRef.current) return;
    Speech.stop();
    Speech.speak(text, { language: SPEECH_LANGUAGE, rate: 1.0, onError: () => undefined });
  }, []);

  /** Carga una ruta (la inicial o la de un recalculo) y reinicia lo que depende de ella. */
  const loadRoute = useCallback((next: RoutePlan) => {
    const index = buildRouteIndex(next.geometry.coordinates);
    engine.current.index = index;
    engine.current.starts = stepStarts(index, next.steps);
    engine.current.hint = 0;
    engine.current.announced = new Set();
    engine.current.offRoute = { ...INITIAL_OFF_ROUTE, lastRerouteAt: engine.current.offRoute.lastRerouteAt };
    routeRef.current = next;
    sim.current.along = 0;
    sim.current.offsetEastM = 0;
    setRoute(next);
  }, []);

  useEffect(() => {
    loadRoute(initialRoute);
    // Solo al montar: un recalculo cambia la ruta por `loadRoute`.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopWatching = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
  }, []);

  const reroute = useCallback(
    async (from: LngLat) => {
      const state = engine.current;
      if (state.rerouting) return;
      state.rerouting = true;
      setView((v) => ({ ...v, status: 'rerouting', message: null }));
      speak('Recalculando la ruta');
      try {
        const next = await fetchRoute(placeId, { lat: from[1], lng: from[0] }, profile, undefined, 'high');
        if (!mounted.current) return;
        loadRoute(next);
        speak('Ruta recalculada');
        setView((v) => ({ ...v, status: 'navigating', message: null }));
      } catch (error) {
        if (!mounted.current) return;
        const message =
          error instanceof ApiError ? error.message : 'No pudimos recalcular la ruta. Seguí la línea del mapa.';
        setView((v) => ({ ...v, status: 'navigating', message }));
      } finally {
        state.rerouting = false;
      }
    },
    [placeId, profile, loadRoute, speak],
  );

  /** Una lectura de posición (real o simulada). */
  const onFix = useCallback(
    (fix: { lng: number; lat: number; accuracy: number | null; heading: number | null; speed: number | null }) => {
      const state = engine.current;
      if (!mounted.current || state.arrived || !state.index) return;
      const position: LngLat = [fix.lng, fix.lat];

      // Rumbo: el del sistema si se mueve; si no, hacia donde se desplazó; si no, el anterior.
      let heading = state.heading;
      if (fix.heading !== null && fix.heading >= 0 && (fix.speed ?? 0) > 1) heading = fix.heading;
      else if (state.lastPosition && haversineMeters(state.lastPosition, position) > 5) {
        heading = bearingDegrees(state.lastPosition, position);
      }
      if (haversineMeters(state.lastPosition ?? position, position) > 5 || state.lastPosition === null) {
        state.lastPosition = position;
      }
      state.heading = heading;

      const snap = snapToRoute(state.index, position, state.hint);
      const puck = snap.distanceFromRoute <= SNAP_DRAW_M ? snap.point : position;

      // Una lectura muy imprecisa mueve el punto pero no decide nada.
      if ((fix.accuracy ?? 0) > MAX_ACCURACY_M || state.rerouting) {
        setView((v) => ({ ...v, position, puck, heading }));
        return;
      }
      state.hint = snap.along;

      const current = routeRef.current;
      const progress = progressAt(state.index, current.steps, state.starts, snap.along, current);

      if (hasArrived(progress.remainingMeters, haversineMeters(position, destination))) {
        state.arrived = true;
        speak(arrivalText(placeName));
        stopWatching();
        stopSimulation();
        setView({ status: 'arrived', position, puck, heading, progress: { ...progress, next: null }, message: null });
        return;
      }

      if (!state.started) {
        state.started = true;
        const first = current.steps[0];
        speak(first ? `Iniciando la navegación. ${first.instruction}` : 'Iniciando la navegación');
      } else if (progress.next) {
        const say = nextAnnouncement(profile, progress.stepIndex + 1, progress.next.step, progress.next.distance, state.announced);
        if (say) {
          say.keys.forEach((key) => state.announced.add(key));
          speak(say.text);
        }
      }

      const off = updateOffRoute(state.offRoute, {
        distanceFromRoute: snap.distanceFromRoute,
        accuracy: fix.accuracy,
        now: Date.now(),
      });
      state.offRoute = off.state;

      setView((v) => ({ ...v, status: v.status === 'rerouting' ? v.status : 'navigating', position, puck, heading, progress }));
      if (off.reroute) void reroute(position);
    },
    [destination, placeName, profile, reroute, speak, stopWatching], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const startWatching = useCallback(async () => {
    if (subscription.current || engine.current.arrived) return;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setView((v) => ({ ...v, status: 'error', message: 'Necesitamos permiso de ubicación para guiarte.' }));
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setView((v) => ({ ...v, status: 'error', message: 'Activá la ubicación del teléfono para navegar.' }));
        return;
      }
      const next = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 },
        (location) =>
          onFix({
            lng: location.coords.longitude,
            lat: location.coords.latitude,
            accuracy: location.coords.accuracy,
            heading: location.coords.heading,
            speed: location.coords.speed,
          }),
      );
      if (!mounted.current) {
        next.remove();
        return;
      }
      subscription.current = next;
      setView((v) => (v.status === 'error' || v.status === 'paused' ? { ...v, status: 'starting', message: null } : v));
    } catch {
      setView((v) => ({ ...v, status: 'error', message: 'No pudimos leer tu ubicación. Revisá que esté activada.' }));
    }
  }, [onFix]);

  // --- Simulación (solo desarrollo) --------------------------------------------------------
  const stopSimulation = useCallback(() => {
    if (sim.current.timer) clearInterval(sim.current.timer);
    sim.current.timer = null;
    setSimulating(false);
  }, []);

  const startSimulation = useCallback(
    (metersPerSecond: number) => {
      if (!__DEV__ || sim.current.timer) return;
      stopWatching();
      setSimulating(true);
      sim.current.timer = setInterval(() => {
        const index = engine.current.index;
        if (!index) return;
        sim.current.along = Math.min(index.total, sim.current.along + metersPerSecond);
        const base = pointAtAlong(index, sim.current.along);
        const cosLat = Math.cos((base[1] * Math.PI) / 180);
        const lng = base[0] + sim.current.offsetEastM / (M_PER_DEG_LAT * cosLat);
        onFix({ lng, lat: base[1], accuracy: 5, heading: null, speed: metersPerSecond });
      }, SIMULATION_STEP_MS);
    },
    [onFix, stopWatching],
  );

  /** (Desarrollo) Aparta la posición simulada 150 m de la ruta para probar el recalculo. */
  const simulateDetour = useCallback(() => {
    if (__DEV__) sim.current.offsetEastM = 150;
  }, []);

  // --- Ciclo de vida -------------------------------------------------------------------------
  useEffect(() => {
    mounted.current = true;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    void startWatching();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (!sim.current.timer) void startWatching();
        setView((v) => (v.status === 'paused' ? { ...v, status: 'starting', message: null } : v));
      } else {
        // Solo con la app abierta: en segundo plano se deja de leer la ubicación (decisión §30).
        stopWatching();
        Speech.stop();
        setView((v) =>
          v.status === 'arrived'
            ? v
            : { ...v, status: 'paused', message: 'Navegación en pausa. Volvé a la app para seguir.' },
        );
      }
    });
    return () => {
      mounted.current = false;
      appState.remove();
      stopWatching();
      if (sim.current.timer) clearInterval(sim.current.timer);
      Speech.stop();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setMuted = useCallback((value: boolean) => {
    mutedRef.current = value;
    setMutedState(value);
    if (value) Speech.stop();
  }, []);

  return {
    view,
    route,
    muted,
    setMuted,
    simulation: { available: __DEV__, active: simulating, start: startSimulation, stop: stopSimulation, detour: simulateDetour },
  };
}
