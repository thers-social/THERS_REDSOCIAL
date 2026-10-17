import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import { fetchRoute } from './api';
import { formatDistance } from './coordinates';
import { trackPlaceVisit } from './placeVisits';
import { formatDuration, PROFILE_LABEL, PROFILES, ROUTE_ATTRIBUTION } from './routeFormat';
import type { RouteProfile } from './routeFormat';
import { RouteMap } from './RouteMap';
import { NavigationScreen } from './NavigationScreen';
import { RouteModal } from './RouteModal';
import type { LatLng, PlaceDetail, RoutePlan } from './types';
import { LOCATION_NOTICE_TEXT, locationNotice } from './viewState';
import { useGeolocation } from './useGeolocation';

/**
 * «Cómo llegar» (ADR-040 fase 13). La ubicación se pide SOLO al tocar el botón y se envía,
 * redondeada, a nuestro servidor, que la usa para pedir la ruta a OpenRouteService; no se
 * guarda. Se oculta si el servidor no tiene proveedor de rutas o si no hay sesión.
 */
export function PlaceRoute({ place }: { place: PlaceDetail }) {
  const { user } = useAuth();
  const geo = useGeolocation();
  const [profile, setProfile] = useState<RouteProfile>('walk');
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (point: LatLng, nextProfile: RouteProfile) => {
      setBusy(true);
      setError(null);
      try {
        setRoute(await fetchRoute(place.id, point, nextProfile));
        setOrigin(point);
      } catch (e) {
        setRoute(null);
        setError(e instanceof ApiError ? e.message : 'No pudimos calcular la ruta. Intentá de nuevo.');
      } finally {
        setBusy(false);
      }
    },
    [place.id],
  );

  async function start() {
    if (busy || geo.status === 'requesting') return;
    trackPlaceVisit(place.id, 'directions');
    // El permiso y la lectura se piden aquí, nunca al abrir la ficha.
    await geo.request();
  }

  // Cuando llega el punto de la persona, se pide la ruta con el perfil elegido en ese momento.
  useEffect(() => {
    if (geo.point) void load(geo.point, profile);
  }, [geo.point]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Antes de seguir la ubicación en vivo se explica qué se lee y qué se envía (ADR-040 §30). */
  function startNavigation() {
    Alert.alert(
      'Navegar con tu ubicación',
      'THERS leerá tu ubicación mientras esta pantalla esté abierta, para guiarte con la voz. No la guardamos.\n\n' +
        'Si te salís de la ruta, enviaremos tu ubicación (a unos 10 m) para recalcularla. ' +
        'Puedes terminar cuando quieras.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar', onPress: () => setNavigating(true) },
      ],
    );
  }

  if (!user || !place.routing_available) return null;

  const notice = locationNotice(geo.status);

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        Cómo llegar
      </Text>

      {!route ? (
        <Text style={styles.muted}>
          Al tocar el botón, tu ubicación aproximada (a unos 100 m) se envía a nuestro servidor y a
          OpenRouteService para calcular la ruta. No la guardamos.
        </Text>
      ) : null}

      <View style={styles.chips}>
        {PROFILES.map((p) => (
          <Pressable
            key={p}
            onPress={() => {
              setProfile(p);
              if (origin) void load(origin, p);
            }}
            style={[styles.chip, p === profile && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: p === profile }}
          >
            <Text style={[styles.chipText, p === profile && styles.chipTextActive]}>{PROFILE_LABEL[p]}</Text>
          </Pressable>
        ))}
      </View>

      {notice ? <Banner tone="info">{LOCATION_NOTICE_TEXT[notice]}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      {!route ? (
        <Button
          label="Cómo llegar"
          variant="secondary"
          onPress={() => void start()}
          loading={busy || geo.status === 'requesting'}
        />
      ) : (
        <>
          <View style={styles.summary}>
            <Text style={styles.big}>{formatDuration(route.duration_s)}</Text>
            <Text style={styles.muted}>{formatDistance(route.distance_m)}</Text>
          </View>
          {origin ? (
            <>
              {/* Vista previa: el mapa no recibe toques (dentro de la pantalla con scroll se
                  quedaría los gestos); tocarla abre la ruta en pantalla completa. */}
              <Pressable
                onPress={() => setFullscreen(true)}
                style={styles.map}
                accessibilityRole="button"
                accessibilityLabel="Ver la ruta en pantalla completa"
              >
                <View pointerEvents="none" style={styles.mapInner}>
                  <RouteMap
                    line={route.geometry.coordinates}
                    origin={origin}
                    destination={{ lat: place.latitude, lng: place.longitude }}
                  />
                </View>
              </Pressable>
              <Button label="Iniciar navegación" onPress={startNavigation} />
              <Button
                label="Ver mapa grande y calles"
                variant="secondary"
                onPress={() => setFullscreen(true)}
              />
              <NavigationScreen
                visible={navigating}
                route={route}
                placeId={place.id}
                placeName={place.name}
                profile={profile}
                destination={{ lat: place.latitude, lng: place.longitude }}
                onClose={() => setNavigating(false)}
              />
              <RouteModal
                visible={fullscreen}
                route={route}
                origin={origin}
                destination={{ lat: place.latitude, lng: place.longitude }}
                placeName={place.name}
                onClose={() => setFullscreen(false)}
              />
            </>
          ) : null}
          <Text style={styles.attribution}>{ROUTE_ATTRIBUTION}</Text>
        </>
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginTop: space[6], gap: space[3] },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  chips: { flexDirection: 'row', gap: space[2] },
  chip: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg },
  chipTextActive: { color: '#ffffff' },
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  big: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg },
  map: { height: 240, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface },
  mapInner: { flex: 1 },
  attribution: { fontSize: fontSize.labelSm, color: colors.fgMuted },
}));
