// Los colores de la web de Lugares (ADR-040). Sin dependencias: `node --test`.
//
// Por qué existe: los tokens de color del diseño viven bajo `th-` en `tailwind.config.js`
// (`bg-th-brand`, `text-th-danger-fg`). Una clase como `bg-brand` NO existe: Tailwind no genera
// nada y el elemento sale sin color, sin que ningún lint ni build lo avise. Esta prueba lo atrapa:
// prohíbe los nombres sin prefijo y comprueba que cada clase `th-` usada exista en la configuración.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import tailwind from '../tailwind.config.js';

const PLACES = fileURLToPath(new URL('../src/features/places', import.meta.url));

function sources(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.jsx?$/.test(name) ? [path] : [];
  });
}
const files = sources(PLACES).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

const PREFIXES = 'bg|text|border|ring|divide|fill|stroke|outline|accent|from|to|via|decoration|placeholder';
const BARE = new RegExp(
  `(?<![\\w-])(?:${PREFIXES})-(?:brand-soft-strong|brand-soft|brand-hover|brand-fg|on-brand|brand|success-fg|danger-fg|warning-fg)(?![\\w-])`,
  'g'
);
const THEMED = new RegExp(`(?<![\\w-])(?:${PREFIXES})-th-([a-z0-9-]+)`, 'g');
const thColors = Object.keys(tailwind.theme.extend.colors.th);

describe('colores de Lugares en la web', () => {
  it('hay archivos que revisar', () => {
    assert.ok(files.length >= 20, `solo ${files.length} archivos`);
  });

  it('ninguna clase de color de marca o de estado queda sin el prefijo `th-`', () => {
    const offenders = files.flatMap(({ path, text }) =>
      [...text.matchAll(BARE)].map((m) => `${path.split('places')[1]}: ${m[0]}`)
    );
    assert.deepEqual(offenders, [], `clases que Tailwind no genera:\n${offenders.join('\n')}`);
  });

  it('toda clase `th-` usada existe en la configuración de Tailwind', () => {
    const used = new Set();
    for (const { text } of files) for (const m of text.matchAll(THEMED)) used.add(m[1]);
    const missing = [...used].filter((name) => !thColors.includes(name));
    assert.deepEqual(missing, [], `no están en tailwind.config.js (th): ${missing.join(', ')}`);
    assert.ok(used.has('brand') && used.has('on-brand'), 'se esperaba ver la marca en uso');
  });

  it('la configuración tiene los tokens de marca y de estado que Lugares necesita', () => {
    for (const name of ['brand', 'brand-hover', 'brand-fg', 'brand-soft', 'on-brand', 'danger-fg', 'success-fg', 'warning-fg']) {
      assert.ok(thColors.includes(name), name);
    }
  });
});
