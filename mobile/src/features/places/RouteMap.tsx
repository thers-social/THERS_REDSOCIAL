import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';

import { colors } from '@shared/design/tokens';

import { MAP_STYLE_URL } from './mapConfig';
import { boundsOf } from './routeFormat';
import type { LatLng } from './types';

const PADDING = { top: 32, right: 32, bottom: 32, left: 32 };

type Props = {
  /** Línea de la ruta como pares `[lng, lat]`. */
  line: [number, number][];
  /** Punto (redondeado) de la persona. */
  origin: LatLng;
  /** Punto del lugar. */
  destination: LatLng;
  /** Lleva el mapa a un punto (una indicación) cuando cambia `key`. */
  focus?: { lng: number; lat: number; key: string } | null;
};

/**
 * Mapa pequeño con la ruta hacia un lugar (ADR-040 fase 13): la línea, el origen (punto azul)
 * y el destino (pin de la marca). Usa el mismo proveedor de mapa que «Lugares», con su
 * atribución, y se encuadra solo para que se vea toda la ruta.
 */
export function RouteMap({ line, origin, destination, focus }: Props) {
  const camera = useRef<CameraRef>(null);

  const lineData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: line } },
      ],
    }),
    [line],
  );
  const pointsData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: { kind: 'origin' },
          geometry: { type: 'Point' as const, coordinates: [origin.lng, origin.lat] },
        },
        {
          type: 'Feature' as const,
          properties: { kind: 'destination' },
          geometry: { type: 'Point' as const, coordinates: [destination.lng, destination.lat] },
        },
      ],
    }),
    [origin, destination],
  );

  const bounds = useMemo(
    () => boundsOf(line, [[origin.lng, origin.lat], [destination.lng, destination.lat]]),
    [line, origin, destination],
  );

  useEffect(() => {
    if (!bounds) return;
    camera.current?.fitBounds(bounds, { padding: PADDING, duration: 400 });
  }, [bounds]);

  useEffect(() => {
    if (!focus) return;
    camera.current?.easeTo({ center: [focus.lng, focus.lat], zoom: 17, duration: 500 });
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Map
      style={styles.map}
      mapStyle={MAP_STYLE_URL}
      // La atribución del proveedor y de OpenStreetMap es OBLIGATORIA (ODbL): no se oculta.
      attribution
      compass={false}
    >
      {/* El encuadre inicial ya contiene toda la ruta: `fitBounds` en un efecto llegaría antes
          de que el mapa cargue y no haría nada. El efecto de arriba cubre los cambios de ruta. */}
      <Camera
        ref={camera}
        initialViewState={
          bounds
            ? { bounds, padding: PADDING }
            : { center: [destination.lng, destination.lat], zoom: 13 }
        }
      />
      <GeoJSONSource id="route-line" data={lineData}>
        <Layer
          id="route-line-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#ffffff', 'line-width': 8 }}
        />
        <Layer
          id="route-line-main"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': colors.brand, 'line-width': 5 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="route-points" data={pointsData}>
        <Layer
          id="route-origin"
          type="circle"
          filter={['==', ['get', 'kind'], 'origin']}
          paint={{
            'circle-radius': 8,
            'circle-color': '#2563eb',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          }}
        />
        <Layer
          id="route-destination"
          type="circle"
          filter={['==', ['get', 'kind'], 'destination']}
          paint={{
            'circle-radius': 9,
            'circle-color': colors.brand,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          }}
        />
      </GeoJSONSource>
    </Map>
  );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
