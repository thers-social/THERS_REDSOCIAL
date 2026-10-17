// Conexión de Tero con el servidor y tarjetas de confirmación (ADR-041, fases 4 a 6): lo que se
// envía, cómo se valida lo que llega y cómo queda cada tarjeta ante cada resultado.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  EXPIRED_NOTE,
  MAX_HISTORY_TURNS,
  canAct,
  cardStateFromError,
  chatBody,
  chatErrorMessage,
  confirmedNote,
  historyForRequest,
  initialCardState,
  isCardExpired,
  isRetryable,
  parseCards,
  parseChatResponse,
} from '../src/features/tero/lib/teroCards.ts';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const card = (over = {}) => ({
  id: 'a1',
  kind: 'follow_user',
  summary: 'Seguir a @beto',
  expiresAt: '2026-10-17T12:10:00.000Z',
  ...over,
});
const msg = (role, text, extra = {}) => ({
  id: `m:${text}`,
  role,
  text,
  createdAt: '2026-10-17T11:00:00.000Z',
  ...(role === 'user' ? { status: 'sent' } : {}),
  ...extra,
});

describe('historial que se envía al servidor', () => {
  it('manda solo lo anterior al mensaje actual, con los roles del servidor', () => {
    const messages = [msg('user', 'hola'), msg('tero', '¡hola!'), msg('user', 'actual')];
    assert.deepEqual(historyForRequest(messages, 'm:actual'), [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: '¡hola!' },
    ]);
  });

  it('omite respuestas de ejemplo, mensajes fallidos y mensajes aún en camino', () => {
    const messages = [
      msg('user', 'a'),
      msg('tero', 'ejemplo', { isMock: true }),
      msg('user', 'fallido', { status: 'failed' }),
      msg('user', 'enviando', { status: 'sending' }),
      msg('tero', 'real'),
      msg('user', 'actual'),
    ];
    assert.deepEqual(
      historyForRequest(messages, 'm:actual').map((t) => t.content),
      ['a', 'real'],
    );
  });

  it('la lista siempre empieza con la persona (el servidor lo exige)', () => {
    const messages = [msg('tero', 'saludo'), msg('user', 'a'), msg('tero', 'b'), msg('user', 'actual')];
    const history = historyForRequest(messages, 'm:actual');
    assert.equal(history[0].role, 'user');
    assert.deepEqual(historyForRequest([msg('tero', 'solo tero'), msg('user', 'x')], 'm:x'), []);
  });

  it('conserva solo los últimos turnos permitidos', () => {
    const many = [];
    for (let i = 0; i < 30; i += 1) many.push(msg(i % 2 === 0 ? 'user' : 'tero', `t${i}`));
    many.push(msg('user', 'actual'));
    const history = historyForRequest(many, 'm:actual');
    assert.ok(history.length <= MAX_HISTORY_TURNS);
    assert.equal(history[0].role, 'user');
  });

  it('recorta cada turno al tope del servidor: una respuesta larga de Tero no lo rompe', () => {
    const long = 'x'.repeat(4000);
    const history = historyForRequest([msg('user', 'q'), msg('tero', long), msg('user', 'actual')], 'm:actual');
    assert.equal(history[1].content.length, 1000);
  });

  it('reintentar un mensaje antiguo no arrastra lo que vino después', () => {
    const messages = [msg('user', 'a'), msg('tero', 'b'), msg('user', 'c'), msg('tero', 'd')];
    assert.deepEqual(
      historyForRequest(messages, 'm:c').map((t) => t.content),
      ['a', 'b'],
    );
  });
});

describe('cuerpo de la petición', () => {
  it('sin historial ni entidad solo lleva el mensaje y la pantalla', () => {
    assert.deepEqual(chatBody('hola', { screen: 'tero' }, []), {
      message: 'hola',
      context: { screen: 'tero' },
    });
  });

  it('con una publicación manda su tipo e id con los nombres del servidor', () => {
    const body = chatBody('resume', { screen: 'post', entityType: 'post', entityId: 'p-1' }, [
      { role: 'user', content: 'x' },
    ]);
    assert.deepEqual(body.context, { screen: 'post', entity_type: 'post', entity_id: 'p-1' });
    assert.equal(body.history.length, 1);
  });

  it('nunca incluye una identidad: la persona la fija la sesión', () => {
    const body = chatBody('hola', { screen: 'tero' }, []);
    assert.equal(JSON.stringify(body).includes('user_id'), false);
  });
});

