# Matriz de aprobación — Moderación inteligente (ADR-044 y ADR-045)

| Campo | Valor |
|---|---|
| Documento | `docs/architecture/MODERATION_APPROVAL_MATRIX.md` |
| Fecha | 2026-10-18 |
| Base | `origin/develop` `db84edc` |
| Estado | Paquete **listo para ratificación**. **Nada aquí está ratificado.** |
| Fuente de las decisiones | Propuesta del propietario del proyecto, 2026-10-18 (10 puntos) |

Este documento responde: qué falta aprobar, quién debe aprobarlo y qué se puede programar apenas se
apruebe, sin contratar nada.

---

## 1. Procedimiento real de aprobación

Fuente: `HB-001` §11.1, §12 y §20 («Toda decisión de alto impacto se documenta como ADR **antes** de
implementarse»).

La moderación cambia el modelo de datos, la visibilidad del contenido, los permisos y el tratamiento de
datos de terceros: es **alto impacto**. Por tanto:

| Paso | Qué exige `HB-001` | Estado |
|---|---|---|
| 1 | Propuesta breve (problema, opciones, recomendación) | Hecho: `ADR-044` v2 y `ADR-045` v2 |
| 2 | Compartirla en Notion («Registro de Decisiones») **con al menos 24 h de anticipación** | **Pendiente.** No pude verificar que esa página exista ni su contenido: la búsqueda en Notion no la encontró con el acceso actual |
| 3 | Discusión en reunión o canal | Pendiente |
| 4 | Decisión **por consenso del Comité Técnico (los 4 integrantes)**; sin consenso, votación por mayoría simple | Pendiente |
| 5 | Registrar el ADR con estado **Aceptada** | Pendiente |
| 6 | PR de los documentos con **al menos 1 aprobación** que no sea la del autor (`HB-001` §9, §20) | Pendiente |

**Qué cuenta como «ratificado»:** pasos 2 a 6 completos y el ADR con `Estado: Aceptada` en el repositorio
y en el registro de Notion. La decisión del propietario es la propuesta, no sustituye al Comité
(`HB-001` §1: el Project Owner «no tiene autoridad unilateral sobre decisiones técnicas»).

---

## 2. ADR que requieren aprobación formal

| ADR | Estado en el repositorio | ¿Bloquea la moderación? | Acción |
|---|---|---|---|
| `ADR-032` Reportes y moderación | `PROPUESTO` (fases 1–2 ya integradas en `develop`) | **Sí**: `ADR-044` lo amplía | Ratificar, o declarar que quedó aceptado de hecho. Hay que dejar constancia |
| `ADR-038` Seguridad infantil en reportes | `PROPUESTO` («Sin commit» en su encabezado, ya integrado) | **Sí**: `ADR-044` §3 lo amplía | Ídem. Actualizar el encabezado desactualizado |
| `ADR-041` Tero | `BORRADOR` en `develop`; el propietario indica que el equipo lo aceptó | **Sí**: `ADR-045` lo amplía | Registrar la aceptación y actualizar el archivo en su propio PR |
| `ADR-044` Moderación híbrida | Propuesta v2 (este paquete) | **Sí** | Ratificar |
| `ADR-045` Proveedor de IA compartido | Propuesta v2 (este paquete) | Solo para la parte de IA (Incremento 3) | Ratificar |
| `ADR-042` Historias | `PROPUESTO`; rama `feature/stories-integration` sin fusionar | **No** para la infraestructura base; **sí** para cablear Historias | Ratificar antes de fusionar la rama |
| `ADR-043` Videos y `ADR-043-A` Mux | `BORRADOR`, ramas aparte | **No**. Reels sigue bloqueado | Fuera de este paquete |
| `ADR-026`, `ADR-027`, `ADR-037` | Ya en uso | No | Solo se reutilizan |

---

## 3. Decisiones de ADR-044

Columnas: **Prop.** = decisión del propietario · **Aprueba** = quién debe aprobar además del Comité ·
**Base** = ¿permite empezar la infraestructura base sin contratar nada?

