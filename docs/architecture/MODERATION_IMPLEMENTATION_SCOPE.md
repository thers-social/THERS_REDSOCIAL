# Alcance de la primera implementación de moderación, criterios de aceptación y regresión

| Campo | Valor |
|---|---|
| Documento | `docs/architecture/MODERATION_IMPLEMENTATION_SCOPE.md` |
| Fecha | 2026-10-18 |
| Base | `origin/develop` `db84edc` |
| Estado | **No se programa nada de esto hasta ratificar `ADR-044`** (ver `MODERATION_APPROVAL_MATRIX.md` §7) |
| Depende de | `ADR-044` v2; `ADR-045` v2 solo para el Incremento 3 |

---

## 1. Principios

1. **Aditivo y apagado:** todo entra detrás de `MODERATION_ENABLED` (apagado por defecto, mismo patrón
   `_flag_env` de `config.py`). Con el flag apagado, el comportamiento de `develop` no cambia.
2. **Falla cerrado:** lo nuevo, dudoso o con error nunca pasa a `approved` por accidente.
3. **Lo antiguo sigue visible:** la migración marca `approved` el contenido existente.
4. **Un PR, una cosa** (`HB-001` §9): tres incrementos, tres ramas, cada una desde `origin/develop`.
5. **Sin proveedores reales:** clasificadores simulados; ninguna credencial, ninguna llamada de red.
6. **No se toca** `application/tero`, `domain/tero`, `infrastructure/ai`, `tero_routes.py` ni
   `mobile/src/features/tero`.

## 2. Incrementos

| Incremento | Contenido | Rama sugerida | Requiere ratificar |
|---|---|---|---|
| **1 — Base** | Estado, trabajos, resultados, auditoría, motor de políticas, worker, flag | `feature/moderation-core` | `ADR-044` |
| **2 — Personas** | `moderation_role`, 2FA obligatoria, endpoints y pestañas Retenidos / Auditoría, apelaciones, estadísticas | `feature/moderation-panel` | `ADR-044` |
| **3 — IA de texto** | Registro de propósitos, `ai_usage`, `AiProviderTextClassifier`, `FakeTextClassifier` | `feature/moderation-ai-text` | `ADR-044` + `ADR-045` |
| Después | Puerto `ImageClassifier` real (Rekognition), n8n, Historias, video | — | Contratación y aprobaciones propias |

## 3. Alcance del Incremento 1

### 3.1 Migraciones (una por tema, aditivas, colgando de la cabeza única de `develop`)

| Migración | Cambio | Reversión |
|---|---|---|
| `moderation_status` | `media_attachments` gana `moderation_status` (`pending`/`approved`/`held`/`rejected`, con `CHECK`), `moderation_decided_by` (texto: `auto` o id de usuario, nullable) y `moderation_decided_at`. Se agrega con `DEFAULT 'approved'` para rellenar las filas existentes y **a continuación** se cambia el valor por defecto a `pending` | `downgrade` elimina las columnas |
| `moderation_jobs` | `id`, `kind`, `subject_type`, `subject_id`, `idempotency_key` **único**, `status` (`queued`/`running`/`succeeded`/`failed`/`dead`), `attempts`, `next_attempt_at`, `locked_by`, `locked_at`, fechas. Índice parcial por `(status, next_attempt_at)`. **Payload mínimo: identificadores, no contenido** | `drop_table` |
| `moderation_results` | `job_id`, `provider`, `model_version`, `categories` (JSONB), `scores` (JSONB), fechas. **Sin el contenido evaluado** | `drop_table` |
| `audit_actor_kind` | `admin_audit_log.actor_kind` (`human`/`system`, por defecto `human`) | `drop_column` |

`ON DELETE` coherente con `ADR-031`: los trabajos y resultados del contenido eliminado se borran en
cascada; la auditoría sobrevive (`actor_id` ya es `SET NULL`).

### 3.2 Código

