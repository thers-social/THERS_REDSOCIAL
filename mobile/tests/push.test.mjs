// Notificaciones push en la app (ADR-053): a dónde lleva cada aviso y cómo se conecta con la sesión.
// `node --test`, sin dependencias nativas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import { routeForNotification } from '../src/features/push/routes.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('routeForNotification', () => {
  it('un mensaje directo abre ese chat', () => {
    assert.deepEqual(routeForNotification({ type: 'message', sender_id: ID }), {
      pathname: '/chat/[userId]',
      params: { userId: ID },
    });
  });

  it('un mensaje de grupo abre ese grupo', () => {
    assert.deepEqual(routeForNotification({ type: 'group_message', group_id: ID }), {
      pathname: '/group/[groupId]',
      params: { groupId: ID },
    });
  });

  it('seguir y aceptar llevan al perfil de quien lo hizo; una solicitud, a las solicitudes', () => {
    for (const type of ['follow', 'follow_accepted']) {
      assert.deepEqual(routeForNotification({ type, actor_id: ID }), {
        pathname: '/user/[userId]',
        params: { userId: ID },
      });
    }
    assert.equal(routeForNotification({ type: 'follow_request', actor_id: ID }), '/settings/follow-requests');
  });

  it('me gusta, comentario y mención abren la publicación', () => {
    for (const type of ['like', 'comment', 'mention']) {
      assert.deepEqual(routeForNotification({ type, post_id: ID }), {
        pathname: '/post/[id]',
        params: { id: ID },
      });
    }
  });

  it('los avisos de Places abren el lugar; los de quien lo gestiona, su panel', () => {
    for (const type of ['place_reservation_decided', 'place_quote_decided', 'place_plan_invite', 'place_review_reply']) {
      assert.deepEqual(routeForNotification({ type, place_id: ID }), {
        pathname: '/places/[id]',
        params: { id: ID },
      });
    }
    for (const type of ['place_reservation_new', 'place_reservation_cancelled', 'place_quote_new']) {
      assert.deepEqual(routeForNotification({ type, place_id: ID }), {
        pathname: '/places/manage/[id]',
        params: { id: ID },
      });
    }
    assert.equal(routeForNotification({ type: 'place_plan_invite', place_id: 'no-es-uuid' }), '/notifications');
  });

  it('un identificador que no es UUID, un tipo desconocido o la falta de datos llevan a los avisos', () => {
    assert.equal(routeForNotification({ type: 'message', sender_id: '../../settings' }), '/notifications');
    assert.equal(routeForNotification({ type: 'otra_cosa' }), '/notifications');
    assert.equal(routeForNotification({ type: 'like' }), '/notifications');
    assert.equal(routeForNotification(null), '/notifications');
    assert.equal(routeForNotification(undefined), '/notifications');
  });
});

describe('conexión', () => {
  it('el registro usa POST/DELETE /push/devices con el token de Firebase del teléfono', () => {
    const push = read('src/features/push/push.ts');
    assert.match(push, /getDevicePushTokenAsync/);
    assert.match(push, /'\/push\/devices'/);
    assert.match(push, /method: 'POST'/);
    assert.match(push, /method: 'DELETE'/);
  });

  it('cerrar sesión quita el teléfono ANTES de revocar la sesión', () => {
    const auth = read('src/features/auth/context/AuthContext.tsx');
    const unregister = auth.indexOf('await unregisterPushDevice()');
    const revoke = auth.indexOf('await revokeSessionOnServer()');
    assert.ok(unregister > -1 && revoke > unregister);
  });

  it('el layout raíz monta el puente y la configuración incluye el plugin y el archivo de Firebase', () => {
    assert.match(read('app/_layout.tsx'), /<PushBridge \/>/);
    assert.match(read('app.json'), /"expo-notifications"/);
    assert.match(read('app.config.js'), /google-services\.json/);
    assert.match(read('.gitignore'), /google-services\.json/);
  });
});
