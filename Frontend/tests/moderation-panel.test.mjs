// Panel ampliado de moderación de contenido (ADR-044 §2.6-§2.7). Sin dependencias: `node --test`.
// Las funciones puras se importan; los componentes se comprueban leyendo el código fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it } from 'node:test';

import {
  APPEAL_TABS,
  CONTENT_KINDS,
  DECISIONS,
  MEDIA_TABS,
  OUTCOMES,
  SECTIONS,
  canSeeSection,
  hoursLabel,
  isTwoFactorRequired,
  reasonText,
  topScores,
} from '../src/features/moderation/lib/contentLabels.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const page = read('src/features/moderation/pages/Moderation.jsx');
const media = read('src/features/moderation/components/MediaQueue.jsx');
const appeals = read('src/features/moderation/components/AppealsQueue.jsx');
const audit = read('src/features/moderation/components/AuditPanel.jsx');

describe('secciones y roles', () => {
  const reviewer = { is_moderator: true, moderation_role: 'reviewer' };
  const admin = { is_moderator: true, moderation_role: 'admin' };
  const legacy = { is_moderator: true, moderation_role: null };
  const auditSection = SECTIONS.find((s) => s.value === 'audit');
  const mediaSection = SECTIONS.find((s) => s.value === 'media');

  it('la auditoría solo se ofrece al rol admin', () => {
    assert.equal(canSeeSection(auditSection, admin), true);
    assert.equal(canSeeSection(auditSection, reviewer), false);
    assert.equal(canSeeSection(auditSection, legacy), false);
  });

  it('el resto de secciones las ve cualquier moderador, y nadie más', () => {
    assert.equal(canSeeSection(mediaSection, reviewer), true);
    assert.equal(canSeeSection(mediaSection, legacy), true);
    assert.equal(canSeeSection(mediaSection, { is_moderator: false }), false);
    assert.equal(canSeeSection(mediaSection, null), false);
  });

  it('Reportes sigue siendo la primera sección: es el panel de siempre', () => {
    assert.equal(SECTIONS[0].value, 'reports');
    assert.match(page, /<ModerationQueue currentUserId=\{user\.id\} \/>/);
  });

  it('no hay un segundo panel ni una ruta nueva', () => {
    const router = read('src/app/router/router.jsx');
    assert.equal((router.match(/path="\/moderation/g) || []).length, 1);
  });
});

describe('contrato con el servidor', () => {
  it('las pestañas y decisiones coinciden con los valores del backend', () => {
    assert.deepEqual(MEDIA_TABS.map((t) => t.value), ['held', 'pending', 'rejected']);
    assert.deepEqual(APPEAL_TABS.map((t) => t.value), ['open', 'upheld', 'overturned']);
    assert.deepEqual(Object.keys(DECISIONS), ['approved', 'held', 'rejected']);
    assert.deepEqual(Object.keys(OUTCOMES), ['upheld', 'overturned']);
  });

  it('usa solo las rutas documentadas', () => {
    assert.match(media, /"\/moderation\/media"/);
    assert.match(media, /`\/moderation\/media\/\$\{item\.id\}\/decision`/);
    assert.match(media, /`\/moderation\/media\/\$\{id\}\/file`/);
    assert.match(appeals, /"\/moderation\/appeals"/);
    assert.match(appeals, /`\/moderation\/appeals\/\$\{appeal\.id\}\/resolve`/);
    assert.match(audit, /"\/moderation\/audit"/);
    assert.match(audit, /"\/moderation\/jobs"/);
  });

  it('reconoce el código de 2FA obligatoria y no otro 403', () => {
    const twoFactor = { response: { status: 403, data: { code: 'two_factor_required' } } };
    assert.equal(isTwoFactorRequired(twoFactor), true);
    assert.equal(isTwoFactorRequired({ response: { status: 403, data: {} } }), false);
    assert.equal(isTwoFactorRequired({ response: { status: 404 } }), false);
    assert.equal(isTwoFactorRequired(undefined), false);
  });
});

describe('historias en el panel', () => {
  it('ofrece imágenes e historias con los valores de ?type= del servidor', () => {
    assert.deepEqual(CONTENT_KINDS.map((k) => k.value), ['media', 'story']);
  });

  it('manda el tipo en la cola, la decisión y la vista previa', () => {
    assert.match(media, /params: \{ status: tab, type: kind, limit: PAGE_SIZE, offset \}/);
    assert.match(media, /params: \{ type: kind \}/);
    assert.match(media, /`\/moderation\/media\/\$\{id\}\/preview-url`/);
  });

  it('una historia privada se ve con la URL firmada y no se guarda en ningún sitio', () => {
    assert.match(media, /res\.data\.url/);
    assert.ok(!/localStorage|sessionStorage/.test(media));
  });
});

describe('imágenes pendientes en el resto de la web', () => {
  const grid = read('src/shared/components/ImageGrid.jsx');
  const viewer = read('src/features/feed/components/StoryViewer.jsx');
  const reviews = read('src/features/places/components/ReviewPhotos.jsx');

  it('ninguna pantalla dibuja una imagen sin URL', () => {
    assert.match(grid, /allImages\.filter\(\(image\) => image\.url\)/);
    assert.match(viewer, /story\.image\.url \?/);
    assert.match(reviews, /image\.url \?/);
  });

  it('avisa a quien la subió en lugar de dejar un hueco', () => {
    assert.match(grid, /en revisión/);
    assert.match(viewer, /está en revisión/);
    assert.match(reviews, /En revisión/);
  });
});

describe('seguridad de la interfaz', () => {
  it('la vista previa se pide con la sesión y se libera al salir', () => {
    assert.match(media, /responseType: "blob"/);
    assert.match(media, /headers: authHeaders\(\)/);
    assert.match(media, /URL\.revokeObjectURL/);
  });

  it('nunca muestra correos ni claves de almacenamiento', () => {
    for (const source of [media, appeals, audit]) {
      assert.ok(!/storage_key/.test(source), 'usa storage_key');
      assert.ok(!/\.email/.test(source), 'lee un correo');
    }
  });

  it('un conflicto (409) saca la apelación de la lista', () => {
    assert.match(appeals, /status === 409/);
  });

  it('avisa cuando falta la 2FA en lugar de mostrar una lista vacía', () => {
    assert.match(page, /verificación en dos pasos/);
    assert.match(page, /role="alert"/);
  });

  it('el 403 de «otra persona debe revisar» llega con el mensaje del servidor', () => {
    assert.match(appeals, /moderationErrorMessage/);
  });
});

describe('funciones puras', () => {
  it('ordena los puntajes y los muestra como porcentaje', () => {
    assert.deepEqual(
      topScores({ violence: 0.6, sexual: 0.12, hate: 0, spam: 'x' }).map((s) => [s.category, s.percent]),
      [['violence', 60], ['sexual', 12]],
    );
    assert.deepEqual(topScores(null), []);
  });

  it('un motivo desconocido se muestra tal cual y uno vacío no rompe', () => {
    assert.equal(reasonText('nuevo_motivo'), 'nuevo_motivo');
    assert.equal(reasonText(undefined), '—');
    assert.equal(reasonText('doubtful_signal'), 'Señal dudosa');
  });

  it('formatea las horas', () => {
    assert.equal(hoursLabel(null), '—');
    assert.equal(hoursLabel(0.2), 'menos de 1 h');
    assert.equal(hoursLabel(5.6), '6 h');
  });
});