| Capa | Pieza |
|---|---|
| `domain/moderation/` | Estados y transiciones válidas; `PolicyEngine` (función pura: señales + edad de cuenta + historial + reportes → decisión `approved`/`held`/`pending`, **nunca** `rejected`); puertos `ImageClassifier` y `TextClassifier` |
| `application/moderation/` | Caso de uso «encolar al crear contenido» (misma transacción); `process_job` idempotente; caso de uso «decisión humana» (solo aprobar o mantener retenido en este incremento) |
| `infrastructure/persistence/` | Modelos y repositorios; reclamo con `FOR UPDATE SKIP LOCKED`; reintentos con espera creciente; estado `dead` |
| `infrastructure/moderation/` | `FakeImageClassifier` y `FakeTextClassifier` (deterministas, configurables en pruebas) |
| `interfaces/` | Comando de CLI `flask moderation-worker` (un ciclo o bucle) |
| `config.py` | `MODERATION_ENABLED` (apagado), `MODERATION_NEW_ACCOUNT_DAYS` (7), `MODERATION_MAX_ATTEMPTS`, `MODERATION_BACKOFF_SECONDS` |
| Visibilidad | Con el flag encendido, `media_attachment_repository` y los serializadores de `post_routes`/`message_routes` omiten, para terceros, las imágenes cuyo `moderation_status` no sea `approved`. La persona autora las ve con su estado. **Se oculta la imagen, no la publicación** (decisión N6, pendiente de confirmar) |

### 3.3 Fuera del Incremento 1

Panel, roles, apelaciones, estadísticas, IA real, Rekognition, n8n, Mux, Historias, mensajes de texto,
comentarios y reportes de nuevos tipos. **Sin endpoints HTTP nuevos**; no cambia `API_CONTRACT.md` salvo
una nota sobre el campo `moderation_status` visible para la persona autora, si se decide exponerlo.

### 3.4 Límite conocido que no se resuelve aquí

Las imágenes viven en un bucket público: ocultar la imagen en la API **no impide** abrirla a quien ya
tenga la URL (riesgo 1 del PR de Historias y de `ADR-039`). Mitigarlo exige URLs firmadas
(`ADR-044` §2.6, «vista previa firmada»), que se evalúan en el Incremento 2. Debe quedar escrito en la
descripción del PR; no se declara resuelto.

## 4. Criterios de aceptación (Incremento 1)

Todos con **PostgreSQL real y desechable** (la convención de `backend/tests/conftest.py`), nunca con
mocks de base de datos ni contra una base compartida.

| # | Criterio | Tipo de prueba |
|---|---|---|
| A1 | Con `MODERATION_ENABLED` apagado, subir una imagen deja `approved` y **ninguna** respuesta de la API cambia | Integración |
| A2 | Con el flag encendido, una imagen nueva queda `pending` y **no** aparece a terceros en publicaciones, mensajes ni reseñas | Integración |
| A3 | Las filas anteriores a la migración quedan `approved` y se siguen viendo | Migración + integración |
| A4 | Si el código inserta una fila sin fijar el estado, queda `pending` (no `approved`) | Integración |
| A5 | El trabajo se crea en la misma transacción que el contenido; si falla el contenido, no queda trabajo huérfano | Integración |
| A6 | Dos workers concurrentes nunca reclaman el mismo trabajo | Concurrencia |
| A7 | Un evento duplicado (misma `idempotency_key`) no crea un segundo trabajo ni un segundo resultado | Integración |
| A8 | Un trabajo que falla se reintenta con espera creciente y, agotados los intentos, pasa a `dead` dejando el contenido `pending` o `held` | Integración |
| A9 | Error del clasificador, respuesta fuera de esquema o tiempo excedido **nunca** producen `approved` | Unitaria + integración |
| A10 | El motor de políticas **nunca** devuelve `rejected` ni una sanción | Unitaria (propiedades) |
| A11 | Cuenta de menos de 7 días con señal media → `held`; cuenta antigua con señal baja → `approved`; señal grave → `held` con prioridad `critical` | Unitaria |
| A12 | Toda transición de estado deja una fila en `admin_audit_log` con `actor_kind` correcto y **sin contenido** | Integración |
| A13 | `moderation_results` y el payload del trabajo no contienen texto ni bytes del contenido | Integración |
| A14 | Una decisión humana solo la puede tomar quien tenga el rol; el rechazo responde `404`/`403` según la convención de `moderator_required`, **validado en el backend** | Permisos |
| A15 | Migraciones: `upgrade` sobre base vacía, sobre el estado de `develop` y sobre datos reales de prueba; `downgrade` con destino explícito sin perder otras tablas; `flask db heads` devuelve **una** cabeza | Migración |
| A16 | Eliminar una cuenta borra sus trabajos y resultados y conserva la auditoría (`ADR-031`) | Integración |

