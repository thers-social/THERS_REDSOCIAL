// Pruebas de los datos estructurados (JSON-LD) de la home (ADR-033-seo-foundation.md).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildJsonLd } from '../src/shared/seo/seoRoutes.js';

describe('buildJsonLd', () => {
  it('no genera nada sin dominio público', () => {
    assert.equal(buildJsonLd(undefined), null);
    assert.equal(buildJsonLd(''), null);
  });

  it('declara Organization y WebSite con URLs absolutas del dominio', () => {
    const data = buildJsonLd('https://thersweb.com/');
    const types = data['@graph'].map((n) => n['@type']);

    assert.deepEqual(types, ['Organization', 'WebSite']);
    for (const node of data['@graph']) {
      assert.equal(node.url, 'https://thersweb.com/');
    }
  });

  it('es JSON serializable', () => {
    assert.doesNotThrow(() => JSON.stringify(buildJsonLd('https://thersweb.com')));
  });
});
