// Pruebas de THERS Places en la web (ADR-040, fase 3). Sin dependencias: `node --test`.
// Cubren la lógica pura (coordenadas, estados de la vista) y reglas que no deben romperse
// por accidente (traducciones completas, geolocalización permitida, privacidad de la ubicación).
// NO sustituyen una prueba en el navegador: el mapa necesita WebGL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

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
} from '../src/features/places/lib/coordinates.js';
import { deriveViewState, locationNotice } from '../src/features/places/lib/placesState.js';
import { REPORT_REASONS } from '../src/features/places/lib/placeReasons.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf-8');
// Código sin comentarios: las reglas se comprueban sobre lo que se ejecuta, no sobre lo que se explica.
const code = (path) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(\/\/|#).*$/gm, '');

describe('privacidad: coordenadas redondeadas', () => {
  it('redondea a 3 decimales (~110 m)', () => {
    assert.equal(COORD_PRECISION, 3);
    assert.equal(roundCoordinate(13.692941), 13.693);
    assert.equal(roundCoordinate(-89.218191), -89.218);
    assert.deepEqual(roundPoint({ lat: 13.69294, lng: -89.21819 }), { lat: 13.693, lng: -89.218 });
  });

  it('el redondeo desplaza el punto menos de ~80 m, no más', () => {
    const exact = { lat: 13.69294, lng: -89.21819 };
    assert.ok(haversineMeters(exact, roundPoint(exact)) < 80);
  });

  it('el cliente HTTP redondea ANTES de enviar y no guarda la ubicación', () => {
    const api = read('src/features/places/lib/placesApi.js');
    assert.match(api, /roundPoint\(\{ lat, lng \}\)/g);
    // Dos usos: nearby y search.
    assert.equal(api.match(/roundPoint\(\{ lat, lng \}\)/g).length, 2);
    const geo = code('src/features/places/hooks/useGeolocation.js');
    assert.doesNotMatch(geo, /localStorage|sessionStorage|watchPosition/);
    assert.match(geo, /getCurrentPosition/);
    assert.match(geo, /roundPoint/);
  });

  it('la ubicación nunca se pide sola al abrir la página', () => {
    const page = read('src/features/places/pages/Places.jsx');
    // Solo se invoca desde un botón (onClick={geo.request}); jamás dentro de un efecto.
    assert.match(page, /onClick=\{geo\.request\}/);
    assert.doesNotMatch(page, /useEffect\([^)]*geo\.request/s);
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
    const mid = radiusFromBounds(c, { lat: 13.72, lng: -89.21 });
    assert.ok(mid > 3000 && mid < 3500);
    assert.equal(MAX_RADIUS_METERS, 50000);
  });

  it('formatea distancias', () => {
    assert.equal(formatDistance(820), '820 m');
    assert.equal(formatDistance(999.4), '999 m');
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

  it('con resultados ya cargados no parpadea a «cargando» ni a «error» al refrescar', () => {
    assert.equal(deriveViewState({ ...base, count: 2, loading: true }), 'success');
    assert.equal(deriveViewState({ ...base, count: 2, error: 'x' }), 'success');
  });

  it('ubicación denegada es un aviso, no un estado que rompa la vista', () => {
    assert.equal(locationNotice('denied'), 'location_denied');
    assert.equal(locationNotice('unavailable'), 'location_unavailable');
    assert.equal(locationNotice('timeout'), 'location_timeout');
    for (const ok of ['idle', 'requesting', 'granted']) assert.equal(locationNotice(ok), null);
    // La vista sigue siendo utilizable aun con la ubicación denegada.
    assert.equal(deriveViewState({ ...base, count: 4 }), 'success');
  });
});

describe('traducciones', () => {
  const es = JSON.parse(read('src/shared/i18n/locales/es.json'));
  const en = JSON.parse(read('src/shared/i18n/locales/en.json'));

  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
    );

  it('es y en tienen exactamente las mismas claves de places', () => {
    assert.deepEqual(flatten(es.places).sort(), flatten(en.places).sort());
    assert.ok(es.nav.places && en.nav.places);
  });

  it('todos los motivos de reporte tienen texto en los dos idiomas', () => {
    for (const reason of REPORT_REASONS) {
      assert.ok(es.places.report.reasons[reason], `es: ${reason}`);
      assert.ok(en.places.report.reasons[reason], `en: ${reason}`);
    }
    assert.equal(REPORT_REASONS.length, 8);
  });

  it('toda clave places.* usada en el código existe en los dos idiomas', () => {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(join(root, dir))) {
        const rel = `${dir}/${name}`;
        statSync(join(root, rel)).isDirectory() ? walk(rel) : /\.jsx?$/.test(name) && files.push(rel);
      }
    };
    walk('src/features/places');
    const keys = new Set();
    for (const file of files) {
      for (const m of read(file).matchAll(/\bt\(\s*["`](places\.[\w.${}]+)["`]/g)) keys.add(m[1]);
    }
    assert.ok(keys.size > 30);
    const known = new Set(flatten(es.places).map((k) => `places.${k}`));
    for (const key of keys) {
      if (key.includes('${')) continue; // dinámicas (p. ej. places.report.reasons.${value})
      assert.ok(known.has(key), `falta la clave ${key}`);
    }
    // Las dinámicas de ubicación (`places.location.${notice}`) deben existir para cada aviso.
    for (const notice of ['location_denied', 'location_unavailable', 'location_timeout']) {
      assert.ok(es.places.location[notice] && en.places.location[notice]);
    }
  });
});

describe('integración', () => {
  it('la ruta existe dentro del shell protegido y es un chunk propio', () => {
    const router = read('src/app/router/router.jsx');
    assert.match(router, /import\("@features\/places"\)/);
    assert.match(router, /path="\/places" element=\{<Places \/>\}/);
    assert.match(router, /path="\/places\/:placeId" element=\{<Places \/>\}/);
  });

  it('el destino «Lugares» está en la barra lateral real (no en el NavRail que ya no se usa)', () => {
    const nav = read('src/app/layout/thers/navigation.js');
    assert.match(nav, /id: "places", to: "\/places"/);
    assert.match(nav, /labelKey: "nav\.places"/);
  });

  it('el worker de MapLibre se sirve desde una ruta fija (sin esto el mapa queda vacío)', () => {
    const vite = read('vite.config.js');
    assert.match(vite, /maplibreWorker\(\)/);
    assert.match(read('vite-maplibre-worker.js'), /maplibre\/\$\{WORKER_FILE\}|maplibre\/maplibre-gl-worker\.mjs/);
    const map = read('src/features/places/components/PlacesMap.jsx');
    assert.match(map, /setWorkerUrl\(/);
    // MapLibre 6 no tiene export por defecto: se importa como espacio de nombres.
    assert.match(map, /import \* as maplibregl from "maplibre-gl"/);
  });

  it('la ficha nunca se pinta con un lugar nulo ni de otro id', () => {
    const hook = read('src/features/places/hooks/usePlaceDetail.js');
    assert.match(hook, /state\.place\.id !== placeId/);
    const panel = read('src/features/places/components/PlaceDetailPanel.jsx');
    assert.match(panel, /status === "idle" \|\| !place/);
  });

  it('la política de permisos permite la geolocalización (si no, «usar mi ubicación» nunca funcionaría)', () => {
    const headers = code('public/_headers');
    assert.match(headers, /geolocation=\(self\)/);
    assert.doesNotMatch(headers, /geolocation=\(\)/);
  });

  it('el CSP admite los workers blob: que usa MapLibre', () => {
    assert.match(read('public/_headers'), /worker-src 'self' blob:/);
  });

  it('el proveedor de tiles se configura por variable de entorno, no está fijo', () => {
    const config = read('src/features/places/lib/mapConfig.js');
    assert.match(config, /import\.meta\.env\.VITE_MAP_STYLE_URL/);
    assert.match(read('.env.example'), /^VITE_MAP_STYLE_URL=$/m);
    // El único literal permitido es el estilo de DEMOSTRACIÓN de desarrollo.
    const urls = [...config.matchAll(/https?:\/\/[^\s"']+/g)].map((m) => m[0]);
    assert.ok(urls.every((u) => u.includes('demotiles.maplibre.org') || u.includes('ADR')));
  });

  it('los enlaces del detalle se validan antes de pintarse', () => {
    const detail = read('src/features/places/components/PlaceDetailPanel.jsx');
    assert.match(detail, /\^https\?:\\\/\\\//);
    assert.match(detail, /rel="noopener noreferrer"/);
  });

  it('el detalle solo muestra campos que respalda el backend (nada inventado)', () => {
    const files = ['PlaceCard.jsx', 'PlaceDetailPanel.jsx'].map((f) => read(`src/features/places/components/${f}`));
    for (const source of files) assert.doesNotMatch(source, /rating|reviews_count|is_open/);
  });
});