## 5. Pruebas de regresión que protegen lo existente

Se ejecutan **sin modificarlas**; si una falla, el cambio está mal, no la prueba.

| Área | Suite existente | Qué protege |
|---|---|---|
| Tero | `backend/tests/tero/` (4 archivos) y `mobile/tests/teroCards.test.mjs`, `teroExpressions.test.mjs` | Que el flag, `ai_usage` y la fábrica de propósitos no alteran a Tero. `git diff origin/develop` no debe listar archivos de Tero |
| Historias | `backend/tests/` de Historias en `feature/stories-integration` (35 pruebas, flag apagado y encendido) | Compatibilidad. **Se ejecutan en una rama temporal de integración** (merge local, nunca push), porque Historias aún no está en `develop` |
| Autenticación | `test_auth.py`, `test_registration.py`, `test_refresh_tokens.py`, `test_security.py`, `test_minimum_age.py`, `test_google_auth.py` | Registro, login, sesión y refresh. La edad de la cuenta (7 días) se lee de `users.created_at`, sin tocar el flujo de registro |
| Publicaciones | `test_posts.py`, `test_post_message_images.py`, `test_comments.py`, `test_likes.py`, `test_privacy.py` | Que publicar, ver y borrar siguen igual con el flag apagado, y que las antiguas se ven con él encendido |
| Mensajes | `test_messages.py`, `test_messages_sync.py` | Imágenes en mensajes y sincronización |
| Moderación y reportes | `test_moderation.py`, `test_reports.py`, `test_reports_child_safety.py`, `test_suggestions_hide_moderation.py` | La cola de reportes, la prioridad `critical` y `is_moderator` siguen funcionando |
| Cuenta y datos | `test_account_deletion.py`, `test_data_exports.py`, `test_retention.py` | `ADR-031`, `ADR-028`, `ADR-037` |
| Límites de uso | `test_rate_limiting.py` | `ADR-027` |
| Total | `python -m pytest` completo | 2032 pruebas en `feature/stories-integration` según su PR; la cifra en `develop` debe reconfirmarse al empezar, **no se asume** |
| Web | `npm test`, `npm run build`, `npm run lint` en `Frontend/` | Solo si se toca el panel (Incremento 2). Existe 1 error de lint **previo** en `tests/moderation.test.mjs` |
| Móvil | `npm run typecheck`, `npm test` en `mobile/` | Solo si cambia un contrato que consuma |

Verificaciones transversales de cada PR: una sola cabeza de Alembic; `STORIES_ENABLED`,
`TERO_*` y `MODERATION_ENABLED` con los valores por defecto del PR; sin secretos ni `print`;
`DATABASE_ARCHITECTURE.md` actualizado el mismo día (`HB-001` §15.1); exportación (`ADR-028`) y
eliminación de cuenta (`ADR-031`) revisadas.

## 6. Criterios adicionales por incremento

**Incremento 2 (personas):** acceso de moderación denegado sin 2FA activa; un moderador no revisa su propia
apelación ni la de una decisión suya; la autorización se prueba con llamadas directas a la API sin pasar
por el frontend; el rol `reviewer` no ve contenido de la cola `child_safety`; el reporte `critical` sale
por Resend con n8n apagado y el trabajo de envío es idempotente.

**Incremento 3 (IA de texto):** un propósito no gasta el contador de otro; `moderation_text` no recibe
nunca historial de Tero ni herramientas; la salida inválida produce `unclassified` y nunca `approved`;
el registro de `ai_usage` no guarda texto; tope agotado → `held`, no `approved`; pruebas de Tero en verde
sin modificarlas; todo con `FakeTextClassifier`, sin red.

## 7. Riesgos de la implementación

1. **Cola desatendida** → el contenido nuevo queda retenido y los usuarios lo notan. Por eso el flag no
   se enciende sin D5 resuelto (`MODERATION_APPROVAL_MATRIX.md` §5).
2. **Migraciones concurrentes** con las ramas de Historias y Tero: cada migración nueva debe rebasarse
   sobre la cabeza vigente de `develop` antes del PR.
3. **Rendimiento** de la condición de visibilidad en listados: se cubre con un índice y se mide en la
   prueba A2 antes de fusionar.
4. **Bucket público** (§3.4).
