import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';

import { colors } from '@shared/design/tokens';

import { radiusFromBounds } from './coordinates';
import { DEFAULT_ZOOM, MAP_STYLE_URL } from './mapConfig';
import type { LatLng, PlaceSummary } from './types';

type Props = {
  places: PlaceSummary[];
  selectedId?: string;
  /** Vista inicial; solo se lee al montar. */
  center: LatLng;
  /** Centra el mapa cuando cambia `key` (p. ej. al usar «mi ubicación»). */
  focus?: { lat: number; lng: number; zoom?: number; key: string } | null;
  /** Punto (redondeado) de la persona, si lo compartió. */
  userPoint?: LatLng | null;
  onSelect: (id: string) => void;
  /** Solo se llama por gestos de la persona, no por los movimientos de este componente. */
  onViewportChange?: (viewport: { center: LatLng; radius: number }) => void;
  /** El estilo no cargó (clave rechazada, sin red…): la lista sigue funcionando. */
  onFailed?: () => void;
};

/**
 * Mapa de lugares (MapLibre Native). El proveedor sale de `EXPO_PUBLIC_MAP_STYLE_URL`.
 * Los pines son UNA capa GeoJSON (no un marcador por lugar): aguanta cientos sin lag.
 * Requiere una build nativa (no funciona en Expo Go).
 */
export function PlacesMap({
  places,
  selectedId,
  center,
  focus,
  userPoint,
  onSelect,
  onViewportChange,
  onFailed,
}: Props) {
  const camera = useRef<CameraRef>(null);

  const placesData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: places.map((place) => ({
        type: 'Feature' as const,
        properties: { id: place.id, name: place.name },
        geometry: { type: 'Point' as const, coordinates: [place.longitude, place.latitude] },
      })),
    }),
    [places],
  );

  const userData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: userPoint
        ? [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: { type: 'Point' as const, coordinates: [userPoint.lng, userPoint.lat] },
            },
          ]
        : [],
    }),
    [userPoint],
  );

  // Centrar por orden de la pantalla.
  useEffect(() => {
    if (!focus) return;
    camera.current?.easeTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 13, duration: 600 });
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Centrar suavemente en el lugar seleccionado.
  useEffect(() => {
    const place = places.find((p) => p.id === selectedId);
    if (place) camera.current?.easeTo({ center: [place.longitude, place.latitude], duration: 400 });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Map
      style={styles.map}
      mapStyle={MAP_STYLE_URL}
      // La atribución del proveedor y de OpenStreetMap es OBLIGATORIA (ODbL): no se oculta.
      attribution
      compass={false}
      onDidFailLoadingMap={() => onFailed?.()}
      onRegionDidChange={(event) => {
        const view = event.nativeEvent;
        if (!view.userInteraction || !onViewportChange) return;
        const [, , east, north] = view.bounds;
        const mid = { lat: view.center[1], lng: view.center[0] };
        onViewportChange({
          center: mid,
          radius: radiusFromBounds(mid, { lat: north, lng: east }),
        });
      }}
    >
      <Camera
        ref={camera}
        initialViewState={{ center: [center.lng, center.lat], zoom: DEFAULT_ZOOM }}
      />

      <GeoJSONSource
        id="places"
        data={placesData}
        onPress={(event) => {
          const id = event.nativeEvent.features?.[0]?.properties?.id;
          if (typeof id === 'string') onSelect(id);
        }}
      >
        <Layer
          id="places-selected-halo"
          type="circle"
          filter={['==', ['get', 'id'], selectedId ?? '']}
          paint={{ 'circle-radius': 16, 'circle-color': colors.brand, 'circle-opacity': 0.25 }}
        />
        <Layer
          id="places-pins"
          type="circle"
          paint={{
            'circle-radius': 8,
            'circle-color': colors.brand,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="me" data={userData}>
        <Layer
          id="me-dot"
          type="circle"
          paint={{
            'circle-radius': 8,
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
