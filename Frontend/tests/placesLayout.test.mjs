// Diseño de la página de Lugares en la web: que no sobre un espacio en blanco al hacer scroll.
// Sin dependencias: `node --test`. (Medido en Chrome: antes sobraban 48 px en la lista y 900 px
// en la ficha, con el fondo blanco debajo.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const places = read('src/features/places/pages/Places.jsx');

describe('diseño de Lugares', () => {
  it('la altura de escritorio descuenta lo mismo que reserva el shell, con sus variables', () => {
    // ShellFrame reserva `--th-topbar-h` + 16 px arriba y `--th-margin` abajo en escritorio.
    const shell = read('src/app/layout/thers/ShellFrame.jsx');
    assert.match(shell, /pt-\[calc\(var\(--th-topbar-h\)\+16px\)\]/);
    assert.match(shell, /lg:pb-th-margin/);
    assert.ok(places.includes('lg:h-[calc(100dvh-var(--th-topbar-h)-16px-var(--th-margin))]'));
    assert.ok(!places.includes('100dvh-4rem'), 'la altura fija de 4rem dejaba 48 px de sobra');
  });

  it('el scroll de la lista y la ficha es un contenedor posicionado', () => {
    // Sin `relative`, los `sr-only` (position:absolute) de la ficha escapan del recorte y estiran
    // toda la página.
    assert.match(places, /className="relative min-h-0 flex-1 overflow-y-auto pr-1"/);
  });

  it('los botones de la ficha pasan a otra línea en vez de desbordar en móvil', () => {
    const panel = read('src/features/places/components/PlaceDetailPanel.jsx');
    assert.ok(panel.includes('className="mt-4 flex flex-wrap gap-2"'));
  });
});
