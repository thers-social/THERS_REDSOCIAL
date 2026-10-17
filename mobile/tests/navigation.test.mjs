// Lógica pura de la navegación en vivo (ADR-040 §30). `npm test`. Sin teléfono ni GPS: usa una
// ruta sintética en forma de «L» (unos 500 m al este y 500 m al norte) cerca de San Salvador.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/places/navigation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const nav = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const LAT = 13.69;
const LNG = -89.2;
const M_PER_DEG_LAT = 111194.9;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180);
// 500 m al este y luego 500 m al norte.
const CORNER = [LNG + 500 / M_PER_DEG_LNG, LAT];
const END = [CORNER[0], LAT + 500 / M_PER_DEG_LAT];
const LINE = [[LNG, LAT], [LNG + 250 / M_PER_DEG_LNG, LAT], CORNER, [CORNER[0], LAT + 250 / M_PER_DEG_LAT], END];
const index = nav.buildRouteIndex(LINE);
const near = (value, expected, tolerance, label = '') =>
  assert.ok(Math.abs(value - expected) <= tolerance, `${label} esperaba ${expected} ± ${tolerance}, salió ${value}`);

const step = (instruction, at, extra = {}) => ({ instruction, street: null, distance_m: 0, duration_s: 0, type: 0, at, ...extra });
const STEPS = [
  step('Camina hacia el este', LINE[0]),
  step('Gire a la izquierda en 1a Calle Poniente', CORNER),
  step('Llegar a 1a Calle Poniente', END),
];
const starts = nav.stepStarts(index, STEPS);

test('la distancia entre dos puntos es la correcta', () => {
  near(nav.haversineMeters([LNG, LAT], [LNG, LAT + 0.01]), 1111.9, 3);
  assert.equal(nav.haversineMeters([LNG, LAT], [LNG, LAT]), 0);
});

test('el rumbo apunta al este, al norte y al oeste', () => {
  near(nav.bearingDegrees([LNG, LAT], [LNG + 0.01, LAT]), 90, 0.5);
  near(nav.bearingDegrees([LNG, LAT], [LNG, LAT + 0.01]), 0, 0.5);
  near(nav.bearingDegrees([LNG, LAT], [LNG - 0.01, LAT]), 270, 0.5);
});

test('la ruta mide unos 1000 m', () => {
  near(index.total, 1000, 3);
  assert.equal(index.cumulative.length, LINE.length);
  assert.equal(index.cumulative[0], 0);
});

test('un punto sobre la ruta está a 0 m y se sabe cuánto se avanzó', () => {
  const snap = nav.snapToRoute(index, [LNG + 100 / M_PER_DEG_LNG, LAT]);
  near(snap.distanceFromRoute, 0, 0.5);
  near(snap.along, 100, 0.5);
});

test('un punto a un lado se proyecta sobre la ruta y mide su lejanía', () => {
  const snap = nav.snapToRoute(index, [LNG + 300 / M_PER_DEG_LNG, LAT + 30 / M_PER_DEG_LAT]);
  near(snap.distanceFromRoute, 30, 1);
  near(snap.along, 300, 1);
  near(snap.point[1], LAT, 1e-6);
});

test('antes del inicio y después del final se queda en los extremos', () => {
  const before = nav.snapToRoute(index, [LNG - 100 / M_PER_DEG_LNG, LAT]);
  near(before.along, 0, 0.5);
  near(before.distanceFromRoute, 100, 1);
  const after = nav.snapToRoute(index, [END[0], END[1] + 100 / M_PER_DEG_LAT]);
  near(after.along, index.total, 0.5);
});

test('el tramo vertical avanza desde el giro', () => {
  const snap = nav.snapToRoute(index, [CORNER[0], LAT + 200 / M_PER_DEG_LAT]);
  near(snap.along, 700, 1);
});