| # | Decisión de ADR-044 | Prop. | Recomendación original | Aprueba | Base |
|---|---|---|---|---|---|
| D1 | Flask decide; n8n solo orquesta | Sí (1) | Sí | Comité Técnico | **Sí** |
| D2 | n8n Cloud o autoalojado | n8n Cloud, pendiente de contratar (7) | Cloud Starter | Comité + **quien autorice el gasto** | No necesaria: nada de n8n entra en la base |
| D3 | La IA nunca rechaza ni sanciona sola | Sí (2) | Sí | Comité Técnico | **Sí** |
| D4 | Retención humana para cuentas nuevas y plazo | 7 días (3) | Sí; plazo a definir | Comité Técnico | **Sí** (parámetro `MODERATION_NEW_ACCOUNT_DAYS`) |
| D5 | Quién modera, guardia y a quién escala lo crítico | **Sin resolver** | Definirlo antes de abrir al público | **Personas del equipo; ver §5** | **Sí** para programar; **no** para encender el flag |
| D6 | Especialista de seguridad infantil y asesoría legal | **Pendiente** (10) | Designarlos | Equipo + **asesoría legal externa** | **Sí** (no abre superficie nueva); bloquea video |
| D7 | Solución de seguridad infantil y tope | **Pendiente** (10) | Cotizar antes de video público | Comité + autorización de gasto | **Sí**; bloquea Reels |
| D8 | Quién revisa apelaciones y plazo | Persona distinta; 72 h (4) | Persona distinta | Comité Técnico | **Sí** |
| D9 | 2FA obligatoria para moderadores | Sí, con roles separados (5) | Sí | Comité Técnico | **Sí** |
| D10 | Proveedor de imágenes | Rekognition a **evaluar** (9) | A elegir con precio verificado | Comité + autorización de gasto | **Sí**: se programa el puerto y un adaptador simulado |

Decisión adicional del propietario sin D equivalente: **(6) reportes críticos por Resend directo**. Aprueba
el Comité. Resend ya está integrado, no requiere contratar nada.

### 3.1 Decisiones añadidas por este paquete (no estaban en la v1)

| # | Decisión | Por qué | Aprueba |
|---|---|---|---|
| N1 | Columna con `DEFAULT 'pending'` en la base, fijada explícitamente por la aplicación según el flag; contenido existente migrado a `approved` | Cumple «no hacer invisibles las publicaciones antiguas» y falla cerrado | Tech Lead Backend + Comité |
| N2 | `admin_audit_log` gana `actor_kind` (`human`/`system`) en lugar de una tabla de auditoría nueva | Una sola auditoría | Tech Lead Backend |
| N3 | Se conserva `users.is_moderator` durante la transición; equivale a `reviewer` | No romper la moderación actual | Tech Lead Backend |
| N4 | La primera implementación cubre **solo** `media_attachments` (imágenes de publicaciones, mensajes y reseñas) | Historias no está en `develop`; Reels está bloqueado | Comité |
| N5 | El panel se amplía en un incremento posterior, no en el primero | PR pequeño, una sola cosa (`HB-001` §9) | Tech Lead Frontend |

---

## 4. Decisiones de ADR-045

| # | Decisión de ADR-045 | Prop. | Recomendación | Aprueba | Base |
|---|---|---|---|---|---|
| D1 | Registro de propósitos con `ai_usage` propio, sin tocar `tero_usage` | Sí (8) | Sí | Comité + **autor de Tero** | No necesaria para el Incremento 1 |
| D2 | Una clave y un espacio de trabajo por propósito | Sí, “credenciales separadas” (8) | Sí, si la consola lo permite | **Titular de la cuenta de API** | No necesaria |
| D3 | Titular y pagador de la cuenta de API | **Sin resolver** | Confirmar con el responsable de Tero | **Titular de la cuenta; ver §5** | No necesaria. **Bloquea encender** el propósito |
| D4 | Tope diario por cuenta para Tero | Sin resolver | Sí | Autor de Tero | No: es un cambio al módulo de Tero, fuera de este paquete |
| D5 | Enviar textos de terceros a un proveedor | Sin resolver | Solo tras verificar retención y actualizar la política de privacidad | Comité + **asesoría legal** | No necesaria. **Bloquea encender** el propósito |
| D6 | Activar `admin_summary` y `support_suggestion` | No | Más adelante; primero `moderation_text` | Comité | Fuera de alcance |

---

## 5. Aprobaciones que dependen de personas adicionales

El Comité Técnico (los 4 integrantes) basta para decidir la arquitectura. Faltan, además:

