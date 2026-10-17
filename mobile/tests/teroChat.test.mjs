// Pruebas de la lógica pura del chat de Tero (fase 1, sin IA): validación,
// extractos y respuestas de ejemplo que nunca inventan contenido.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkMessage,
  excerpt,
  makeMessage,
  MAX_TERO_MESSAGE_LENGTH,
  mockReply,
  statusLabel,
  withStatus,
} from '../src/features/tero/lib/teroChat.ts';

describe('estados de los mensajes propios', () => {
  it('withStatus cambia solo el mensaje indicado y no muta la lista', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    const a = { ...makeMessage('user', 'a', now), status: 'sending' };
    const b = makeMessage('tero', 'b', now);
    const list = [a, b];
    const next = withStatus(list, a.id, 'failed');
    assert.equal(next[0].status, 'failed');
    assert.equal(next[1], b);
    assert.equal(list[0].status, 'sending');
  });

  it('cada estado tiene su texto; sin estado, ninguno', () => {
    assert.equal(statusLabel('sending'), 'Enviando…');
    assert.equal(statusLabel('sent'), 'Enviado');
    assert.equal(statusLabel('failed'), 'No se pudo enviar');
    assert.equal(statusLabel(undefined), null);
  });
});

describe('checkMessage', () => {
  it('rechaza vacío y solo espacios', () => {
    assert.equal(checkMessage('').ok, false);
    assert.equal(checkMessage('   \n ').ok, false);
  });

  it('recorta y acepta hasta el máximo', () => {
    assert.deepEqual(checkMessage('  hola  '), { ok: true, text: 'hola' });
    assert.equal(checkMessage('a'.repeat(MAX_TERO_MESSAGE_LENGTH)).ok, true);
    assert.equal(checkMessage('a'.repeat(MAX_TERO_MESSAGE_LENGTH + 1)).ok, false);
  });
});

describe('makeMessage', () => {
  it('genera ids distintos aun en el mismo instante', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    assert.notEqual(makeMessage('user', 'a', now).id, makeMessage('user', 'a', now).id);
  });
});

describe('excerpt', () => {
  it('deja intacto un texto corto y normaliza espacios', () => {
    assert.equal(excerpt('hola   mundo\n'), 'hola mundo');
  });

  it('corta en un límite de palabra y agrega puntos suspensivos', () => {
    const result = excerpt('una frase bastante larga para cortar', 20);
    assert.ok(result.endsWith('…'));
    assert.ok(result.length <= 21);
    assert.ok(!result.includes('cor…'));
  });
});

describe('mockReply', () => {
  it('siempre se declara como ejemplo', () => {
    const reply = mockReply('¿qué hay de nuevo?', { screen: 'tero' });
    assert.equal(reply.isMock, true);
    assert.match(reply.text, /respuesta de ejemplo/);
  });

  it('el resumen de una publicación es un extracto literal de su texto', () => {
    const reply = mockReply('Resume', { screen: 'post', entityType: 'post', entityId: 'p1' }, 'Hoy fui al río.');
    assert.match(reply.text, /«Hoy fui al río\.»/);
  });

  it('sin el texto de la publicación lo dice en vez de inventarlo', () => {
    const reply = mockReply('Resume', { screen: 'post', entityType: 'post', entityId: 'p1' }, null);
    assert.equal(reply.mood, 'error');
    assert.match(reply.text, /No encuentro esa publicación/);
  });

  it('saluda con ánimo feliz', () => {
    assert.equal(mockReply('hola Tero', { screen: 'tero' }).mood, 'happy');
  });
});