test('una ruta que pasa dos veces por el mismo sitio se desempata por dónde iba la persona', () => {
  // Ida al este y vuelta por la misma calle.
  const east = [LNG + 400 / M_PER_DEG_LNG, LAT];
  const loop = nav.buildRouteIndex([[LNG, LAT], east, [LNG, LAT]]);
  const here = [LNG + 200 / M_PER_DEG_LNG, LAT];
  near(nav.snapToRoute(loop, here, 10).along, 200, 1);
  near(nav.snapToRoute(loop, here, 790).along, 600, 1);
});

test('el punto a N metros del inicio se encuentra y vuelve a medirse igual', () => {
  for (const along of [0, 123, 500, 640, 1000]) {
    const point = nav.pointAtAlong(index, along);
    near(nav.snapToRoute(index, point).along, along, 1, `along ${along}`);
  }
  assert.deepEqual(nav.pointAtAlong(index, -5), LINE[0]);
  assert.deepEqual(nav.pointAtAlong(index, 99999), END);
});

test('cada paso empieza donde está su maniobra y nunca retrocede', () => {
  assert.equal(starts[0], 0);
  near(starts[1], 500, 1);
  near(starts[2], 1000, 1);
  const weird = nav.stepStarts(index, [step('a', LINE[0]), step('b', END), step('c', CORNER)]);
  assert.ok(weird[2] >= weird[1]);
});

test('se sabe en qué paso va la persona, con un poco de tolerancia antes del giro', () => {
  assert.equal(nav.locateStep(starts, 0), 0);
  assert.equal(nav.locateStep(starts, 100), 0);
  assert.equal(nav.locateStep(starts, 480), 0);
  assert.equal(nav.locateStep(starts, 490), 1);
  assert.equal(nav.locateStep(starts, 700), 1);
  assert.equal(nav.locateStep(starts, 990), 2);
  assert.equal(nav.locateStep([], 10), -1);
});

test('el avance dice cuál es la próxima maniobra, a cuánto está y cuánto falta', () => {
  const route = { distance_m: 1000, duration_s: 600 };
  const early = nav.progressAt(index, STEPS, starts, 100, route);
  assert.equal(early.stepIndex, 0);
  assert.equal(early.next.step.instruction, 'Gire a la izquierda en 1a Calle Poniente');
  near(early.next.distance, 400, 2);
  near(early.remainingMeters, 900, 5);
  near(early.remainingSeconds, 540, 5);
  const late = nav.progressAt(index, STEPS, starts, 900, route);
  assert.equal(late.stepIndex, 1);
  assert.equal(late.next.step.instruction, 'Llegar a 1a Calle Poniente');
  const finished = nav.progressAt(index, STEPS, starts, 1000, route);
  assert.equal(finished.next, null);
  assert.equal(finished.remainingMeters, 0);
});

test('sin pasos no hay próxima maniobra pero sí distancia restante', () => {
  const progress = nav.progressAt(index, [], [], 250, { distance_m: 1000, duration_s: 600 });
  assert.equal(progress.next, null);
  assert.equal(progress.stepIndex, -1);
  near(progress.remainingMeters, 750, 5);
});

test('llegada: cerca del final de la ruta o del destino', () => {
  assert.equal(nav.hasArrived(10, 500), true);
  assert.equal(nav.hasArrived(500, 10), true);
  assert.equal(nav.hasArrived(500, 500), false);
  assert.equal(nav.hasArrived(nav.ARRIVAL_M + 1, nav.ARRIVAL_M + 1), false);
});

// ---------------------------------------------------------------- desvío

const far = (now, extra = {}) => ({ distanceFromRoute: 120, accuracy: 10, now, ...extra });

test('estar sobre la ruta nunca recalcula y reinicia el conteo', () => {
  let state = nav.INITIAL_OFF_ROUTE;
  ({ state } = nav.updateOffRoute(state, far(0)));
  assert.equal(state.strikes, 1);
  const result = nav.updateOffRoute(state, { distanceFromRoute: 5, accuracy: 10, now: 1000 });
  assert.equal(result.reroute, false);
  assert.equal(result.state.strikes, 0);
});

