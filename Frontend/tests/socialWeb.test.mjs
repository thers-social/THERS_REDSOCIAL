// Perfil ajeno, seguidores/seguidos, Explorar y sugerencias en la web (ADR-049, ADR-050, ADR-052).
// Pruebas de contrato sobre el código fuente: rutas, endpoints y conexión de las pantallas. `node --test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

describe('cliente', () => {
  const api = read('src/features/feed/lib/socialApi.js');

  it('usa los endpoints documentados en API_CONTRACT §4.41 y §4.42', () => {
    for (const fragment of [
      '`/users/${userId}`',
      'params: { author_id: userId }',
      '`/users/${userId}/${kind}`',
      '"/explore"',
      '"/users/suggestions"',
      '`/users/${userId}/follow`',
    ]) {
      assert.ok(api.includes(fragment), `falta ${fragment}`);
    }
  });

  it('el texto del botón de seguir distingue los tres estados', () => {
    assert.match(api, /"Siguiendo"/);
    assert.match(api, /"Solicitado"/);
    assert.match(api, /isPrivate \? "Solicitar" : "Seguir"/);
  });
});

describe('pantallas', () => {
  it('las rutas /user/:userId y /explore están registradas', () => {
    const router = read('src/app/router/router.jsx');
    assert.match(router, /path="\/user\/:userId"/);
    assert.match(router, /path="\/explore"/);
  });

  it('foto y nombre de una publicación llevan al perfil del autor', () => {
    const card = read('src/features/feed/components/CapsuleCard.jsx');
    assert.match(card, /`\/user\/\$\{capsule\.author\.id\}`/);
  });

  it('los contadores del perfil propio abren la lista y hay botón de sugerencias', () => {
    const identity = read('src/features/feed/components/ProfileIdentity.jsx');
    assert.match(identity, /onOpenConnections\?\.\("followers"\)/);
    assert.match(identity, /onOpenConnections\?\.\("following"\)/);
    assert.match(identity, /aria-label="Descubrir personas"/);
    const profile = read('src/features/feed/pages/Profile.jsx');
    assert.match(profile, /<SuggestedBar/);
    assert.match(profile, /<ConnectionsDialog/);
  });

  it('el AppShell no mezcla las publicaciones adoptadas con el feed', () => {
    const shell = read('src/app/layout/AppShell.jsx');
    assert.match(shell, /capsules: feedCapsules/);
    assert.match(shell, /allCapsules: capsules/);
    assert.match(shell, /adoptCapsules,/);
  });
});

describe('lugares y Tero', () => {
  it('cada reserva ofrece el PDF y avisa del horario por defecto', () => {
    const reservations = read('src/features/places/components/PlaceReservations.jsx');
    assert.match(reservations, /downloadReservationPdf\(item\.id\)/);
    assert.match(reservations, /data\.default_hours/);
    assert.match(read('src/features/places/lib/placesApi.js'), /`\/reservations\/\$\{reservationId\}\/pdf`/);
  });

  it('el Cotizador sigue visible aunque el lugar no tenga lista de precios', () => {
    const quote = read('src/features/places/components/PlaceQuote.jsx');
    assert.match(quote, /places\.quotes\.empty/);
  });

  it('Tero conoce la tarjeta de reservar y tiene atajos de lugares', () => {
    assert.match(read('src/features/tero/lib/teroChat.js'), /"reserve_place"/);
    const panel = read('src/features/tero/components/TeroChatPanel.jsx');
    assert.match(panel, /"recommendPlace"/);
    assert.match(panel, /"reservePlace"/);
  });

  it('español e inglés tienen los textos nuevos', () => {
    for (const lang of ['es', 'en']) {
      const dict = JSON.parse(read(`src/shared/i18n/locales/${lang}.json`));
      assert.ok(dict.places.reservations.pdf && dict.places.reservations.defaultHours);
      assert.ok(dict.places.quotes.empty);
      assert.ok(dict.tero.suggestions.recommendPlace && dict.tero.suggestions.reservePlace);
    }
  });
});
