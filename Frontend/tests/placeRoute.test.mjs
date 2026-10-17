// Rutas hacia un lugar en la web (ADR-040, fase 13). Sin dependencias: `node --test`.
// Cubren el formato, la privacidad de la ubicación y que los textos existan en los dos idiomas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { ROUTE_PROFILES, boundsOf, focusableSteps, formatDuration } from '../src/features/places/lib/routeFormat.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const es = JSON.parse(read('src/shared/i18n/locales/es.json'));
const en = JSON.parse(read('src/shared/i18n/locales/en.json'));

// `t` mínimo: busca la clave y sustituye {{param}}.
const makeT = (dict) => (key, params = {}) =>
  key
    .split('.')
    .reduce((node, part) => node?.[part], dict)
    ?.replace(/\{\{(\w+)\}\}/g, (_, name) => params[name]);

describe('formato de la ruta', () => {
  const t = makeT(es);

  it('la duración se escribe en segundos, minutos y horas', () => {
    assert.equal(formatDuration(0, t), '1 s');
    assert.equal(formatDuration(45, t), '45 s');
    assert.equal(formatDuration(60, t), '1 min');
    assert.equal(formatDuration(12 * 60 + 20, t), '12 min');
    assert.equal(formatDuration(3600, t), '1 h');
    assert.equal(formatDuration(3600 + 5 * 60, t), '1 h 5 min');
  });

  it('una duración inválida da cadena vacía', () => {
    for (const bad of [null, undefined, -1, NaN, Infinity, '10']) assert.equal(formatDuration(bad, t), '');
  });

  it('los límites contienen la línea y el origen', () => {
    const line = [[-89.22, 13.69], [-89.2, 13.7], [-89.21, 13.68]];
    assert.deepEqual(boundsOf(line), [-89.22, 13.68, -89.2, 13.7]);
    assert.deepEqual(boundsOf(line, [[-89.3, 13.6], null]), [-89.3, 13.6, -89.2, 13.7]);
    assert.equal(boundsOf([]), null);
    assert.equal(boundsOf([[NaN, NaN]]), null);
  });
});

describe('indicaciones calle por calle', () => {
  const ok = { instruction: 'Gira a la izquierda', street: '1a Calle Poniente', distance_m: 120, at: [-89.2, 13.7] };

  it('solo se muestran los pasos que el mapa puede enfocar', () => {
    assert.deepEqual(focusableSteps([ok]), [ok]);
    assert.deepEqual(focusableSteps([{ ...ok, at: [NaN, 1] }, { ...ok, at: [1] }, { ...ok, instruction: 5 }, null, 7]), []);
  });

  it('una respuesta sin pasos no rompe', () => {
    for (const bad of [undefined, null, 'x', {}, 5]) assert.deepEqual(focusableSteps(bad), []);
  });

  it('la web pide las indicaciones en el idioma de la persona y recuerda el punto al tocar un paso', () => {
    const api = read('src/features/places/lib/placesApi.js');
    assert.match(api.slice(api.indexOf('export async function fetchRoute')), /profile, lang \}/);
    const component = read('src/features/places/components/PlaceRoute.jsx');
    assert.match(component, /onStepFocus\?\.\(step\.at\)/);
  });
});

describe('privacidad de la ubicación en la ruta', () => {
  it('la ubicación va en el cuerpo, ya redondeada, y nunca en la URL', () => {
    const api = read('src/features/places/lib/placesApi.js');
    const from = api.indexOf('export async function fetchRoute');
    // Solo el cuerpo de `fetchRoute`: lo que se declare después no tiene que ver con la ubicación.
    const end = api.slice(from).search(/\r?\n\}\r?\n/);
    assert.ok(end > 0, 'no se encontró el final de fetchRoute');
    const route = api.slice(from, from + end);
    assert.match(route, /const rounded = roundPoint\(from\)/);
    assert.match(route, /api\.post\(/);
    assert.match(route, /from_lat: rounded\.lat, from_lng: rounded\.lng/);
    assert.doesNotMatch(route, /params:|from\.lat|from\.lng/);
  });

  it('la ubicación solo se pide al pulsar el botón, nunca en un efecto', () => {
    const component = read('src/features/places/components/PlaceRoute.jsx');
    // `geo.request()` aparece una sola vez y dentro del manejador del botón (junto al conteo de la visita).
    assert.equal(component.match(/geo\.request/g).length, 1);
    assert.match(component, /onClick=\{\(\) => \{[^}]*trackPlaceVisit\(place\.id, "directions"\);\s*geo\.request\(\);\s*\}\}/);
    assert.doesNotMatch(component, /useEffect\([^)]*geo\.request/s);
    assert.doesNotMatch(component, /localStorage|sessionStorage|indexedDB/);
  });

  it('el componente se oculta sin sesión o sin proveedor de rutas', () => {
    const component = read('src/features/places/components/PlaceRoute.jsx');
    assert.match(component, /if \(!user \|\| !place\.routing_available\) return null/);
  });
});

describe('textos', () => {
  const keys = ['title', 'privacy', 'profile', 'start', 'attribution', 'steps', 'stepsHint', 'noSteps', 'noStreet'];

  it('están en español e inglés', () => {
    for (const [name, dict] of [['es', es], ['en', en]]) {
      const route = dict.places.route;
      for (const key of keys) assert.ok(route[key], `${name}: places.route.${key}`);
      for (const profile of ROUTE_PROFILES) assert.ok(route.profiles[profile], `${name}: perfil ${profile}`);
      for (const unit of ['seconds', 'minutes', 'hours', 'hoursMinutes']) assert.ok(route.dur[unit], `${name}: ${unit}`);
    }
  });

  it('la atribución nombra al proveedor y a OpenStreetMap en los dos idiomas', () => {
    for (const dict of [es, en]) {
      assert.match(dict.places.route.attribution, /OpenRouteService/);
      assert.match(dict.places.route.attribution, /OpenStreetMap/);
    }
  });

  it('el aviso de privacidad dice que se envía a OpenRouteService y que no se guarda', () => {
    assert.match(es.places.route.privacy, /OpenRouteService/);
    assert.match(es.places.route.privacy, /No la guardamos/);
    assert.match(en.places.route.privacy, /OpenRouteService/);
    assert.match(en.places.route.privacy, /do not store/);
  });
});
