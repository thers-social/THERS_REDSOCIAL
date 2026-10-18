// Tero en la web (ADR-041): la lógica pura (`teroChat.js`) y que TODAS las claves de
// traducción que la interfaz pide existan en español e inglés. Sin dependencias:
// `node --test`. Espejo de mobile/tests/teroCards.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  canAct,
  cardOutcomeNote,
  cardStateFromError,
  chatBody,
  chatErrorKind,
  checkMessage,
  confirmedNoteKey,
  historyForRequest,
  initialCardState,
  isRetryable,
  MAX_HISTORY_TURNS,
  MAX_MESSAGE_LENGTH,
  moodForOutcome,
  normalizeError,
  parseCards,
  parseChatResponse,
  plainText,
  screenFor,
} from '../src/features/tero/lib/teroChat.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const locales = {
  es: JSON.parse(read('src/shared/i18n/locales/es.json')).tero,
  en: JSON.parse(read('src/shared/i18n/locales/en.json')).tero,
};

const FUTURE = new Date(Date.now() + 10 * 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();
const card = (over = {}) => ({ id: 'c1', kind: 'follow_user', summary: 'Seguir a Ana', expiresAt: FUTURE, ...over });
const msg = (role, text, extra = {}) => ({ id: `${role}-${text}`, role, text, ...(role === 'user' ? { status: 'sent' } : {}), ...extra });

describe('mensaje de la persona', () => {
  it('rechaza vacío y demasiado largo, y recorta espacios', () => {
    assert.deepEqual(checkMessage('   '), { ok: false, error: 'empty' });
    assert.deepEqual(checkMessage(null), { ok: false, error: 'empty' });
    assert.deepEqual(checkMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1)), { ok: false, error: 'tooLong' });
    assert.deepEqual(checkMessage('  hola  '), { ok: true, text: 'hola' });
    assert.equal(checkMessage('x'.repeat(MAX_MESSAGE_LENGTH)).ok, true);
  });
});

describe('contexto', () => {
  it('usa solo el primer segmento de la ruta, nunca ids', () => {
    assert.equal(screenFor('/'), 'home');
    assert.equal(screenFor('/places/abc-123/edit'), 'places');
    assert.equal(screenFor('/Profile/ANA'), 'profile');
    assert.equal(screenFor('/@@@'), 'home');
    assert.equal(screenFor(undefined), 'home');
    // El servidor acepta [a-z0-9_/-]{1,40}.
    assert.match(screenFor('/' + 'a'.repeat(100)), /^[a-z0-9_-]{1,40}$/);
  });

  it('arma el cuerpo con historial solo si lo hay', () => {
    assert.deepEqual(chatBody('hola', { screen: 'home' }, []), { message: 'hola', context: { screen: 'home' } });
    const body = chatBody('hola', { screen: 'post', entityType: 'post', entityId: 'p1' }, [{ role: 'user', content: 'a' }]);
    assert.deepEqual(body.context, { screen: 'post', entity_type: 'post', entity_id: 'p1' });
    assert.equal(body.history.length, 1);
  });
});

describe('historial para el servidor', () => {
  it('incluye solo lo entregado y anterior al mensaje actual', () => {
    const messages = [
      msg('user', 'hola'),
      msg('tero', '¡hola!'),
      msg('user', 'falló', { status: 'failed' }),
      msg('user', 'en camino', { status: 'sending' }),
      msg('user', 'actual', { status: 'sending' }),
    ];
    const history = historyForRequest(messages, 'user-actual');
    assert.deepEqual(history, [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: '¡hola!' },
    ]);
  });

  it('empieza siempre con la persona y respeta el tope de turnos', () => {
    const many = [];
    for (let i = 0; i < 20; i += 1) many.push(msg(i % 2 ? 'tero' : 'user', `m${i}`));
    const history = historyForRequest(many, 'ninguno');
    assert.ok(history.length <= MAX_HISTORY_TURNS);
    assert.equal(history[0].role, 'user');
    assert.deepEqual(historyForRequest([msg('tero', 'solo tero')], 'x'), []);
  });

  it('dice cómo terminó cada tarjeta, para que el modelo no la repita ni la corrija', () => {
    const c = card();
    const messages = [msg('user', 'sígueme a ana'), msg('tero', 'Te preparé esto', { cards: [c] }), msg('user', 'gracias')];
    const confirmed = historyForRequest(messages, 'nada', { c1: { status: 'confirmed' } });
    assert.match(confirmed[1].content, /YA SE HIZO/);
    const cancelled = historyForRequest(messages, 'nada', { c1: { status: 'cancelled' } });
    assert.match(cancelled[1].content, /no se hizo nada/);
    assert.match(cardOutcomeNote(card({ expiresAt: PAST }), undefined), /venció/);
    assert.match(cardOutcomeNote(c, undefined), /pendiente/);
  });

  it('recorta cada turno al tope del servidor', () => {
    const long = msg('tero', 'x'.repeat(5000), { cards: [card()] });
    const history = historyForRequest([msg('user', 'a'), long], 'nada');
    assert.ok(history[1].content.length <= MAX_MESSAGE_LENGTH);
  });
});

