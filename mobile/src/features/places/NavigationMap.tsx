import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';

import { colors } from '@shared/design/tokens';

import { MAP_STYLE_URL } from './mapConfig';
import type { LngLat } from './navigation';
import { boundsOf } from './routeFormat';

const FOLLOW_ZOOM = 17;
const PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

type Props = {
  line: LngLat[];
  destination: LngLat;
  /** Dónde dibujar el punto de la persona. */
  puck: LngLat | null;
  /** Hacia dónde mira, en grados; el mapa gira para que «arriba» sea adelante. */
  heading: number | null;
  /** `true`: el mapa acompaña a la persona. `false`: lo movió con el dedo. */
  following: boolean;
  /** La persona movió el mapa con el dedo. */
  onUserMove: () => void;
};

/**
 * Mapa de la navegación en vivo (ADR-040 §30): la línea de la ruta, el destino y el punto de la
 * persona. Mientras `following`, el mapa se centra en ella y gira según su rumbo; si lo mueve con
 * el dedo deja de seguirla hasta que toque «Recentrar».
 */
export function NavigationMap({ line, destination, puck, heading, following, onUserMove }: Props) {
  const camera = useRef<CameraRef>(null);

  const lineData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: line } }],
    }),
    [line],
  );
  const pointsData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, properties: { kind: 'destination' }, geometry: { type: 'Point' as const, coordinates: destination } },
        ...(puck
          ? [{ type: 'Feature' as const, properties: { kind: 'me' }, geometry: { type: 'Point' as const, coordinates: puck } }]
          : []),
      ],
    }),
    [destination, puck],
  );

  // La ruta entera al empezar y cuando cambia (recalculo), mientras no haya posición que seguir.
  const bounds = useMemo(() => boundsOf(line, [destination]), [line, destination]);
  useEffect(() => {
    if (bounds && !puck) camera.current?.fitBounds(bounds, { padding: PADDING, duration: 0 });
  }, [bounds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!following || !puck) return;
    camera.current?.easeTo({
      center: puck,
      zoom: FOLLOW_ZOOM,
      ...(heading !== null ? { bearing: heading } : {}),
      duration: 900,
    });
  }, [following, puck?.[0], puck?.[1], heading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Map
      style={styles.map}
      mapStyle={MAP_STYLE_URL}
      // La atribución del proveedor y de OpenStreetMap es OBLIGATORIA (ODbL): no se oculta.
      attribution
      compass={false}
      onRegionDidChange={(event) => {
        if (event.nativeEvent.userInteraction) onUserMove();
      }}
    >
      <Camera ref={camera} initialViewState={{ center: destination, zoom: 14 }} />
      <GeoJSONSource id="nav-route" data={lineData}>
        <Layer
          id="nav-route-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#ffffff', 'line-width': 10 }}
        />
        <Layer
          id="nav-route-main"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': colors.brand, 'line-width': 6 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="nav-points" data={pointsData}>
        <Layer
          id="nav-destination"
          type="circle"
          filter={['==', ['get', 'kind'], 'destination']}
          paint={{
            'circle-radius': 10,
            'circle-color': colors.brand,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          }}
        />
        <Layer
          id="nav-me-halo"
          type="circle"
          filter={['==', ['get', 'kind'], 'me']}
          paint={{ 'circle-radius': 20, 'circle-color': '#2563eb', 'circle-opacity': 0.25 }}
        />
        <Layer
          id="nav-me"
          type="circle"
          filter={['==', ['get', 'kind'], 'me']}
          paint={{
            'circle-radius': 9,
            'circle-color': '#2563eb',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          }}
        />
      </GeoJSONSource>
    </Map>
  );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
