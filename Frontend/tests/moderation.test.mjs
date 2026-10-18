// Pruebas de la página de moderación (ADR-032 §3, fase 3). Sin dependencias: `node --test`
// lee los archivos fuente. No sustituyen una prueba en el navegador; comprueban las reglas
// que no deben romperse por accidente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

const router = read('src/app/router/router.jsx');
const page = read('src/features/moderation/pages/Moderation.jsx');
const card = read('src/features/moderation/components/ReportCard.jsx');
const dialog = read('src/features/moderation/components/ResolveDialog.jsx');
const labels = read('src/features/moderation/lib/reportLabels.js');

describe('ruta', () => {
  it('existe, dentro de las rutas protegidas y del shell', () => {
    const protectedRoute = router.indexOf('<ProtectedRoute />');
    const shell = router.indexOf('<AppShell />');
    const route = router.indexOf('path="/moderation"');
    const publicLayout = router.indexOf('<PublicLayout />');
    assert.ok(protectedRoute > -1 && shell > protectedRoute, 'AppShell va dentro de ProtectedRoute');
    assert.ok(route > shell && route < publicLayout, '/moderation va dentro del shell protegido');
  });

  it('no tiene ningún enlace en la navegación', () => {
    for (const nav of ['src/app/layout/NavRail.jsx', 'src/app/layout/MobileNav.jsx', 'src/app/layout/thers/navigation.js']) {
      assert.ok(!/moderation/i.test(read(nav)), `${nav} enlaza a moderación`);
    }
  });

  it('no está en el sitemap ni se indexa', () => {
    assert.ok(!/moderation/.test(read('src/shared/seo/seoRoutes.js')));
  });
});

describe('acceso', () => {
  it('muestra la página de «no encontrada» a quien no es moderador', () => {
    assert.match(page, /if \(!user\?\.is_moderator\) return <NotFound \/>/);
  });

  it('reconoce el 404 del servidor como pérdida del rol', () => {
    assert.match(page, /status === 404\) setDenied\(true\)/);
  });

  it('declara que la seguridad real es del servidor', () => {
    assert.match(page, /seguridad real está en el\s+\/\/ servidor/);
  });
});

describe('qué consulta y qué muestra', () => {
  it('usa solo las rutas de moderación del contrato', () => {
    assert.match(page, /"\/moderation\/reports"/);
    assert.match(page, /`\/moderation\/reports\/\$\{report\.id\}\/resolve`/);
  });

  it('nunca muestra ni pide quién reportó', () => {
    for (const source of [page, card, dialog]) {
      assert.ok(!/reporter_id/.test(source), 'usa reporter_id');
      assert.ok(!/\.reporter\b/.test(source), 'lee un campo reporter');
    }
  });

  it('distingue lo crítico y lo muestra primero', () => {
    assert.match(card, /report\.priority === "critical"/);
    assert.match(card, /Prioridad crítica/);
  });

  it('cubre los diez motivos del backend con su texto', () => {
    const reasons = ['spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'illegal', 'impersonation', 'other', 'child_safety'];
    for (const reason of reasons) assert.match(labels, new RegExp(`\\b${reason}:`), `falta ${reason}`);
    assert.match(labels, /Explotación o abuso de menores/);
  });

  it('ofrece exactamente las tres acciones del contrato', () => {
    for (const action of ['dismiss', 'remove_content', 'suspend_user']) {
      assert.match(labels, new RegExp(`\\b${action}:`), `falta ${action}`);
    }
  });
});

describe('reglas que replican las del servidor', () => {
  it('no se puede retirar contenido de un reporte sobre una cuenta', () => {
    assert.match(card, /remove_content: !isAboutMe && report\.target_type !== "user"/);
  });

  it('no se suspende a una cuenta moderadora ni se actúa sobre uno mismo', () => {
    assert.match(card, /suspend_user: !isAboutMe && !!reported && !reported\.is_moderator/);
  });

  it('separa la nota interna del motivo que ve la persona suspendida', () => {
    assert.match(dialog, /Nota interna/);
    assert.match(dialog, /Motivo que verá la persona/);
    assert.match(dialog, /La persona nunca la ve/);
  });

  it('limita los textos a 500 caracteres, como el servidor', () => {
    assert.match(labels, /MAX_TEXT_LENGTH = 500/);
    assert.match(dialog, /maxLength=\{MAX_TEXT_LENGTH\}/);
  });

  it('confirma antes de actuar y no deja actuar dos veces a la vez', () => {
    assert.match(dialog, /disabled=\{busy\}/);
    assert.match(page, /setBusy\(true\)/);
  });

  it('quita de la lista el reporte que otra persona ya resolvió (409)', () => {
    assert.match(page, /status === 409/);
  });
});