describe('respuesta del servidor', () => {
  it('valida la forma de las tarjetas y descarta las malas', () => {
    const good = { id: 'a', kind: 'update_profile', summary: 'Cambiar bio', expires_at: FUTURE };
    const cards = parseCards([
      good,
      { ...good, id: '' },
      { ...good, kind: 'borrar_cuenta' },
      { ...good, summary: '  ' },
      { ...good, expires_at: 'no-es-fecha' },
      'texto',
      null,
    ]);
    assert.deepEqual(cards, [{ id: 'a', kind: 'update_profile', summary: 'Cambiar bio', expiresAt: FUTURE }]);
    assert.deepEqual(parseCards('x'), []);
  });

  it('exige texto y quita el Markdown', () => {
    assert.throws(() => parseChatResponse({}));
    assert.throws(() => parseChatResponse({ reply: '   ' }));
    assert.throws(() => parseChatResponse(null));
    const reply = parseChatResponse({ reply: '**Hola** `x`\n# Título\n* uno', source: 'ai', confirmation_cards: [] });
    assert.equal(reply.text, 'Hola x\nTítulo\n- uno');
    assert.equal(reply.mood, 'speaking');
  });

  it('duerme a Tero cuando el servicio está apagado o sin presupuesto', () => {
    assert.equal(parseChatResponse({ reply: 'x', source: 'disabled' }).mood, 'sleeping');
    assert.equal(parseChatResponse({ reply: 'x', source: 'budget' }).mood, 'sleeping');
    assert.equal(parseChatResponse({ reply: 'x', source: 'inventada' }).source, 'ai');
  });

  it('plainText solo toca el formato', () => {
    assert.equal(plainText('a * b'), 'a * b');
    assert.equal(plainText('__fuerte__'), 'fuerte');
  });
});

describe('tarjetas', () => {
  it('una tarjeta vencida nace vencida y no se puede accionar', () => {
    assert.equal(initialCardState(card({ expiresAt: PAST })).status, 'expired');
    assert.equal(canAct(initialCardState(card({ expiresAt: PAST })), card({ expiresAt: PAST })), false);
  });

  it('solo se actúa sobre una pendiente vigente', () => {
    const c = card();
    assert.equal(canAct({ status: 'pending' }, c), true);
    for (const status of ['confirming', 'cancelling', 'confirmed', 'cancelled', 'failed', 'unavailable', 'expired']) {
      assert.equal(canAct({ status }, c), false, status);
    }
    assert.equal(canAct({ status: 'pending' }, card({ expiresAt: PAST })), false);
  });

  it('traduce los errores a estados; los reintentables siguen pendientes', () => {
    assert.equal(cardStateFromError({ isNetworkError: true, status: 0 }).status, 'pending');
    assert.equal(cardStateFromError({ status: 429 }).status, 'pending');
    assert.equal(cardStateFromError({ status: 404 }).status, 'unavailable');
    assert.equal(cardStateFromError({ status: 503 }).status, 'unavailable');
    assert.equal(cardStateFromError({ status: 500 }).status, 'pending');
    assert.equal(cardStateFromError({ status: 409, body: { code: 'action_expired' } }).status, 'expired');
    assert.equal(cardStateFromError({ status: 409, body: { code: 'action_cancelled' } }).status, 'cancelled');
    assert.equal(cardStateFromError({ status: 409, body: { code: 'action_confirmed' } }).status, 'confirmed');
    assert.equal(cardStateFromError({ status: 409, body: { code: 'otra' } }).status, 'failed');
  });

  it('el texto de éxito sale de lo que el servidor devolvió', () => {
    assert.equal(confirmedNoteKey(null), 'done');
    assert.equal(confirmedNoteKey({ already_confirmed: true }), 'alreadyConfirmed');
    assert.equal(confirmedNoteKey({ result: { updated: ['bio'] } }), 'profileUpdated');
    assert.equal(confirmedNoteKey({ result: { follow_status: 'pending' } }), 'requestSent');
    assert.equal(confirmedNoteKey({ result: { follow_status: 'accepted' } }), 'nowFollowing');
    assert.equal(confirmedNoteKey({ result: { follow_status: null } }), 'unfollowed');
  });

  it('Tero celebra lo que se hizo y se encoge con calma si falló', () => {
    assert.equal(moodForOutcome('confirmed'), 'happy');
    assert.equal(moodForOutcome('failed'), 'error');
    for (const s of ['cancelled', 'expired', 'unavailable', 'pending']) assert.equal(moodForOutcome(s), null);
  });
});

