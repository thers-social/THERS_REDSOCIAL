// Chats grupales en la web (ADR-048): textos, cliente y conexión de las pantallas. `node --test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const dict = {
  es: JSON.parse(read('src/shared/i18n/locales/es.json')).groups,
  en: JSON.parse(read('src/shared/i18n/locales/en.json')).groups,
};
const leaves = (object, prefix = '') =>
  Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'object' ? leaves(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );

describe('textos', () => {
  it('español e inglés tienen exactamente las mismas claves', () => {
    assert.ok(dict.es && dict.en, 'falta el bloque groups');
    assert.deepEqual(leaves(dict.es).sort(), leaves(dict.en).sort());
  });

  it('todas las claves usadas en el código existen', () => {
    const known = new Set(leaves(dict.es));
    for (const file of [
      'src/features/feed/pages/Messages.jsx',
      'src/features/feed/components/CreateGroupDialog.jsx',
      'src/features/feed/components/GroupInfoDialog.jsx',
    ]) {
      for (const [, key] of read(file).matchAll(/t\("groups\.([a-zA-Z.]+)"/g)) {
        assert.ok(known.has(key), `falta groups.${key}`);
      }
    }
  });
});

describe('cliente', () => {
  const api = read('src/features/feed/lib/groupsApi.js');
  it('usa los endpoints del contrato', () => {
    assert.match(api, /api\.get\("\/groups"/);
    assert.match(api, /api\.post\("\/groups", \{ name, member_ids: memberIds \}/);
    assert.match(api, /\/groups\/\$\{groupId\}\/members/);
    assert.match(api, /\{ role: "admin" \}/);
    assert.match(api, /\/groups\/\$\{groupId\}\/leave/);
  });
});

describe('pantallas', () => {
  const messages = read('src/features/feed/pages/Messages.jsx');

  it('el hilo de un grupo se lee y se escribe en /groups/<id>/messages', () => {
    assert.match(messages, /`\/groups\/\$\{activeGroupId\}\/messages`/);
    assert.match(messages, /api\.post\(messagesPath, body/);
    assert.match(messages, /api\.get\(messagesPath/);
  });

  it('"escribiendo" solo existe en los directos y el grupo muestra quién habla', () => {
    assert.match(messages, /if \(activeGroupId\) return;/);
    assert.match(messages, /message\.sender\?\.name/);
  });

  it('el shell suma los no leídos de los grupos al badge y los pasa por contexto', () => {
    const shell = read('src/app/layout/AppShell.jsx');
    assert.match(shell, /groups\.reduce\(\(sum, g\) => sum \+ g\.unread_count/);
    assert.match(shell, /\s+groups,\s+onReloadConversations/);
  });

  it('crear y gestionar abren sus diálogos', () => {
    assert.match(messages, /<CreateGroupDialog/);
    assert.match(messages, /<GroupInfoDialog/);
  });
});