describe('respuesta del servidor', () => {
  it('lee el texto, el origen y las tarjetas', () => {
    const reply = parseChatResponse({
      reply: 'Preparé la acción.',
      source: 'ai',
      confirmation_cards: [
        { id: 'a1', kind: 'follow_user', summary: 'Seguir a @beto', expires_at: '2026-10-17T12:10:00Z' },
      ],
    });
    assert.equal(reply.text, 'Preparé la acción.');
    assert.equal(reply.isMock, false);
    assert.equal(reply.source, 'ai');
    assert.deepEqual(reply.cards, [
      { id: 'a1', kind: 'follow_user', summary: 'Seguir a @beto', expiresAt: '2026-10-17T12:10:00Z' },
    ]);
  });

  it('sin tarjetas devuelve una lista vacía, no undefined', () => {
    assert.deepEqual(parseChatResponse({ reply: 'hola', source: 'ai' }).cards, []);
  });

  it('un texto fijo del sistema deja a Tero «dormido»', () => {
    assert.equal(parseChatResponse({ reply: 'x', source: 'budget' }).mood, 'sleeping');
    assert.equal(parseChatResponse({ reply: 'x', source: 'disabled' }).mood, 'sleeping');
    assert.equal(parseChatResponse({ reply: 'x', source: 'ai' }).mood, 'speaking');
  });

  it('un origen desconocido se trata como respuesta normal', () => {
    assert.equal(parseChatResponse({ reply: 'x', source: 'otro' }).source, 'ai');
  });

  it('una respuesta sin texto cuenta como fallo', () => {
    for (const bad of [null, [], 'hola', {}, { reply: '' }, { reply: '  ' }, { reply: 5 }]) {
      assert.throws(() => parseChatResponse(bad));
    }
  });

  it('descarta las tarjetas mal formadas y no inventa campos', () => {
    const good = { id: 'a1', kind: 'update_profile', summary: 'Cambiar tu nombre', expires_at: '2026-10-17T12:10:00Z' };
    const cards = parseCards([
      good,
      null,
      'texto',
      { ...good, id: '' },
      { ...good, kind: 'delete_account' },
      { ...good, summary: '   ' },
      { ...good, expires_at: 'no es fecha' },
      { ...good, id: 7 },
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, 'a1');
    assert.deepEqual(parseCards('x'), []);
    assert.deepEqual(parseCards(undefined), []);
  });

  it('solo acepta los tres tipos de acción que existen', () => {
    for (const kind of ['follow_user', 'unfollow_user', 'update_profile']) {
      assert.equal(parseCards([{ id: 'a', kind, summary: 's', expires_at: '2026-10-17T12:10:00Z' }]).length, 1);
    }
    assert.equal(
      parseCards([{ id: 'a', kind: 'block_user', summary: 's', expires_at: '2026-10-17T12:10:00Z' }]).length,
      0,
    );
  });
});

describe('vencimiento y botones', () => {
  it('una tarjeta vigente está pendiente y se puede actuar', () => {
    assert.deepEqual(initialCardState(card(), NOW), { status: 'pending' });
    assert.equal(canAct({ status: 'pending' }, card(), NOW), true);
    assert.equal(isCardExpired(card(), NOW), false);
  });

  it('una vencida nace vencida y no se puede actuar', () => {
    const old = card({ expiresAt: '2026-10-17T11:59:00.000Z' });
    assert.equal(isCardExpired(old, NOW), true);
    assert.deepEqual(initialCardState(old, NOW), { status: 'expired', note: EXPIRED_NOTE });
    assert.equal(canAct({ status: 'pending' }, old, NOW), false);
  });

  it('justo en el instante de vencer ya no se puede', () => {
    assert.equal(isCardExpired(card({ expiresAt: new Date(NOW).toISOString() }), NOW), true);
  });

  it('solo se actúa desde «pendiente»: ni en camino ni resuelta', () => {
    for (const status of ['confirming', 'cancelling', 'confirmed', 'cancelled', 'expired', 'failed', 'unavailable']) {
      assert.equal(canAct({ status }, card(), NOW), false, status);
    }
  });
});

describe('errores al confirmar o cancelar', () => {
  const api = (status, code, extra = {}) => ({ status, body: code ? { code } : {}, ...extra });

  it('sin red o con límite de intentos la tarjeta sigue pendiente para reintentar', () => {
    assert.equal(cardStateFromError(api(0, null, { isNetworkError: true })).status, 'pending');
    assert.equal(cardStateFromError(api(429)).status, 'pending');
    assert.equal(cardStateFromError(api(500)).status, 'pending');
  });

  it('los errores definitivos cierran la tarjeta con su motivo', () => {
    assert.equal(cardStateFromError(api(404)).status, 'unavailable');
    assert.equal(cardStateFromError(api(409, 'action_expired')).status, 'expired');
    assert.equal(cardStateFromError(api(409, 'action_cancelled')).status, 'cancelled');
    assert.equal(cardStateFromError(api(409, 'action_confirmed')).status, 'confirmed');
    assert.equal(cardStateFromError(api(409, 'action_failed')).status, 'failed');
    assert.equal(cardStateFromError(api(409)).status, 'failed');
    assert.equal(cardStateFromError(api(503, 'tero_actions_disabled')).status, 'unavailable');
  });

  it('cada resultado trae un texto para la persona', () => {
    for (const error of [api(404), api(409, 'action_expired'), api(429), api(503), api(0, null, { isNetworkError: true })]) {
      assert.ok(cardStateFromError(error).note);
    }
  });

  it('un error que no es un objeto no rompe', () => {
    for (const weird of [null, undefined, 'x', 5, new Error('boom')]) {
      assert.equal(typeof cardStateFromError(weird).status, 'string');
    }
  });
});

describe('texto tras confirmar', () => {
  it('describe lo que realmente pasó, según el resultado del servidor', () => {
    assert.equal(confirmedNote({ status: 'confirmed', result: { follow_status: 'accepted' } }), 'Listo, ahora lo sigues.');
    assert.equal(confirmedNote({ status: 'confirmed', result: { follow_status: 'pending' } }), 'Listo, enviaste la solicitud.');
    assert.equal(confirmedNote({ status: 'confirmed', result: { follow_status: null } }), 'Listo, ya no lo sigues.');
    assert.equal(confirmedNote({ status: 'confirmed', result: { updated: ['bio'] } }), 'Listo, tu perfil se actualizó.');
  });

  it('una confirmación repetida no dice que acaba de hacerse', () => {
    assert.equal(confirmedNote({ status: 'confirmed', already_confirmed: true }), 'Ya estaba confirmada.');
  });

  it('una respuesta rara no rompe', () => {
    assert.equal(confirmedNote(null), 'Listo.');
    assert.equal(confirmedNote({}), 'Listo.');
  });
});

describe('errores del chat', () => {
  it('el mensaje es claro y nunca técnico', () => {
    assert.match(chatErrorMessage({ status: 0, isNetworkError: true }), /conexión/i);
    assert.match(chatErrorMessage({ status: 429 }), /espera/i);
    assert.match(chatErrorMessage({ status: 503, body: { code: 'tero_disabled' } }), /no está disponible/i);
    assert.match(chatErrorMessage({ status: 503 }), /más tarde/i);
    assert.match(chatErrorMessage({ status: 500 }), /reintentar/i);
    assert.match(chatErrorMessage(new Error('Network request failed')), /reintentar/i);
  });

  it('solo se ofrece reintentar cuando tiene sentido', () => {
    assert.equal(isRetryable({ status: 0, isNetworkError: true }), true);
    assert.equal(isRetryable({ status: 503 }), true);
    assert.equal(isRetryable({ status: 429 }), true);
    assert.equal(isRetryable({ status: 400 }), false);
  });
});

describe('reglas del cliente que no deben romperse', () => {
  const clientSource = readFileSync(new URL('../src/features/tero/lib/teroClient.ts', import.meta.url), 'utf8');
  const chatSource = readFileSync(new URL('../app/tero/chat.tsx', import.meta.url), 'utf8');

  it('confirmar y cancelar no mandan cuerpo: la identidad es la sesión', () => {
    const confirm = clientSource.slice(clientSource.indexOf('confirmAction(actionId, signal) {'));
    assert.equal(/confirmAction\(actionId, signal\) \{[\s\S]*?\n  \},/.exec(confirm)[0].includes('body'), false);
  });

  it('el interruptor del servidor real está apagado por defecto', () => {
    const config = readFileSync(new URL('../src/features/tero/config.ts', import.meta.url), 'utf8');
    assert.match(config, /EXPO_PUBLIC_TERO_LIVE === 'true'/);
    assert.match(clientSource, /TERO_LIVE \? liveTeroClient : mockTeroClient/);
  });

  it('la pantalla solo ejecuta una acción desde el botón «Confirmar»', () => {
    // `confirmAction` se llama en un único lugar y nunca desde la llegada de una respuesta.
    assert.equal(chatSource.split('teroClient.confirmAction(').length - 1, 1);
    assert.match(chatSource, /onConfirm=\{\(\) => void confirmCard\(card\)\}/);
    const deliver = chatSource.slice(chatSource.indexOf('const deliver'), chatSource.indexOf('const send ='));
    assert.equal(deliver.includes('confirmAction'), false);
  });
});
