// Avisos de THERS Places en la web (ADR-040, fase 12): cómo se traducen a lo que muestra la
// bandeja. Sin dependencias: `node --test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// `mapNotification.js` importa `./formatRelativeTime` sin extensión (estilo Vite), que Node no
// resuelve: se carga el archivo real sustituyendo solo esa importación por un valor fijo.
const source = readFileSync(new URL('../src/features/feed/lib/mapNotification.js', import.meta.url), 'utf8')
  .replace(/import \{ formatRelativeTime \} from "\.\/formatRelativeTime";/, 'const formatRelativeTime = () => "ahora";');
assert.ok(!source.includes('./formatRelativeTime'), 'la importación debía sustituirse');
const { isPlaceNotice, mapNotification } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const base = { id: 'n1', read: false, created_at: new Date().toISOString(), post_id: null };
const place = { id: 'p1', name: 'Café Aurora' };
const person = { id: 'u1', name: 'Beto', username: 'beto', avatar_url: 'http://x/a.png' };

describe('avisos de Places', () => {
  it('el lugar es el protagonista y no hay foto', () => {
    const n = mapNotification({ ...base, type: 'place_reservation_new', actor: person, place, detail: null });
    assert.equal(n.actor, 'Café Aurora');
    assert.equal(n.photo, null);
    assert.match(n.detail, /reserva/);
    assert.equal(n.important, true);
  });

  it('un reclamo decidido llega sin actor y no rompe', () => {
    const approved = mapNotification({ ...base, type: 'place_claim_decided', actor: null, place, detail: 'approved' });
    const rejected = mapNotification({ ...base, type: 'place_claim_decided', actor: null, place, detail: 'rejected' });
    assert.match(approved.detail, /aprobó/);
    assert.match(rejected.detail, /rechazó/);
    assert.equal(approved.actor, 'Café Aurora');
  });

  it('el estado cambia el texto y uno desconocido cae en un texto genérico', () => {
    const text = (type, detail) => mapNotification({ ...base, type, actor: person, place, detail }).detail;
    assert.match(text('place_reservation_decided', 'confirmed'), /confirmó/);
    assert.match(text('place_reservation_decided', 'declined'), /rechazó/);
    assert.match(text('place_quote_decided', 'accepted'), /aceptó/);
    assert.match(text('place_quote_decided', 'rejected'), /rechazó/);
    assert.ok(text('place_reservation_decided', 'otra-cosa'));
    assert.ok(text('place_quote_decided', null));
  });

  it('sin lugar usa un nombre neutro en vez de fallar', () => {
    const n = mapNotification({ ...base, type: 'place_plan_invite', actor: person, place: null, detail: null });
    assert.equal(n.actor, 'Un lugar');
  });

  it('las reseñas respondidas y los planes no son «importantes»', () => {
    for (const type of ['place_review_reply', 'place_plan_invite', 'place_reservation_cancelled']) {
      assert.equal(mapNotification({ ...base, type, actor: person, place, detail: null }).important, false, type);
    }
  });

  it('los avisos de siempre no cambian', () => {
    const n = mapNotification({ ...base, type: 'like', actor: person, place: null, detail: null });
    assert.equal(n.actor, 'Beto');
    assert.equal(n.photo, 'http://x/a.png');
    assert.equal(n.detail, 'reaccionó a tu Cápsula');
    assert.equal(isPlaceNotice('like'), false);
    assert.equal(isPlaceNotice('place_quote_new'), true);
    assert.equal(isPlaceNotice('constructor'), false);
  });
});