test('hacen falta varias lecturas seguidas fuera de la ruta para recalcular', () => {
  let state = nav.INITIAL_OFF_ROUTE;
  let result = nav.updateOffRoute(state, far(0));
  assert.equal(result.reroute, false);
  result = nav.updateOffRoute(result.state, far(1000));
  assert.equal(result.reroute, false);
  result = nav.updateOffRoute(result.state, far(2000));
  assert.equal(result.reroute, true);
  assert.equal(result.state.strikes, 0);
  assert.equal(result.state.lastRerouteAt, 2000);
});

test('un salto suelto del GPS no recalcula', () => {
  let state = nav.INITIAL_OFF_ROUTE;
  ({ state } = nav.updateOffRoute(state, far(0)));
  ({ state } = nav.updateOffRoute(state, { distanceFromRoute: 3, accuracy: 10, now: 1000 }));
  const result = nav.updateOffRoute(state, far(2000));
  assert.equal(result.reroute, false);
  assert.equal(result.state.strikes, 1);
});

test('una lectura con mala precisión no cuenta', () => {
  const result = nav.updateOffRoute(nav.INITIAL_OFF_ROUTE, far(0, { accuracy: nav.MAX_ACCURACY_M + 1 }));
  assert.equal(result.reroute, false);
  assert.equal(result.state.strikes, 0);
});

test('el umbral sube con el error de la lectura', () => {
  const noisy = nav.updateOffRoute(nav.INITIAL_OFF_ROUTE, { distanceFromRoute: 45, accuracy: 48, now: 0 });
  assert.equal(noisy.state.strikes, 0); // 45 m con 48 m de error no es estar fuera
  const exact = nav.updateOffRoute(nav.INITIAL_OFF_ROUTE, { distanceFromRoute: 45, accuracy: 5, now: 0 });
  assert.equal(exact.state.strikes, 1);
});

test('no se recalcula en bucle: hay un mínimo entre recalculos', () => {
  let state = { strikes: 0, lastRerouteAt: 10_000 };
  let rerouted = false;
  for (let i = 0; i < 6; i += 1) {
    const result = nav.updateOffRoute(state, far(11_000 + i * 1000));
    state = result.state;
    rerouted = rerouted || result.reroute;
  }
  assert.equal(rerouted, false);
  const later = nav.updateOffRoute({ strikes: 5, lastRerouteAt: 10_000 }, far(10_000 + nav.MIN_REROUTE_GAP_MS));
  assert.equal(later.reroute, true);
});

test('una precisión desconocida se trata como buena', () => {
  let state = nav.INITIAL_OFF_ROUTE;
  let result;
  for (let i = 0; i < 3; i += 1) {
    result = nav.updateOffRoute(state, { distanceFromRoute: 90, accuracy: null, now: i * 1000 });
    state = result.state;
  }
  assert.equal(result.reroute, true);
});

// ---------------------------------------------------------------- voz

test('la distancia se dice de forma natural', () => {
  assert.equal(nav.spokenDistance(400), '400 metros');
  assert.equal(nav.spokenDistance(123), '100 metros');
  assert.equal(nav.spokenDistance(137), '150 metros');
  assert.equal(nav.spokenDistance(34), '30 metros');
  assert.equal(nav.spokenDistance(4), '10 metros');
  assert.equal(nav.spokenDistance(1000), '1 kilómetro');
  assert.equal(nav.spokenDistance(1500), '1,5 kilómetros');
  assert.equal(nav.spokenDistance(2400), '2,4 kilómetros');
});

test('en carro avisa a 400, 120 y 30 m, una sola vez cada uno', () => {
  const announced = new Set();
  const say = (distance) => {
    const result = nav.nextAnnouncement('car', 1, STEPS[1], distance, announced);
    if (result) result.keys.forEach((key) => announced.add(key));
    return result?.text ?? null;
  };
  assert.equal(say(900), null);
  assert.equal(say(399), 'En 400 metros, gire a la izquierda en 1a Calle Poniente');
  assert.equal(say(380), null);
  assert.equal(say(119), 'En 100 metros, gire a la izquierda en 1a Calle Poniente');
  assert.equal(say(110), null);
  assert.equal(say(29), 'Gire a la izquierda en 1a Calle Poniente');
  assert.equal(say(5), null);
});

