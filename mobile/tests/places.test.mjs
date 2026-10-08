// Pruebas de THERS Places en la app (ADR-040, fase 3). Sin dependencias: `node --test`.
// Cubren la lógica pura (coordenadas, estados de la vista) y reglas que no deben romperse
// por accidente (privacidad de la ubicación, atribución del mapa, paridad con el backend).
// NO sustituyen una prueba en el teléfono: el mapa necesita una build nativa.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  COORD_PRECISION,
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
  formatDistance,
  haversineMeters,
  isValidPoint,
  radiusFromBounds,
  roundCoordinate,
  roundPoint,
} from '../src/features/places/coordinates.ts';
import { REPORT_REASONS } from '../src/features/places/placeReasons.ts';
import {
  LOCATION_NOTICE_TEXT,
  deriveViewState,
  locationNotice,
} from '../src/features/places/viewState.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf-8');
// Código sin comentarios: las reglas se comprueban sobre lo que se ejecuta, no sobre lo que se explica.
const code = (path) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('privacidad: coordenadas redondeadas', () => {
  it('redondea a 3 decimales (~110 m)', () => {
    assert.equal(COORD_PRECISION, 3);
    assert.equal(roundCoordinate(13.692941), 13.693);
    assert.equal(roundCoordinate(-89.218191), -89.218);
    assert.deepEqual(roundPoint({ lat: 13.69294, lng: -89.21819 }), { lat: 13.693, lng: -89.218 });
  });

  it('el redondeo desplaza el punto menos de ~80 m', () => {
    const exact = { lat: 13.69294, lng: -89.21819 };
    assert.ok(haversineMeters(exact, roundPoint(exact)) < 80);
  });

  it('el cliente HTTP redondea ANTES de enviar (nearby y search)', () => {
    const api = code('src/features/places/api.ts');
    assert.equal(api.match(/roundPoint\(/g).length, 2);
  });

  it('la ubicación no se guarda, no se rastrea y solo se pide por un botón', () => {
    const geo = code('src/features/places/useGeolocation.ts');
    assert.doesNotMatch(geo, /AsyncStorage|SecureStore|localStorage|watchPositionAsync|startLocationUpdates|Background/);
    assert.match(geo, /requestForegroundPermissionsAsync/);
    assert.match(geo, /getCurrentPositionAsync/);
    assert.match(geo, /roundPoint/);
    const screen = code('app/places/index.tsx');
    // Solo se invoca desde un botón (onPress); jamás dentro de un efecto.
    assert.match(screen, /onPress=\{\(\) => void geo\.request\(\)\}/);
    assert.doesNotMatch(screen, /useEffect\([^)]*geo\.request/s);
  });
});

describe('coordenadas', () => {
  it('valida puntos', () => {
    assert.ok(isValidPoint({ lat: 0, lng: 0 }));
    assert.ok(isValidPoint({ lat: 90, lng: 180 }));
    assert.ok(!isValidPoint({ lat: 91, lng: 0 }));
    assert.ok(!isValidPoint({ lat: 0, lng: -181 }));
    assert.ok(!isValidPoint({ lat: NaN, lng: 0 }));
    assert.ok(!isValidPoint(null));
  });

  it('haversine: ~111 km por grado de latitud', () => {
    const d = haversineMeters({ lat: 13, lng: -89 }, { lat: 14, lng: -89 });
    assert.ok(Math.abs(d - 111195) < 300);
    assert.equal(haversineMeters({ lat: 5, lng: 5 }, { lat: 5, lng: 5 }), 0);
  });

  it('el radio de «buscar en esta zona» respeta los límites del backend', () => {
    const c = { lat: 13.69, lng: -89.21 };
    assert.equal(radiusFromBounds(c, c), MIN_RADIUS_METERS);
    assert.equal(radiusFromBounds(c, { lat: 20, lng: -80 }), MAX_RADIUS_METERS);
    assert.equal(MAX_RADIUS_METERS, 50000);
  });

  it('formatea distancias', () => {
    assert.equal(formatDistance(820), '820 m');
    assert.equal(formatDistance(2300), '2,3 km');
    assert.equal(formatDistance(12400), '12 km');
    assert.equal(formatDistance(undefined), '');
    assert.equal(formatDistance(-5), '');
  });
});

describe('estados de la vista (encargo §25)', () => {
  const base = { loading: false, error: null, offline: false, count: 0 };

  it('cada situación se resuelve en un único estado', () => {
    assert.equal(deriveViewState({ ...base, loading: true }), 'loading');
    assert.equal(deriveViewState({ ...base, error: 'x' }), 'error');
    assert.equal(deriveViewState({ ...base, offline: true }), 'offline');
    assert.equal(deriveViewState(base), 'empty');
    assert.equal(deriveViewState({ ...base, count: 3 }), 'success');
  });

  it('sin red gana sobre error y sobre cargando', () => {
    assert.equal(deriveViewState({ ...base, offline: true, error: 'x', loading: true }), 'offline');
  });

  it('con resultados no parpadea a «cargando» ni a «error» al refrescar', () => {
    assert.equal(deriveViewState({ ...base, count: 2, loading: true }), 'success');
    assert.equal(deriveViewState({ ...base, count: 2, error: 'x' }), 'success');
  });

  it('ubicación denegada es un aviso con texto, no un estado que rompa la lista', () => {
    assert.equal(locationNotice('denied'), 'location_denied');
    assert.equal(locationNotice('unavailable'), 'location_unavailable');
    assert.equal(locationNotice('timeout'), 'location_timeout');
    for (const ok of ['idle', 'requesting', 'granted']) assert.equal(locationNotice(ok), null);
    for (const text of Object.values(LOCATION_NOTICE_TEXT)) assert.ok(text.length > 20);
  });
});

describe('paridad con el backend', () => {
  it('los motivos de reporte coinciden exactamente con los del servidor', () => {
    const kinds = readFileSync(join(root, '../backend/app/domain/places/kinds.py'), 'utf-8');
    const block = kinds.match(/REPORT_REASONS = \(([\s\S]*?)\)/)[1];
    const names = [...block.matchAll(/REPORT_[A-Z_]+/g)].map((m) => m[0]);
    const backend = names.map((name) => kinds.match(new RegExp(`^${name} = "([a-z_]+)"`, 'm'))[1]);
    assert.deepEqual(REPORT_REASONS.map((r) => r.value).sort(), backend.sort());
    assert.equal(REPORT_REASONS.length, 8);
  });

  it('los límites de radio coinciden con los del servidor', () => {
    const kinds = readFileSync(join(root, '../backend/app/domain/places/kinds.py'), 'utf-8');
    assert.equal(Number(kinds.match(/MAX_RADIUS_METERS = (\d+)/)[1]), MAX_RADIUS_METERS);
  });
});

describe('integración', () => {
  it('el mapa conserva la atribución del proveedor y de OpenStreetMap (licencia ODbL)', () => {
    const map = code('src/features/places/PlacesMap.tsx');
    assert.match(map, /\battribution\b/);
    assert.doesNotMatch(map, /attribution=\{false\}/);
  });

  it('el proveedor de tiles se configura por variable de entorno, no está fijo', () => {
    const config = code('src/features/places/mapConfig.ts');
    assert.match(config, /process\.env\.EXPO_PUBLIC_MAP_STYLE_URL/);
    const urls = [...config.matchAll(/https?:\/\/[^\s'"]+/g)].map((m) => m[0]);
    assert.ok(urls.every((u) => u.includes('demotiles.maplibre.org')));
  });

  it('el plugin de MapLibre y el permiso de ubicación están en app.json', () => {
    const app = JSON.parse(read('app.json'));
    const plugins = app.expo.plugins;
    assert.ok(plugins.includes('@maplibre/maplibre-react-native'));
    const location = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location');
    assert.ok(location, 'falta expo-location');
    assert.match(location[1].locationWhenInUsePermission, /No se guarda/);
  });

  it('las dependencias nativas están declaradas', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.dependencies['@maplibre/maplibre-react-native']);
    assert.ok(pkg.dependencies['expo-location']);
  });

  it('las pantallas existen y hay una entrada desde «Explorar»', () => {
    assert.ok(read('app/places/index.tsx').length > 0);
    assert.ok(read('app/places/[id].tsx').length > 0);
    assert.match(read('app/(tabs)/search.tsx'), /router\.push\('\/places'\)/);
  });

  it('la ficha valida los enlaces y no muestra datos inventados', () => {
    const detail = code('app/places/[id].tsx');
    assert.match(detail, /\^https\?:\\\/\\\//);
    assert.doesNotMatch(detail, /rating|reviews_count|is_open/);
    const card = code('src/features/places/PlaceCard.tsx');
    assert.doesNotMatch(card, /rating|reviews_count|is_open/);
  });

  it('todas las llamadas van autenticadas (así el servidor marca is_saved)', () => {
    const api = code('src/features/places/api.ts');
    const calls = api.match(/request(<[^>]*>)?\(/g).length;
    assert.equal(api.match(/authenticated: true/g).length, calls);
  });
});