describe('errores del chat', () => {
  it('normaliza errores de axios', () => {
    assert.deepEqual(normalizeError({ response: { status: 503, data: { code: 'x' } } }), {
      status: 503, isNetworkError: false, body: { code: 'x' },
    });
    assert.equal(normalizeError(new Error('Network Error')).isNetworkError, true);
  });

  it('elige el mensaje sin mostrar nunca texto técnico', () => {
    assert.equal(chatErrorKind({ isNetworkError: true }), 'offline');
    assert.equal(chatErrorKind({ status: 429 }), 'rateLimited');
    assert.equal(chatErrorKind({ status: 503, body: { code: 'tero_disabled' } }), 'disabled');
    assert.equal(chatErrorKind({ status: 503 }), 'unavailable');
    assert.equal(chatErrorKind({ status: 400 }), 'badRequest');
    assert.equal(chatErrorKind({ status: 500 }), 'generic');
  });

  it('solo reintenta si falló la red o el servidor, no el texto', () => {
    assert.equal(isRetryable({ isNetworkError: true }), true);
    assert.equal(isRetryable({ status: 429 }), true);
    assert.equal(isRetryable({ status: 503 }), true);
    assert.equal(isRetryable({ status: 400 }), false);
  });
});

describe('traducciones', () => {
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

  it('español e inglés tienen exactamente las mismas claves', () => {
    assert.deepEqual(flatten(locales.es).sort(), flatten(locales.en).sort());
  });

  it('ninguna está vacía', () => {
    for (const lang of ['es', 'en']) for (const key of flatten(locales[lang])) {
      const value = key.split('.').reduce((o, p) => o[p], locales[lang]);
      assert.ok(value.trim(), `${lang}.${key}`);
    }
  });

  it('existen todas las claves que la lógica puede pedir', () => {
    const keys = new Set(flatten(locales.es));
    const notes = [
      ...['offline', 'rateLimited', 'gone', 'alreadyCancelled', 'alreadyConfirmed', 'failed', 'unavailable', 'retry', 'expired'].map((n) => n),
      ...['done', 'profileUpdated', 'requestSent', 'nowFollowing', 'unfollowed', 'cancelled'],
    ];
    for (const note of notes) assert.ok(keys.has(`card.notes.${note}`), `card.notes.${note}`);
    for (const kind of ['offline', 'rateLimited', 'disabled', 'unavailable', 'badRequest', 'generic']) {
      assert.ok(keys.has(`errors.${kind}`), `errors.${kind}`);
    }
    for (const status of ['confirmed', 'cancelled', 'expired', 'unavailable', 'failed']) {
      assert.ok(keys.has(`card.status.${status}`), `card.status.${status}`);
    }
    for (const e of ['empty', 'tooLong']) assert.ok(keys.has(`input.${e}`));
  });

  it('cada nota que emiten las funciones existe', () => {
    const keys = new Set(flatten(locales.es));
    const emitted = [
      cardStateFromError({ isNetworkError: true }).note,
      cardStateFromError({ status: 429 }).note,
      cardStateFromError({ status: 404 }).note,
      cardStateFromError({ status: 503 }).note,
      cardStateFromError({ status: 500 }).note,
      cardStateFromError({ status: 409 }).note,
      cardStateFromError({ status: 409, body: { code: 'action_expired' } }).note,
      cardStateFromError({ status: 409, body: { code: 'action_cancelled' } }).note,
      cardStateFromError({ status: 409, body: { code: 'action_confirmed' } }).note,
      initialCardState(card({ expiresAt: PAST })).note,
    ];
    for (const note of emitted) assert.ok(keys.has(`card.notes.${note}`), note);
  });
});

describe('el interruptor', () => {
  it('Tero está encendido salvo que VITE_TERO_ENABLED valga exactamente "false"', () => {
    const config = read('src/features/tero/config.js');
    assert.match(config, /VITE_TERO_ENABLED !== "false"/);
  });

  it('el shell solo monta a Tero con el interruptor encendido y lo descarga bajo demanda', () => {
    const shell = read('src/app/layout/AppShell.jsx');
    assert.match(shell, /TERO_ENABLED && \(/);
    assert.match(shell, /lazy\(\(\) => import\("@features\/tero\/components\/TeroLauncher"\)\)/);
  });
});
