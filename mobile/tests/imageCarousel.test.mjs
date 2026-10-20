// Carrusel de fotos de una publicación (ADR-039). Lógica pura con `node --test`; el componente se
// comprueba leyendo su código fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import { frameAspect, pageIndex } from '../src/shared/media/carousel.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const view = read('src/shared/media/ImageGridView.tsx');

describe('carrusel de fotos', () => {
  it('la foto a la vista sale del desplazamiento y no se sale de rango', () => {
    assert.equal(pageIndex(0, 300, 10), 0);
    assert.equal(pageIndex(290, 300, 10), 1);
    assert.equal(pageIndex(900, 300, 10), 3);
    assert.equal(pageIndex(99999, 300, 10), 9);
    assert.equal(pageIndex(-20, 300, 10), 0);
    assert.equal(pageIndex(100, 0, 10), 0);
  });

  it('el marco usa la proporción de la primera foto, entre 4:5 y 16:9', () => {
    assert.equal(frameAspect({ width: 1000, height: 1000 }), 1);
    assert.equal(frameAspect({ width: 1000, height: 3000 }), 4 / 5);
    assert.equal(frameAspect({ width: 4000, height: 1000 }), 16 / 9);
    assert.equal(frameAspect(undefined), 1);
  });

  it('varias fotos se deslizan con el dedo, con contador, puntos y visor que también desliza', () => {
    assert.match(view, /horizontal\s+pagingEnabled/);
    assert.match(view, /styles\.counter/);
    assert.match(view, /styles\.dots/);
    assert.match(view, /contentOffset=\{\{ x: open \* screenWidth, y: 0 \}\}/);
    assert.doesNotMatch(view, /flexWrap|square/, 'ya no debe haber cuadrícula de cuadros');
  });
});
