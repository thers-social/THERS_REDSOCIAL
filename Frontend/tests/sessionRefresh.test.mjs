// Pruebas de la renovación automática de sesión de la web (ADR-017 §4.4). Sin dependencias: se
// simula el cliente HTTP y el almacenamiento; no sustituyen una prueba en el navegador.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { installSessionRefresh, revokeSession } = await import('../src/shared/lib/sessionRefresh.js');
const { getAccessToken, getRefreshToken } = await import('../src/shared/lib/sessionTokens.js');

/** Cliente simulado: `server(config)` decide cada respuesta; guarda las llamadas que recibe. */
function makeApi(server) {
  const calls = [];
  let handler;
  const api = async (config) => {
    calls.push({ url: config.url, auth: config.headers?.Authorization });
    try {
      return await server(config);
    } catch (error) {
      error.config = config;
      return handler(error);
    }
  };
  api.interceptors = {
    response: {
      use: (_ok, fail) => { handler = fail; return 1; },
      eject: () => {},
    },
  };
  api.post = (url, data, config = {}) => api({ ...config, url, method: 'post', data });
  api.calls = calls;
  return api;
}

const http = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const authed = (token = 'old') => ({ url: '/posts', headers: { Authorization: `Bearer ${token}` } });

beforeEach(() => {
  store.clear();
  store.set('token', 'old');
  store.set('refresh_token', 'r1');
  store.set('user', '{"id":1}');
});

describe('renovación automática', () => {
  it('renueva ante un 401 y repite la petición con el token nuevo', async () => {
    const api = makeApi(async (config) => {
      if (config.url === '/refresh') return { data: { token: 'new', refresh_token: 'r2' } };
      if (config.headers.Authorization === 'Bearer old') throw http(401);
      return { data: 'ok' };
    });
    installSessionRefresh(api);
    const res = await api(authed());
    assert.equal(res.data, 'ok');
    assert.equal(getAccessToken(), 'new');
    assert.equal(getRefreshToken(), 'r2');
    assert.equal(api.calls.filter((c) => c.url === '/refresh').length, 1);
  });

  it('con varias peticiones a la vez renueva UNA sola vez', async () => {
    const api = makeApi(async (config) => {
      if (config.url === '/refresh') {
        await new Promise((r) => setTimeout(r, 20));
        return { data: { token: 'new', refresh_token: 'r2' } };
      }
      if (config.headers.Authorization === 'Bearer old') throw http(401);
      return { data: 'ok' };
    });
    installSessionRefresh(api);
    await Promise.all([api(authed()), api(authed()), api(authed())]);
    assert.equal(api.calls.filter((c) => c.url === '/refresh').length, 1);
  });

  it('si el refresh también da 401 cierra la sesión y lo avisa', async () => {
    let expired = 0;
    const api = makeApi(async (config) => {
      if (config.url === '/refresh') throw http(401);
      throw http(401);
    });
    installSessionRefresh(api, { onExpired: () => { expired += 1; } });
    await assert.rejects(api(authed()), (error) => error.sessionExpired === true);
    assert.equal(expired, 1);
    assert.equal(getAccessToken(), null);
    assert.equal(getRefreshToken(), null);
  });

  it('un fallo de red al renovar NO cierra la sesión', async () => {
    let expired = 0;
    const api = makeApi(async (config) => {
      if (config.url === '/refresh') throw new Error('Network Error');
      throw http(401);
    });
    installSessionRefresh(api, { onExpired: () => { expired += 1; } });
    await assert.rejects(api(authed()));
    assert.equal(expired, 0);
    assert.equal(getRefreshToken(), 'r1');
  });

  it('no intercepta un 401 sin Authorization (login con clave mala)', async () => {
    const api = makeApi(async () => { throw http(401); });
    installSessionRefresh(api);
    await assert.rejects(api({ url: '/login', headers: {} }), (error) => !error.sessionExpired);
    assert.equal(api.calls.filter((c) => c.url === '/refresh').length, 0);
  });

  it('no entra en bucle si la petición repetida vuelve a dar 401', async () => {
    const api = makeApi(async (config) => {
      if (config.url === '/refresh') return { data: { token: 'new', refresh_token: 'r2' } };
      throw http(401);
    });
    installSessionRefresh(api);
    await assert.rejects(api(authed()));
    assert.equal(api.calls.filter((c) => c.url === '/refresh').length, 1);
  });

  it('sin refresh token no intenta renovar', async () => {
    store.delete('refresh_token');
    const api = makeApi(async () => { throw http(401); });
    installSessionRefresh(api);
    await assert.rejects(api(authed()));
    assert.equal(api.calls.length, 1);
  });

  it('revokeSession manda el refresh a /logout y no falla sin red', async () => {
    const api = makeApi(async () => { throw new Error('Network Error'); });
    await revokeSession(api);
    assert.equal(api.calls[0].url, '/logout');
    assert.equal(api.calls[0].auth, 'Bearer r1');
  });
});
