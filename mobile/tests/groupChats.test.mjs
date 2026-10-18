// Chats grupales en la app (ADR-048): conexión de las pantallas con el contrato. `node --test`, sin
// dependencias: se comprueba el código de las pantallas, que toca módulos nativos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

describe('cliente', () => {
  it('el hilo de un grupo se lee y se escribe en /groups/<id>/messages', () => {
    const api = read('src/features/messages/api.ts');
    assert.match(api, /`\/groups\/\$\{id\}\/messages`/);
    assert.match(api, /`\/users\/\$\{id\}\/messages`/);
    // Los cuatro envíos (texto, publicación, voz y foto/video) usan la misma ruta.
    assert.equal((api.match(/threadUrl\(otherUserId\)/g) ?? []).length, 5);
    assert.match(api, /recipient_id: string \| null/);
  });

  it('la gestión del grupo usa los endpoints del contrato', () => {
    const groups = read('src/features/messages/groups.ts');
    assert.match(groups, /'\/groups'/);
    assert.match(groups, /body: \{ name, member_ids: memberIds \}/);
    assert.match(groups, /`\/groups\/\$\{groupId\}\/members`/);
    assert.match(groups, /body: \{ role: 'admin' \}/);
    assert.match(groups, /`\/groups\/\$\{groupId\}\/leave`/);
  });
});

describe('pantallas', () => {
  it('un grupo y un directo comparten la misma pantalla de chat', () => {
    assert.match(read('app/chat/[userId].tsx'), /<ChatScreen kind="user"/);
    assert.match(read('app/group/[groupId].tsx'), /<ChatScreen kind="group"/);
    const screen = read('src/features/messages/ChatScreen.tsx');
    assert.match(screen, /kind,/);
    assert.match(screen, /showName=\{isGroup\}/);
    // Sin reportar a «la cuenta» ni bloquear dentro de un grupo.
    assert.match(screen, /isGroup \? null : <ReportModal/);
  });

  it('el hook del chat manda y recibe por el destino, sin destinatario local en un grupo', () => {
    const hook = read('src/features/messages/useChat.ts');
    assert.match(hook, /fetchThread\(channel,/);
    assert.match(hook, /sendMessage\(channel,/);
    assert.match(hook, /const recipient = kind === 'group' \? null : id/);
    assert.match(hook, /'Grupo no encontrado'/);
  });

  it('la lista de chats mezcla grupos y ya no avisa «próximamente»', () => {
    const list = read('app/(tabs)/messages.tsx');
    assert.doesNotMatch(list, /comingSoon\('Los chats de grupo'\)/);
    assert.match(list, /fetchGroups/);
    assert.match(list, /router\.push\('\/group\/new'\)/);
    assert.match(list, /pathname: '\/group\/\[groupId\]'/);
    assert.match(list, /\['groups', 'Grupos'\]/);
  });

  it('el contador de la pestaña suma los no leídos de los grupos', () => {
    const unread = read('src/features/messages/useUnreadCount.ts');
    assert.match(unread, /fetchGroups/);
    assert.match(unread, /groups\.reduce/);
  });

  it('crear y gestionar un grupo tienen su pantalla', () => {
    const create = read('app/group/new.tsx');
    assert.match(create, /createGroup\(name\.trim\(\), \[\.\.\.selected\]\)/);
    const info = read('app/group/info/[groupId].tsx');
    for (const call of ['renameGroup', 'addGroupMembers', 'promoteGroupMember', 'removeGroupMember', 'leaveGroup']) {
      assert.match(info, new RegExp(call));
    }
  });

  it('compartir una publicación también permite elegir un grupo', () => {
    const sheet = read('src/features/posts/SharePostSheet.tsx');
    assert.match(sheet, /fetchGroups/);
    assert.match(sheet, /sendPostMessage\(\{ kind: person\.kind, id: person\.id \}/);
  });
});