| Quién | Qué debe decidir o confirmar | Qué bloquea |
|---|---|---|
| **Autor/a de Tero** | Que `ai_usage` y la fábrica de propósitos viven al lado de su módulo, sin tocarlo (ADR-045 D1); aceptación de ADR-041 | Incremento 3 (IA). No bloquea 1 ni 2 |
| **Titular de la cuenta de API** (D3 de ADR-045) | Que la cuenta es de la organización y puede tener claves y límites por propósito | Encender cualquier propósito de IA |
| **Persona que autoriza el gasto** | n8n Cloud, Amazon Rekognition, Mux, solución de seguridad infantil | Cualquier contratación. **Hoy no se contrata nada** |
| **Asesoría legal** (no integrante del equipo) | Protocolo de contenido ilegal grave, retención de evidencia, denuncia, política de privacidad para enviar textos a un tercero | Video público y encender la clasificación de texto de terceros. **No bloquea programar la base** |
| **Responsable de seguridad infantil** (D6) | Designación nominal | Encender el flag para el público |
| **Personas moderadoras y guardia** (D5) | Quiénes son, turnos, a quién escala lo crítico, 2FA activada en sus cuentas | **Encender `MODERATION_ENABLED` para usuarios públicos.** Con la cola sin atender, el contenido nuevo queda retenido |

---

## 6. Qué permite empezar sin contratar proveedores externos

Con la ratificación de **ADR-044** (decisiones 1, 2, 3, 4, 5 y 6 del propietario y N1–N5) se puede programar
el **Incremento 1** de [`MODERATION_IMPLEMENTATION_SCOPE.md`](MODERATION_IMPLEMENTATION_SCOPE.md): estado,
trabajos, resultados, auditoría y motor de políticas, con clasificadores **simulados**. No usa n8n, ni
Rekognition, ni Mux, ni una clave de IA, y llega a producción con el flag apagado.

Los Incrementos 2 (roles, 2FA, panel, apelaciones) y 3 (adaptador de texto por `AiProvider`) también se
programan sin contratar nada, pero el 3 requiere además **ratificar ADR-045**. Lo que **no** se programa
con esta aprobación: integración real con n8n, Rekognition, Mux o cualquier detector de abuso infantil.

---

## 7. Qué falta exactamente para empezar a programar

**Mínimo para el Incremento 1** (todo lo demás puede esperar):

1. Publicar `ADR-044` v2 en el Registro de Decisiones de Notion y esperar **24 h**.
2. Decisión del **Comité Técnico (4 de 4, o mayoría simple)** sobre ADR-044, con N1–N5.
3. Dejar constancia de la situación de `ADR-032` y `ADR-038`, de los que depende (§2).
4. Fusionar este paquete documental por Pull Request con **1 aprobación distinta de la del autor**,
   con `ADR-044` en estado `Aceptada`.

Para el Incremento 3 se añade ratificar `ADR-045` y la conformidad del autor de Tero. Para **encender la
moderación para el público**, además: D5 y D6 resueltos y asesoría legal (§5).

---

## 8. Texto listo para pegar en el Registro de Decisiones de Notion

> **ADR-044 — Moderación híbrida y automatización.** Estado: Propuesta. Problema: el contenido
> multimedia se publica sin revisión; el equipo es de 4 personas. Opciones: (a) moderación a posteriori,
> (b) n8n como motor, (c) Flask decide y la IA solo propone señales. Recomendación: (c). Flask y
> PostgreSQL deciden; la IA clasifica y recomienda, nunca sanciona; cuentas nuevas con controles
> reforzados 7 días; apelaciones por persona distinta en 72 h; moderadores con 2FA y roles separados;
> reportes críticos por Resend sin n8n; n8n Cloud preferido (sin contratar); imágenes: evaluar Amazon
> Rekognition; abuso infantil y asesoría legal pendientes; Reels sigue bloqueado. Primera
> implementación: `moderation_status`, `moderation_jobs`, auditoría, con flag apagado.
> Documentos: `docs/architecture/ADR-044-moderation-and-automation.md`, `ADR-045-shared-ai-provider.md`,
> `MODERATION_APPROVAL_MATRIX.md`, `MODERATION_IMPLEMENTATION_SCOPE.md`. **Ventana de discusión: 24 h.**