test('si se salta varios umbrales de golpe, solo se dice el más cercano', () => {
  const announced = new Set();
  const result = nav.nextAnnouncement('car', 2, STEPS[1], 100, announced);
  assert.match(result.text, /^En 100 metros/);
  assert.deepEqual(result.keys.sort(), ['2:120', '2:400']);
  result.keys.forEach((key) => announced.add(key));
  assert.equal(nav.nextAnnouncement('car', 2, STEPS[1], 100, announced), null);
});

test('cada paso tiene sus propios umbrales', () => {
  const announced = new Set(['1:400', '1:120', '1:30']);
  assert.equal(nav.nextAnnouncement('car', 1, STEPS[1], 20, announced), null);
  assert.ok(nav.nextAnnouncement('car', 2, STEPS[2], 20, announced));
});

test('a pie y en bici avisan más cerca que en carro', () => {
  assert.equal(nav.nextAnnouncement('walk', 0, STEPS[1], 100, new Set()), null);
  assert.ok(nav.nextAnnouncement('walk', 0, STEPS[1], 55, new Set()));
  assert.equal(nav.nextAnnouncement('bike', 0, STEPS[1], 200, new Set()), null);
  assert.ok(nav.nextAnnouncement('bike', 0, STEPS[1], 110, new Set()));
  assert.ok(nav.ANNOUNCE_AT.car[0] > nav.ANNOUNCE_AT.bike[0] && nav.ANNOUNCE_AT.bike[0] > nav.ANNOUNCE_AT.walk[0]);
});

test('el texto de llegada y el tiempo restante', () => {
  assert.equal(nav.arrivalText('Café Aurora'), 'Llegaste a Café Aurora');
  assert.equal(nav.formatRemaining(30), '30 s');
  assert.equal(nav.formatRemaining(0), '1 s');
  assert.equal(nav.formatRemaining(600), '10 min');
  assert.equal(nav.formatRemaining(3900), '1 h 5 min');
  assert.equal(nav.formatRemaining(NaN), '');
  assert.equal(nav.formatRemaining(-1), '');
});

test('un recorrido completo simulado pasa por todos los pasos, habla y llega', () => {
  const route = { distance_m: 1000, duration_s: 600 };
  const announced = new Set();
  const spoken = [];
  const seen = new Set();
  let hint;
  let arrived = false;
  for (let meters = 0; meters <= 1000 && !arrived; meters += 10) {
    const position = nav.pointAtAlong(index, meters);
    const snap = nav.snapToRoute(index, position, hint);
    hint = snap.along;
    const progress = nav.progressAt(index, STEPS, starts, snap.along, route);
    seen.add(progress.stepIndex);
    if (progress.next) {
      const say = nav.nextAnnouncement('car', progress.stepIndex + 1, progress.next.step, progress.next.distance, announced);
      if (say) {
        say.keys.forEach((key) => announced.add(key));
        spoken.push(say.text);
      }
    }
    arrived = nav.hasArrived(progress.remainingMeters, nav.haversineMeters(position, END));
  }
  assert.ok(arrived);
  // La llegada se detecta a 25 m del final, antes de que el paso «Llegar» cuente como iniciado.
  assert.deepEqual([...seen].sort(), [0, 1]);
  assert.ok(spoken.some((text) => /gire a la izquierda/i.test(text)));
  assert.equal(new Set(spoken).size, spoken.length, 'ninguna frase repetida');
});

test('cada maniobra tiene su flecha y un código desconocido no rompe', () => {
  assert.equal(nav.maneuverArrow(0), '←');
  assert.equal(nav.maneuverArrow(1), '→');
  assert.equal(nav.maneuverArrow(10), '⚑');
  assert.equal(nav.maneuverArrow(6), '↑');
  for (const odd of [null, undefined, 99, -1]) assert.equal(nav.maneuverArrow(odd), '↑');
});
