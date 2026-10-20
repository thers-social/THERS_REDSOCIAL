// Carrusel de fotos de una publicación (ADR-039). Lógica pura con `node --test`; el componente se
// comprueba leyendo su código fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import { MAX_ASPECT, MIN_ASPECT, currentIndex, frameAspect, stepIndex } from '../src/shared/lib/imageCarousel.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const grid = read('src/shared/components/ImageGrid.jsx');

describe('proporción del marco', () => {
  it('usa la de la primera foto, limitada entre 4:5 y 16:9', () => {
    assert.equal(frameAspect([{ width: 1000, height: 1000 }]), 1);
    assert.equal(frameAspect([{ width: 1000, height: 3000 }]), MIN_ASPECT);
    assert.equal(frameAspect([{ width: 4000, height: 1000 }]), MAX_ASPECT);
    assert.equal(frameAspect([{ width: 1200, height: 900 }, { width: 100, height: 900 }]), 1200 / 900);
  });

  it('sin datos devuelve un cuadrado', () => {
    assert.equal(frameAspect([]), 1);
    assert.equal(frameAspect(undefined), 1);
    assert.equal(frameAspect([{ width: 0, height: 0 }]), 1);
  });
});

describe('qué foto se ve', () => {
  it('sale del desplazamiento y no se sale de rango', () => {
    assert.equal(currentIndex(0, 400, 10), 0);
    assert.equal(currentIndex(380, 400, 10), 1);
    assert.equal(currentIndex(1600, 400, 10), 4);
    assert.equal(currentIndex(99999, 400, 10), 9);
    assert.equal(currentIndex(-50, 400, 10), 0);
    assert.equal(currentIndex(100, 0, 10), 0);
  });

  it('las flechas avanzan y retroceden sin pasarse', () => {
    assert.equal(stepIndex(0, -1, 10), 0);
    assert.equal(stepIndex(0, 1, 10), 1);
    assert.equal(stepIndex(9, 1, 10), 9);
    assert.equal(stepIndex(5, -1, 10), 4);
  });
});

describe('componente', () => {
  it('varias fotos van en un carrusel con desplazamiento, flechas, contador y puntos', () => {
    assert.match(grid, /snap-x snap-mandatory overflow-x-auto/);
    assert.match(grid, /aria-roledescription="carrusel"/);
    assert.match(grid, /aria-label="Foto anterior"/);
    assert.match(grid, /aria-label="Foto siguiente"/);
    assert.match(grid, /\{index \+ 1\}\/\{count\}/);
    assert.ok(!/grid-cols-2|aspect-square/.test(grid), 'ya no debe haber cuadrícula de cuadros');
  });

  it('una sola foto conserva su proporción', () => {
    assert.match(grid, /count === 1 \?/);
    assert.match(grid, /aspectRatio: `\$\{images\[0\]\.width\} \/ \$\{images\[0\]\.height\}`/);
  });

  it('las flechas del teclado mueven el carrusel y las de la pantalla solo salen en pantallas anchas', () => {
    assert.match(grid, /event\.key === "ArrowRight"/);
    assert.match(grid, /hidden[^"]*md:flex/);
  });
});
