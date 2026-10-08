# DATABASE_ARCHITECTURE

| Campo | Valor |
|---|---|
| Documento | `docs/architecture/DATABASE_ARCHITECTURE.md` |
| Identificador propuesto | `DB-001` (sigue el patrón `HB-001`/`ARC-001`/`DS-001`/`WF-001`/`PV-001`/`FAS-001`) — **pendiente de ratificación formal** |
| Versión | 0.29 |
| Estado | **Borrador / Contrato técnico — pendiente de aprobación del equipo** |
| Depende de | `HB-001` (organización, gobernanza, git flow, seguridad), `REPOSITORY_STRUCTURE.md` (ubicación del backend y carpeta futura `database/`) |
| Motivo | El `CLAUDE.md` maestro (§4, §14) identificó que la arquitectura de Base de Datos no estaba formalmente documentada |
| Idioma | Español (documentación oficial), identificadores/código en inglés |

> ⚠️ **Nota de alcance y honestidad de fuentes.** Este documento es un **contrato técnico previo a la implementación**, no una descripción de un esquema ya existente. Al momento de escribirlo (v0.1), el backend **no tenía base de datos, ni ORM, ni driver de PostgreSQL instalado**: la autenticación funcionaba contra credenciales hardcodeadas (ver §4). Todo lo que aquí se define como "decidido" se limita a lo que la documentación oficial ya respalda o a lo que el estado real del código justifica de forma evidente. Todo lo demás está marcado explícitamente como **PENDIENTE DE APROBACIÓN** (§14). No se inventan entidades, columnas, índices ni políticas que el proyecto no necesite hoy.
>
> **v0.21 — rate limiting (`ADR-027-rate-limiting.md`):** una migración (`b6e3a9d4f270`) y una tabla nueva, `rate_limit_buckets` (§5.15). Cierra el ítem 8 de `API_CONTRACT.md` §9, que v0.24 de aquel documento había registrado como pendiente tras descubrir que en `POST /api/2fa/verify` la ausencia de límite era explotable.
>
> Contador de ventana fija: una fila por (`scope`, `identity_hash`) con `window_started_at` y `attempts`. Tres decisiones de modelo que vale la pena destacar:
>
> · **La identidad se guarda hasheada** (SHA-256, `CHAR(64)`), no en claro. La tabla solo necesita **contar**, nunca saber de quién: guardar emails e IPs en claro acumularía datos personales en una tabla puramente operativa cuando un hash cumple la misma función. SHA-256 y no scrypt porque acá no se protege un secreto de baja entropía contra fuerza bruta offline (como `password_hash`), solo se evita el dato en claro -- y corre en el camino caliente de cada intento de login.
>
> · **Sin FK a `users`**, a propósito: la identidad puede ser una IP, o el email de una cuenta **que no existe**. Un intento de login contra un email inventado también tiene que contar, porque si no se podría enumerar cuentas sin límite. Atarla a `users` dejaría fuera justo los casos que más interesa limitar. Es la única tabla del esquema sin ninguna relación con el resto.
>
> · **Es la única entidad que no modela un hecho del producto** sino una defensa operativa: no aparece en ninguna respuesta de la API, y su contenido es descartable (purgarla no pierde información de nadie).
>
> El incremento es una sola sentencia (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`): crear la fila, reiniciar la ventana vencida y sumar el intento son atómicos, porque la concurrencia es precisamente el escenario de un ataque de fuerza bruta. Nuevo índice `ix_rate_limit_buckets_window_started_at` (§8) -- no lo necesita el UPSERT (ese va por la UNIQUE) sino la purga de ventanas vencidas. Verificado con un ciclo `flask db upgrade`/`downgrade`/`upgrade` contra PostgreSQL 16 real sobre `thers_dev` y `thers_test`, más la suite completa (`backend/tests/`, 476 pruebas).
>
> **v0.20 — pantalla de Seguridad: registro de sesiones y 2FA (`ADR-025-session-registry.md`, `ADR-026-two-factor-authentication.md`):** dos migraciones (`f1a4c8e2d573`, `a3c9f5b1e648`), dos tablas nuevas y tres columnas.
>
> Nueva tabla **`sessions`** (§5.13), y es **el cambio con más alcance de todo el modelo hasta ahora**: no agrega una entidad al margen, cambia qué significa que un JWT sea válido. `user_id` (FK a `users`, CASCADE), `jti` (`VARCHAR(36)` con `UNIQUE uq_sessions_jti` — el identificador que flask_jwt_extended ya pone en cada token), `user_agent` (`TEXT`, crudo y sin parsear), `ip_address` (`VARCHAR(45)`, longitud máxima de una IPv6 en texto), `created_at`, `last_used_at` (con throttle de 5 min en el propio WHERE, igual que `users.last_seen_at` de ADR-024) y `revoked_at` (nullable, `NULL` = viva). **Revocar marca, no borra:** la fila se conserva para que la heurística de "dispositivo conocido" siga sabiendo que ese navegador ya se había visto -- si se borrara, cerrar sesión y volver a entrar desde el mismo equipo generaría una alerta falsa de dispositivo nuevo. Nuevo índice `ix_sessions_user_id_created_at` (§8): la UNIQUE de `jti` cubre el acceso caliente (una búsqueda por token en cada petición protegida) pero no el de listar las sesiones de una persona, que lidera por otra columna.
>
> Nueva tabla **`two_factor_recovery_codes`** (§5.14): `user_id` (FK, CASCADE), `code_hash` (scrypt), `created_at`, `used_at` (nullable, `NULL` = sin usar; se marca en vez de borrar para poder informar cuántos quedan). Sin `UNIQUE` sobre `code_hash`: scrypt usa sal, así que una UNIQUE no garantizaría nada. Nuevo índice `ix_two_factor_recovery_codes_user_id`.
>
> `users` gana tres columnas (§5.1): `login_alerts_enabled` (`BOOLEAN NOT NULL DEFAULT true` -- nace **activada**, porque una alerta de seguridad que hay que descubrir y encender no protege a nadie), `two_factor_enabled` (`BOOLEAN NOT NULL DEFAULT false`) y `totp_secret` (`TEXT`, nullable). **`totp_secret` se guarda recuperable, no hasheado, y es inevitable:** verificar un código TOTP exige recalcularlo a partir del secreto, así que un hash lo haría inservible. Es la diferencia estructural con los OTP de ADR-010/ADR-011, que sí se hashean porque el código viaja una vez y solo hay que compararlo. La consecuencia (una fuga de `users` permite generar códigos válidos) está registrada en `ADR-026` §Riesgos, sin cifrado en reposo porque la clave de cifrado acabaría en la misma base o en el mismo `.env` mientras no haya gestión de secretos (`CLAUDE.md` §15).
>
> `two_factor_enabled` está **separada** de `totp_secret` a propósito: durante el alta existe un secreto todavía sin confirmar (alguien escaneó el QR pero no probó que su app genera códigos correctos). Sin esa separación, escanear y abandonar dejaría la cuenta exigiendo un código que nadie puede producir.
>
> Vigesimoprimera a vigesimotercera relación real entre entidades (§6): `sessions.user_id → users.id` y `two_factor_recovery_codes.user_id → users.id`. Verificado con un ciclo `flask db upgrade`/`downgrade`/`upgrade` contra PostgreSQL 16 real sobre `thers_dev` y `thers_test`, más la suite completa (`backend/tests/`, 456 pruebas).
>
> **v0.19 — pantalla de Privacidad: cuentas privadas, menciones y filtros de contenido (`ADR-022-private-accounts.md`, `ADR-023-mentions.md`, `ADR-024-content-filters-and-privacy-preferences.md`):** **la revisión con más cambios de esquema desde la creación de `users`** — tres migraciones (`c3e7b1d9a482`, `d5f9c3e1b764`, `e7b2d4f8c916`), dos tablas nuevas y siete columnas. Resuelve "Menciones" (§4.B › Notificaciones) y habilita la primera regla de **autorización de lectura** del modelo: hasta ahora el esquema decía quién era cada uno, nunca qué podía ver.
>
> `users` gana seis columnas de preferencias (§5.1): `is_private` (`BOOLEAN NOT NULL DEFAULT false`), `who_can_mention`/`who_can_message` (`VARCHAR(20) NOT NULL DEFAULT 'everyone'`), `hide_offensive_comments` (`BOOLEAN NOT NULL DEFAULT false`), `show_activity_status` (`BOOLEAN NOT NULL DEFAULT true`) y `last_seen_at` (`TIMESTAMPTZ`, nullable). Todos los DEFAULT preservan el comportamiento previo salvo `show_activity_status`, que nace en `true` porque hasta ahora no existía ningún dato de presencia — `last_seen_at` arranca en `NULL` para todo el mundo, así que no expone nada retroactivo.
>
> `follows` gana `status` (`VARCHAR(20) NOT NULL DEFAULT 'accepted'`, §5.5): un follow deja de ser un hecho binario y pasa a tener dos estados ('pending'/'accepted'). El DEFAULT hace de **backfill** — todo follow previo se hizo hacia una cuenta pública, así que ya estaba aceptado de hecho. La `UNIQUE (follower_id, followed_id)` **no cambia**, y es justamente lo que garantiza que una misma pareja nunca tenga a la vez una solicitud pendiente y un follow aceptado: son dos estados de la misma fila, no dos filas (`ADR-022` §Opciones consideradas, descarta una tabla `follow_requests` aparte).
>
> Nueva tabla **`mentions`** (§5.11): `mentioned_user_id`+`author_id` (FKs a `users`) y `post_id`/`comment_id` (FKs, ambas nullable) con la **tercera `CHECK` del esquema** (`ck_mentions_exactly_one_target`: `(post_id IS NULL) <> (comment_id IS NULL)`), después de `ck_follows_no_self_follow` (ADR-007) y `ck_messages_no_self_message` (ADR-013) — una tabla con dos targets posibles en vez de dos tablas casi idénticas. Dos `UNIQUE` **parciales** (`uq_mentions_user_post`/`uq_mentions_user_comment`, con `WHERE ... IS NOT NULL`): una `UNIQUE` no parcial sobre las tres columnas no impediría nada, porque en PostgreSQL dos filas con `NULL` en una columna del índice no se consideran duplicadas. Más `ix_mentions_post_id`/`ix_mentions_comment_id`. Sin `updated_at` ni `edited_at`: una mención no se edita — si se edita el texto que la contenía, las menciones se **recalculan**.
>
> Nueva tabla **`muted_keywords`** (§5.12): `user_id` (FK) + `keyword` (`VARCHAR(100)`, normalizada a minúsculas por la aplicación) con `UNIQUE (user_id, keyword)`. Tabla y no un array/JSON en `users` porque hay que poder preguntar "¿algún término de este usuario aparece en este texto?" **desde el mismo WHERE** que lista posts/comentarios — con un array habría que filtrar en Python después del LIMIT, que es lo que devuelve páginas cortas. Sin índice extra: la UNIQUE ya lidera por `user_id`, el único patrón de acceso real (mismo razonamiento que `likes`, ADR-005 §Índices).
>
> Decimoséptima a vigésima relación real entre entidades (§6): `mentions` referencia dos veces a `users` y una a `posts`/`comments`; `muted_keywords` referencia una vez a `users`. Verificado con un ciclo completo `flask db upgrade`/`downgrade`/`upgrade` contra PostgreSQL 16 real sobre `thers_dev` y `thers_test`, más la suite completa de pruebas (`backend/tests/`, 414 pruebas).
>
> **v0.18 — edición de contenido propio: `edited_at` en `posts`, `comments` y `messages` (`ADR-021-content-editing.md`):** "Editar / Eliminar publicaciones" (§4.B › Contenido) queda **resuelta por completo** — el borrado ya lo había cubierto `ADR-019`/`ADR-020`, y la edición la cubre este ADR. **Primera migración que modifica tres tablas ya implementadas a la vez** (`a2c6e9b3f571`): una columna `edited_at` (`TIMESTAMPTZ`, nullable, `NULL` = nunca editado) en `posts` (§5.2), `comments` (§5.4) y `messages` (§5.10). Se expone en la API como el booleano `edited`, nunca como el timestamp crudo — mismo criterio que `notifications.read_at`/`messages.read_at` (`API_CONTRACT.md` §5, v0.22). **No se reutilizó `updated_at`** para esto, aunque `posts`/`comments` ya la tenían: nace igual a `created_at` por su `server_default`, así que "editado" habría que inferirlo de `updated_at > created_at` — una condición implícita que cualquier escritura futura sobre la fila volvería falsa (`ADR-021` §Opciones consideradas, opción B descartada). `updated_at` sigue siendo solo auditoría y sigue sin exponerse; `messages` sigue **sin** `updated_at`. Ninguna entidad, FK, `UNIQUE`, `CHECK` ni índice cambia — la columna es puramente aditiva y nullable, así que las filas existentes quedan en `NULL` sin *backfill*. Verificado con `flask db upgrade` contra PostgreSQL 16 real sobre `thers_dev` y `thers_test`, más la suite completa de pruebas (`backend/tests/`, 338 pruebas).
>
> **(rama `develop`, antes numerada v0.18) — refresh tokens rotativos, `refresh_tokens` (`ADR-017-jwt-session-policy.md`):** nueva entidad implementada (definición formal en §5.16). Una fila por refresh token emitido; cada login abre una familia (`family_id`) y cada renovación consume la fila vigente y crea la siguiente. Se guarda el **SHA-256 del `jti`**, nunca el token. Índice único parcial `uq_refresh_tokens_active_family` (a lo sumo un token activo por familia, mismo patrón que `ADR-010`). Migración `b7d41e9a3c52`, que encadena con `a5c8e2d71f34` (`ADR-015`, aún sin commitear a esta fecha). `ON DELETE CASCADE` desde `users`.
>
> **v0.27 — moderación de la plataforma (`ADR-032` fase 2):** columnas nuevas en `users`: `is_moderator` (`BOOLEAN NOT NULL DEFAULT false`), `suspended_at` (`TIMESTAMPTZ`, nula) y `suspension_reason` (`VARCHAR(500)`, nula). Migración `e5b8c3a7d912`, hija de `d4a9b6c1e275`. Aditiva y no destructiva: las cuentas existentes quedan como no moderadoras y no suspendidas.
>
> **v0.26 — sincronización del chat (`ADR-035`):** columna `messages.client_id` (`VARCHAR(64)`, nula) e índice único parcial `uq_messages_sender_client_id (sender_id, client_id) WHERE client_id IS NOT NULL`. Migración `d4a9b6c1e275`, hija de `c3f7a9d2e841`. Aditiva y no destructiva.
>
> **v0.25 — eliminación de cuenta (`ADR-031`):** tabla nueva `account_deletion_codes` (migración `c3f7a9d2e841`, hija de `b6e1d9a4c2f8`): `id`, `user_id` (FK `users` `ON DELETE CASCADE`), `code_hash` (scrypt), `attempts`, `expires_at`, `used_at`, `created_at`, con índice único parcial `uq_account_deletion_codes_active_user` (a lo sumo un código activo por cuenta). **Regla vigente:** toda clave foránea hacia `users` es `ON DELETE CASCADE`, salvo las de `reports` (`SET NULL`, a propósito); `tests/test_account_deletion.py` recorre `pg_constraint` y falla si una tabla nueva no lo cumple, y exige que ninguna columna `*user_id` quede sin clave foránea.
>
> **v0.24 — prioridad de los reportes (`ADR-038-child-safety-reports.md`):** columna aditiva `reports.priority` (`VARCHAR(10)`, `NOT NULL`, `DEFAULT 'normal'`, `CHECK IN ('normal', 'critical')`) e índice `ix_reports_status_priority_created_at`. Migración `b6e1d9a4c2f8`, **no destructiva**: los reportes existentes quedan como `normal`. El motivo `child_safety` **no** necesita migración (el motivo es un texto validado en la aplicación).
>
> **v0.23 — reportes y aceptación de términos (`ADR-032-content-reports-and-moderation.md`, fase 1, **PROPUESTO**, implementado en una rama sin mergear):** nueva entidad `reports` (§5.17) y dos columnas aditivas en `users` (`terms_accepted_at`, `terms_version`, ambas nulas: las cuentas existentes cuentan como no aceptadas). Migración `a8d2f5c1b937`. `reporter_id`, `reported_user_id` y `resolved_by` son `ON DELETE SET NULL`, **no** `CASCADE`: un reporte debe sobrevivir a la eliminación de las cuentas involucradas (`ADR-031`). **Ojo con `ADR-031`:** su prueba de claves foráneas debe aceptar este `SET NULL` como excepción explícita. Las columnas de moderación y suspensión (`is_moderator`, `suspended_at`, ...) NO están: son de la fase 2.
>
> **v0.22 — integración de `refresh_tokens` (`ADR-017`) con el registro de sesiones (`ADR-025`):** una migración (`f8c2d6a4b190`) que une las dos ramas de migraciones y agrega `sessions.refresh_family_id` (`UUID`, nullable, índice `ix_sessions_refresh_family_id`). Enlaza cada fila de `sessions` con la familia de refresh tokens de su login: hay **una fila de `sessions` por login**, y al renovar el access token esa fila se re-vincula a su `jti` nuevo en vez de crear otra. Es lo que hace que cerrar una sesión desde Ajustes también corte su refresh token (la renovación exige una sesión viva en la familia). `refresh_tokens` pasa a ser la sección §5.16 para no chocar con `mentions` (§5.11).
>
> **v0.17 — mensajes directos, `messages` (`ADR-013-messages-minimal-model.md`):** "Conversaciones (privadas y grupales), Participantes" + "Mensajes" (§4.B › Mensajería) se resuelve **solo a medias** — pasa a **implementada** (§4.A, §5.10) únicamente la mitad 1:1: mensaje directo entre dos usuarios reales, sin la tabla puente `conversation_participants` que soportaría grupos (sigue sin ratificar). Nueva tabla `messages`: `sender_id`/`recipient_id` (FKs a `users`, ambas `ON DELETE CASCADE`), `content` (texto, sin límite de esquema — validado en la aplicación, máximo 2000 caracteres), `read_at` (`TIMESTAMPTZ`, nullable, `NULL` = no leído, mismo criterio que `notifications.read_at`), sin `updated_at` (mismo criterio que `likes`/`follows`/`notifications`). **Segunda `CHECK` constraint del esquema** (`ck_messages_no_self_message`: `sender_id <> recipient_id`, mismo criterio que `ck_follows_no_self_follow`). Sin `UNIQUE` — dos mensajes entre las mismas personas son eventos legítimos, no un duplicado a impedir (mismo criterio que `notifications`). Dos índices compuestos nuevos, `ix_messages_sender_recipient_created`/`ix_messages_recipient_sender_created` (§8) — el hilo entre A y B se busca con un `OR` sobre ambos sentidos de la relación, que ninguna `UNIQUE` cubre. Decimocuarta y decimoquinta relación real entre entidades (§6): `messages.sender_id → users.id`, `messages.recipient_id → users.id`. Migración `f7a2c9e4d1b8`. Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 263 pruebas).
>
> **v0.3 — cierre de la capa de persistencia (auditoría y validación real de esta tarea).** Se corrigió la referencia a una instalación nativa de PostgreSQL 17.11 (no reproducible por el equipo) por el entorno estandarizado real: **PostgreSQL 16 vía Docker Compose** (`docker-compose.yml`, raíz del repo, imagen `postgres:16-alpine`), verificado end-to-end (`flask db upgrade`/`downgrade` repetidos, INSERT sin `id` confirmando `gen_random_uuid()` en PostgreSQL, UPDATE confirmando el trigger de `updated_at`, unicidad case-insensitive de `email` vía `CITEXT`, y reconstrucción completa desde un volumen Docker vacío). Se marcó como resuelta la herramienta de migraciones (§9) donde el documento aún decía `PENDIENTE`, pese a que Flask-Migrate/Alembic ya estaba implementado. Ningún esquema, entidad ni columna cambió — solo se sincronizó el documento con el código real ya existente.
>
> **v0.4 — integración de autenticación con persistencia real.** `users` pasó de "modelo implementado pero no conectado" a **en uso real**: `POST /api/register` y `POST /api/login` (`BACKEND_ARCHITECTURE.md` §8/§9, v0.6) ya crean/consultan filas reales, y la credencial hardcodeada (`test@test.com`/`123456`) se eliminó del código por completo. Reflejado en §4 y §5. No se agregó ninguna entidad, columna ni índice nuevo — sigue siendo únicamente `users`, sin cambios de esquema.
>
> **v0.5 — columnas de perfil ratificadas por ADR (THERS Backend Fase 2.1).** `username`, `phone`, `country_code` y `birth_date` pasan de **OBJETIVO** (§4.B) a **IMPLEMENTADAS** en `users`, ratificado por `ADR-002-user-profile-fields.md` — el ADR que esta misma sección (v0.2–v0.4) ya pedía antes de tocar el esquema. Migración `a1edcbff74d8_add_profile_fields_to_users.py`, verificada con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real (`thers_dev`, Docker) y con 27 pruebas de integración (`backend/tests/`). `username` es único (`uq_users_username`) pero **no** usa `CITEXT` (a diferencia de `email`) — decisión explícita en `ADR-002` §3, no una omisión. `avatar_url`/`bio` (§4.B) siguen sin ratificar. Reflejado en §4.A, §4.B y §5.
>
> **v0.6 — soporte de cooldown para `PATCH /api/users/me` (THERS Backend, `ADR-003-profile-update-contract.md`).** `users` gana `username_changed_at` (`TIMESTAMPTZ`, nullable), migración aditiva `b2f4a19c3d7e_add_username_changed_at_to_users.py`, verificada con `flask db upgrade`/`downgrade` repetidos contra PostgreSQL 16 real (`thers_dev`, Docker) y con la suite completa de pruebas (`backend/tests/`, 52 pruebas). `NULL` significa "nunca cambió su username" — sin backfill, ningún usuario existente pudo cambiar su username antes de esta tarea. `ADR-003` decidió explícitamente **no** crear ninguna columna nueva más allá de esta (`bio`/`avatar_url` siguen sin ratificar, `email`/`password` quedan fuera del contrato de `PATCH`). Reflejado en §5.
>
> **v0.7 — auditoría documental integral de THERS (corrección de un hallazgo obsoleto, sin cambios de esquema).** §11 y §14 seguían advirtiendo `JWT_SECRET_KEY = "super-secret-key"` **hardcodeado** en `backend/app/config.py` como hallazgo de seguridad abierto — ya corregido desde `BACKEND_ARCHITECTURE.md` v0.2 (lee `os.environ.get("JWT_SECRET_KEY")`, con un fallback de desarrollo explícitamente inseguro advertido por `stderr`, nunca un literal hardcodeado). El propio `ADR-003-profile-update-contract.md` (§Estado actual) ya había señalado esta desincronización entre documentos hermanos sin corregirla, por estar fuera de su alcance. Verificado en esta auditoría releyendo `backend/app/config.py` línea por línea. Ningún esquema, entidad ni columna cambió — solo se sincronizaron §11 y §14 con el código real.
>
> **v0.8 — primera entidad social real, `posts` (`ADR-004-posts-minimal-model.md`):** `posts` pasa de candidata objetivo (§4.B › Contenido) a **implementada** (§4.A, §5.2) — deliberadamente mínima: solo `author_id` (FK a `users`, `ON DELETE CASCADE`) y `content` (texto, máximo 2000 caracteres). Primera relación real entre entidades (§6). Nuevo índice `ix_posts_created_at` (§8), justificado por `GET /api/posts` (§9 se actualiza con la cuarta migración). `visibility`, medios, reacciones, comentarios, hashtags, mood, ubicación, edición/borrado — todo lo demás que §4.B seguía listando junto a "Posts" — sigue sin ratificar, cada uno queda para su propio ADR (`ADR-004` §Decisiones pendientes). Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 71 pruebas).
>
> **v0.9 — segunda entidad social real, `likes` (`ADR-005-likes-minimal-model.md`):** `reactions` (§4.B › Interacciones, "Likes / reacciones") pasa de candidata objetivo a **implementada** (§4.A, §5.3), pero solo en su versión mínima binaria (like/no-like) — la forma general "con tipo" que §4.B seguía describiendo sigue sin ratificar. Nueva tabla `likes`: `post_id`/`user_id` (FKs a `posts`/`users`, ambas `ON DELETE CASCADE`), `UNIQUE (post_id, user_id)` (`uq_likes_post_user`), sin `updated_at` (un like no se edita, solo se crea o se borra). Sin índice adicional — la propia `UNIQUE` ya cubre el patrón de acceso real por `post_id` (§8). Segunda relación real entre entidades (§6): `likes.post_id → posts.id`, `likes.user_id → users.id`. Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 89 pruebas).
>
> **v0.10 — comentarios planos sobre posts, `comments` (`ADR-006-comments-minimal-model.md`):** la candidata combinada "Comentarios + Respuestas a comentarios" (§4.B › Interacciones) se resuelve **solo a medias** — pasa a **implementada** (§4.A, §5.4) únicamente su mitad plana: comentar un post, sin hilos de respuestas (`parent_comment_id` sigue sin ratificar). Nueva tabla `comments`: `post_id`/`author_id` (FKs a `posts`/`users`, ambas `ON DELETE CASCADE`), `content` (texto, máximo 1000 caracteres), con `updated_at`+trigger (mismo patrón de auditoría que `posts`, aunque sin edición todavía). Nuevo índice compuesto `ix_comments_post_id_created_at` (§8), justificado por `GET /api/posts/<id>/comments`. Tercera y cuarta relación real entre entidades (§6): `comments.post_id → posts.id`, `comments.author_id → users.id`. Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 93 pruebas).
>
> **v0.11 — seguir/dejar de seguir, `follows` (`ADR-007-follows-minimal-model.md`):** "Seguir, Dejar de seguir, Seguidores, Seguidos" (§4.B › Relaciones sociales) pasa de candidata objetivo a **implementada** (§4.A, §5.5). Nueva tabla `follows`: `follower_id`/`followed_id` (FKs a `users`, ambas `ON DELETE CASCADE`), `UNIQUE (follower_id, followed_id)` (`uq_follows_follower_followed`), **primera `CHECK` constraint del esquema** (`ck_follows_no_self_follow`: `follower_id <> followed_id`), sin `updated_at` (mismo criterio que `likes`). Primera relación auto-referencial (`users`↔`users`) del modelo. Nuevo índice `ix_follows_followed_id` (§8) — a diferencia de `likes`, sí hace falta un segundo índice porque `followers_count` filtra por la columna no líder de la `UNIQUE`. Quinta y sexta relación real entre entidades (§6): `follows.follower_id → users.id`, `follows.followed_id → users.id`. `users` gana `followers_count`/`following_count` calculados (no columnas propias) expuestos en `GET`/`PATCH /api/users/me`; `posts.author` gana `is_followed_by_me` calculado, expuesto en `GET`/`POST /api/posts`. El feed **sigue sin filtrar por seguidos** — deliberadamente fuera de este ADR (§No objetivos). Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 124 pruebas).
>
> **v0.16 — "Continuar con Google" (`ADR-012-google-sign-in.md`):** "Login con Google" (§4.B › Autenticación y cuenta) pasa de `PENDIENTE DE DECISIÓN` a **implementada** (§4.A, §5.9) — nueva tabla `user_identities` (`user_id`, `provider`, `provider_subject`, `UNIQUE (provider, provider_subject)`), separada de `users` para no acoplar el esquema a un proveedor específico. `users` relaja `phone`/`country_code`/`birth_date`/`password_hash` a `NULLABLE` (Google no entrega los primeros tres; una cuenta Google-only no tiene contraseña local) y gana `profile_completed` (`BOOLEAN DEFAULT true`) — el registro tradicional sigue exigiendo esos campos igual que siempre a nivel de aplicación, así que nunca quedan en `NULL` para una cuenta creada así. Decimotercera relación del esquema: `user_identities.user_id → users.id`, `ON DELETE CASCADE`. Nuevos índices `uq_user_identities_provider_subject`/`ix_user_identities_user_id` (§8). Migración `b1e5d8a4f3c7` (altera `users`, crea `user_identities`; downgrade revierte ambos). Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 242 pruebas).
>
> **v0.15 — verificación obligatoria de email al registrarse, por código OTP de 6 dígitos (`ADR-011-mandatory-email-verification.md`, reemplaza el modelo de enlace de v0.13 para esta entidad):** `email_verification_tokens` se reconstruye (no se duplica), mismo patrón que `password_reset_tokens` en v0.14 -- pierde `token_hash` (SHA-256), gana `code_hash` (scrypt), `attempts` (§5.8). Nuevo índice único **parcial** `uq_email_verification_tokens_active_user` (`user_id`, `WHERE used_at IS NULL`), reemplaza a `uq_email_verification_tokens_token_hash` de v0.13 — garantiza a nivel de motor que nunca hay más de un código activo por usuario. `password_reset_tokens` **no cambia** — sigue exactamente como en v0.14. Migración `a7d3f6c1e8b9` (recrea la tabla; downgrade restaura la forma de v0.13). Sin columnas de autorización temporal (a diferencia de `password_reset_tokens`) — verificar el código es la acción final, no hay un paso sensible posterior que proteger. Estructuralmente separada de `password_reset_tokens`: un código de una tabla nunca verifica el propósito de la otra (`ADR-011` §Decisión, purpose separation). Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 212 pruebas).
>
> **v0.14 — recuperación de contraseña por código OTP de 6 dígitos (`ADR-010-password-reset-otp-flow.md`, reemplaza el modelo de enlace de v0.13 para esta entidad):** `password_reset_tokens` se reconstruye (no se duplica) -- pierde `token_hash` (SHA-256), gana `code_hash` (scrypt, mismo algoritmo que `password_hash`), `attempts`, `verified_at`, `reset_authorization_hash`/`_expires_at` (§5.7). Primer índice único **parcial** del esquema: `uq_password_reset_tokens_active_user` (`user_id`, `WHERE used_at IS NULL`) — garantiza a nivel de motor que nunca hay más de una solicitud activa por usuario, incluso ante dos "Reenviar código" simultáneos. `email_verification_tokens` **no cambia** — sigue exactamente como en v0.13. Migración `f4b8c92a1d67` (recrea la tabla; downgrade restaura la forma de v0.13). Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 189 pruebas).
>
> **v0.13 — recuperación de contraseña y verificación de email (`ADR-009-password-reset-and-email-verification.md`):** "Verificación de correo, Recuperación de contraseña" (§4.B › Autenticación y cuenta) pasa de `PENDIENTE DE DECISIÓN` a **implementada** (§4.A, §5.7, §5.8) — se resuelve como tokens de un solo uso respaldados por tabla (la opción que esa misma sección ya anticipaba). `users` gana `email_verified` (`BOOLEAN`, `DEFAULT false`). Dos tablas nuevas: `password_reset_tokens` y `email_verification_tokens`, misma forma (`user_id`, `token_hash` — SHA-256 del token crudo, nunca el valor en claro —, `expires_at`, `used_at`, `created_at`), separadas porque su política (TTL de 30 min vs. 24 h, cooldown, invalidación al usarse) difiere. Novena y décima entidad del alcance objetivo del producto en pasar a ratificadas. Nuevos índices `ix_password_reset_tokens_user_id_created_at`/`ix_email_verification_tokens_user_id_created_at` (§8). Tres migraciones nuevas y consecutivas: `b8d4f2a917c3` (columna), `c1f6a83d2e59`/`d3a9c47b1f68` (tablas). Verificado con `flask db upgrade`/`downgrade` contra PostgreSQL 16 real y la suite completa de pruebas (`backend/tests/`, 175 pruebas).
>
> **v0.12 — notificaciones, `notifications` (`ADR-008-notifications-minimal-model.md`):** "Likes, Comentarios, Respuestas, Nuevos seguidores, Menciones, Mensajes, Actividad relevante" (§4.B › Notificaciones) pasa **parcialmente** de candidata objetivo a **implementada** (§4.A, §5.6) — solo los tres eventos que el backend ya genera hoy (`like`, `comment`, `follow`); respuestas, menciones y mensajes siguen sin ratificar porque las entidades de las que dependen (hilos de comentarios, `mentions`, `conversations`) tampoco existen todavía. Nueva tabla `notifications`: `recipient_id`/`actor_id` (FKs a `users`, ambas `ON DELETE CASCADE`), `type` (`VARCHAR(20)`, discriminador validado en la aplicación, no `ENUM` de PostgreSQL), `post_id` (FK a `posts`, `ON DELETE CASCADE`, nullable — solo aplica a `like`/`comment`), `read_at` (`TIMESTAMPTZ`, nullable, `NULL` = no leída), sin `updated_at` (mismo criterio que `likes`/`follows`: se crea o se marca leída, nunca se edita de otro modo). Sin `UNIQUE` — a diferencia de `likes`/`follows`, dos notificaciones del mismo tipo/actor/post en momentos distintos son eventos legítimos, no un duplicado a impedir. Nuevo índice compuesto `ix_notifications_recipient_id_created_at` (§8). Octava relación real entre entidades (§6): `notifications.recipient_id → users.id`, `notifications.actor_id → users.id`, `notifications.post_id → posts.id`. Verificado con 21 pruebas nuevas + la suite completa (145/145, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`), más una prueba manual end-to-end contra el backend real.

---

## 1. Propósito y alcance

### Propósito
Establecer un contrato técnico claro y verificable para la **futura** implementación de PostgreSQL en THERS, de modo que cuando el equipo de backend implemente la capa de persistencia lo haga sobre decisiones ya acordadas y no improvisadas durante el desarrollo (mismo principio que `FAS-001` §1: "el código sigue a la documentación, no al revés").

### Alcance
Este documento cubre:
- Motor de base de datos y sus principios de diseño.
- El modelo conceptual de THERS en **tres capas explícitas** (nuevo en v0.2):
  1. **Estado actual implementado** — lo que el código de hoy justifica y ratifica (§4.A).
  2. **Arquitectura objetivo del producto** — el alcance funcional confirmado por el equipo, traducido a *estructuras candidatas de persistencia* **sin decidir todavía su modelado** (§4.B).
  3. **Decisiones de persistencia pendientes** — lo que falta ratificar antes de implementar (§4.C y §14).
- Convenciones de nombres, índices, migraciones, seeds, integridad, seguridad y backups.
- La integración con las capas ya observadas del backend.

> 🔑 **Distinción central (mantener siempre).** Un **requisito funcional** confirmado ("el producto tendrá mensajería") **no es** una **decisión de persistencia** ("mensajería se modela con las tablas X, Y con estas PK/FK y estos tipos"). La capa objetivo (§4.B) registra requisitos confirmados como *candidatos*; solo la ratificación por ADR (`HB-001` §11–12) los convierte en modelo implementable. Este documento **no** cruza esa línea por iniciativa propia.

### Fuera de alcance (explícito)
- **No** define el esquema concreto (tablas, columnas, PK/FK, tipos SQL) de las entidades objetivo de la red social: la capa objetivo (§4.B) solo las lista como **candidatas**, sin decidir su modelado.
- **No** implementa nada: no crea tablas, migraciones, seeds ni instala dependencias (regla de la tarea que originó este documento).
- **No** define DevOps de base de datos (aprovisionamiento del servidor, réplicas, alta disponibilidad): territorio no especificado según `CLAUDE.md` §14.

---

## 2. Motor de base de datos

| Aspecto | Valor | Fuente |
|---|---|---|
| Motor | **PostgreSQL** | `HB-001` (portada del stack) y `REPOSITORY_STRUCTURE.md` §4 |
| Versión | **PostgreSQL 16** (imagen `postgis/postgis:16-3.5-alpine` desde `ADR-040`; antes `postgres:16-alpine`) — entorno de desarrollo local estandarizado vía Docker Compose (`docker-compose.yml`, raíz del repo), reproducible para los 4 integrantes. Reemplaza la nota de v0.2 sobre una instalación nativa de PostgreSQL 17.11 verificada solo en una máquina — esa instancia no era reproducible por el equipo y ya no es la referencia. Versión oficial para un entorno compartido/producción sigue sin ratificación formal (DevOps, `CLAUDE.md` §5) | `docker-compose.yml`; verificado end-to-end en esta tarea (migración, UUID, CITEXT, trigger, downgrade/upgrade, reconstrucción desde volumen vacío) |
| Driver / adaptador Python | **`psycopg` (v3), `psycopg[binary]==3.3.4`** — agregado a `backend/requirements.txt` junto con `Flask-SQLAlchemy` y `Flask-Migrate` | Implementado en código (`BACKEND_ARCHITECTURE.md` §2). **Ratificación formal por el Comité Técnico pendiente de confirmar** (`HB-001` §11.1) — decisión indicada directamente por el Tech Lead Backend, no consensuada por los 4 integrantes en esta tarea |

> ⚠️ **Hallazgo de entorno local (no un cambio de arquitectura, una nota operativa).** En al menos una máquina del equipo, un servicio nativo de PostgreSQL instalado en Windows ya ocupa el puerto `5432` del host, en conflicto con el mapeo de puertos de `docker-compose.yml`. `docker compose ps`/`healthcheck` reportan el contenedor como saludable igualmente (el healthcheck corre *dentro* del contenedor, no prueba el puerto del host), pero cualquier cliente conectando a `localhost:5432` desde el host puede terminar hablando con el Postgres nativo en vez del de Docker, con errores de autenticación confusos. `docker-compose.yml` ya soporta este caso sin modificarse: `ports: "${POSTGRES_PORT:-5432}:5432"` permite fijar `POSTGRES_PORT` (p. ej. `5433`) para evitar el choque, ajustando `DATABASE_URL`/`TEST_DATABASE_URL` al mismo puerto. Ver el informe de la tarea que agregó esta nota para el procedimiento exacto.

### Razones técnicas
La elección de PostgreSQL **ya está tomada** a nivel de organización (`HB-001` la fija como parte del stack y asigna al Tech Lead Backend "Administrar el esquema de base de datos (PostgreSQL) y migraciones"). Este documento **no re-justifica** esa decisión ni añade razones que la documentación no haya declarado; se limita a heredarla.

> ⚠️ **Contradicción detectada — no resuelta aquí.** El `README.md` raíz describe **MySQL** como base de datos, en conflicto directo con PostgreSQL (`HB-001`, `REPOSITORY_STRUCTURE.md`). Por la jerarquía de fuentes (`CLAUDE.md` §3, §14), gana `/docs`: el motor es **PostgreSQL**. La corrección del `README.md` queda fuera del alcance de este documento y debe hacerse en una tarea propia.

---

## 3. Principios de diseño

Estos principios son la guía de decisión para cualquier tabla, columna o índice futuro. Se enuncian junto al problema que resuelven (mismo estilo que `FAS-001` §2) para que no queden como enunciados decorativos.

- **Normalización.** Objetivo de referencia: **3FN** para datos transaccionales, evitando duplicación y anomalías de actualización. La desnormalización puntual (por rendimiento) es una decisión de impacto medio y debe registrarse como ADR (`HB-001` §11–12), no aplicarse por criterio individual.
- **Integridad referencial.** Toda relación entre tablas se expresa con claves foráneas (`FOREIGN KEY`) reales a nivel de motor, no solo por convención de la aplicación. La política de borrado (`ON DELETE`) se decide por relación y se documenta en la definición de cada entidad.
- **Consistencia.** Las reglas de negocio expresables como restricciones de datos (unicidad, no nulos, rangos, enums) viven en el esquema, no solo en la capa de aplicación, para que la base de datos sea la última línea de defensa de la integridad.
- **Seguridad.** Ningún secreto ni credencial vive en el repositorio (`HB-001` §19.1, §20). Los datos sensibles (p. ej. contraseñas) nunca se almacenan en claro (ver §11). El acceso a la base se hace con credenciales provistas por entorno, no hardcodeadas.
- **Escalabilidad.** El esquema se diseña para admitir nuevas entidades (nuevos dominios funcionales de la red social) **agregando** tablas, sin reorganizar las existentes — el mismo principio de crecimiento por adición que `REPOSITORY_STRUCTURE.md` §2 aplica a las `features/` del Frontend.
- **Rendimiento.** Los índices se crean **solo** para consultas reales y justificadas (ver §8). No se crean índices especulativos: cada índice tiene un costo de escritura y almacenamiento y debe pagar su costo con una consulta concreta.

---

## 4. Modelo conceptual: estado actual, objetivo y pendientes

Esta sección separa deliberadamente **tres capas** para no confundir lo implementado con lo deseado ni con lo decidido.

### Método
Se distingue entre:
- **Evidencia de código** → justifica la capa **4.A** (estado actual).
- **Alcance funcional confirmado por el equipo** → define la capa **4.B** (objetivo del producto); es un conjunto de *requisitos*, no de decisiones de modelado.
- **Decisiones de persistencia** → capa **4.C** (lo que falta ratificar).

### Evidencia disponible (código actual)
- Backend: **autenticación con persistencia real** (`POST /api/register`, `POST /api/login`). `register_use_case.register_user` crea filas reales en `users` (id generado por PostgreSQL); `login_use_case.login_user` consulta `users` por email (vía `SQLAlchemyUserRepository`) y verifica el hash. La credencial hardcodeada (`test@test.com`/`123456`) que existía en `auth_service.validate_user` **se eliminó por completo** (`BACKEND_ARCHITECTURE.md` §9, v0.6). El backend devuelve `{ id, email, name }`, con datos reales, no un objeto fijo.
- Frontend: `Register.jsx` recolecta exactamente tres campos — `name`, `email`, `password`. `Login.jsx` usa `email` (la contraseña está fijada como `"123456" // temporal`). El objeto de usuario que la app espera de vuelta es `{ email, name }` (`useAuth.js`) — el Frontend **todavía no** consume los endpoints reales; esa integración queda fuera de esta actualización (backend-only).
- Frontend `legal/` (`Terms`, `Privacy`, `Cookies`): páginas **estáticas**, sin datos que persistir.

---

### 4.A ESTADO ACTUAL IMPLEMENTADO

> Actualización (v0.3): la persistencia de `users` ya está implementada y en uso real por `register`/`login` (`BACKEND_ARCHITECTURE.md` §8/§9, v0.6) — verificada con pruebas de integración contra PostgreSQL 16 real (`backend/tests/test_auth.py`). "Implementada" en la tabla de abajo ya no es solo una ratificación de modelo: es el estado real y verificado del backend.

| Entidad | Estado | Justificación |
|---|---|---|
| `users` | **IMPLEMENTADA** (ratificada; definición formal en §5; en uso real por `register`/`login`/`GET`/`PATCH /api/users/me` y `GET`/`PATCH /api/users/me/privacy`) | Registro persiste `name`/`username`/`email`/`phone`/`country_code`/`birth_date`/`password_hash` reales (columnas de perfil ratificadas por `ADR-002`, v0.5); login autentica consultando `users` por `email`; `PATCH /api/users/me` (`ADR-003`, v0.6) actualiza `name`/`username`/`phone`/`country_code`/`birth_date`, con `username_changed_at` sosteniendo el cooldown de `username`; el backend devuelve el objeto público completo (§5) con datos reales. **v0.19:** gana seis columnas de preferencias de privacidad (`is_private`, `who_can_mention`, `who_can_message`, `hide_offensive_comments`, `show_activity_status`, `last_seen_at`) — ADR-022/ADR-023/ADR-024. **v0.20:** gana `login_alerts_enabled`, `two_factor_enabled` y `totp_secret` — ADR-025/ADR-026 |
| `posts` | **IMPLEMENTADA — v0.8** (ratificada por `ADR-004-posts-minimal-model.md`; definición formal en §5; en uso real por `POST`/`GET`/`PATCH`/`DELETE /api/posts`) | Primera entidad de la capa objetivo (§4.B, "Contenido") en pasar a implementada. Modelo deliberadamente mínimo: `author_id` (FK a `users`) y `content` (texto, máximo 2000 caracteres) — sin `visibility`, sin medios, sin ningún otro campo que §4.B seguía listando para "Contenido". **v0.18:** gana `edited_at` (nullable) para soportar la edición del texto (`ADR-021`) |
| `likes` | **IMPLEMENTADA — v0.9** (ratificada por `ADR-005-likes-minimal-model.md`; definición formal en §5; en uso real por `POST`/`DELETE /api/posts/<id>/like`, agregada en `GET`/`POST /api/posts`) | Segunda entidad de la capa objetivo (§4.B, "Interacciones") en pasar a implementada, solo en su versión mínima binaria (like/no-like). Modelo: `post_id`+`user_id` (FKs, `UNIQUE` compuesta) — sin tipos de reacción, sin listar quién dio like |
| `comments` | **IMPLEMENTADA — v0.10** (ratificada por `ADR-006-comments-minimal-model.md`; definición formal en §5; en uso real por `POST`/`GET /api/posts/<id>/comments`, `PATCH`/`DELETE /api/comments/<id>`, agregada en `GET`/`POST /api/posts`) | Tercera entidad de la capa objetivo (§4.B, "Interacciones") en pasar a implementada, solo en su mitad plana. Modelo: `post_id`+`author_id` (FKs) y `content` (texto, máximo 1000 caracteres) — sin `parent_comment_id`, sin hilos de respuestas. **v0.18:** gana `edited_at` (nullable), igual que `posts` (`ADR-021`) |
| `follows` | **IMPLEMENTADA — v0.11** (ratificada por `ADR-007-follows-minimal-model.md`; definición formal en §5; en uso real por `POST`/`DELETE /api/users/<id>/follow`, `GET /api/follow-requests` y los dos endpoints de respuesta, agregada en `GET`/`PATCH /api/users/me` y en `GET`/`POST /api/posts`) | Cuarta entidad de la capa objetivo (§4.B, "Relaciones sociales") en pasar a implementada. Modelo: `follower_id`+`followed_id` (FKs, `UNIQUE` compuesta, primera `CHECK` del esquema) — sin listar seguidores/seguidos, sin personalizar el feed. **v0.19:** gana `status` ('pending'/'accepted') para soportar cuentas privadas con aprobación (`ADR-022`); el feed sigue sin personalizarse, pero ahora sí **filtra** por visibilidad |
| `notifications` | **IMPLEMENTADA — v0.12** (ratificada por `ADR-008-notifications-minimal-model.md`; definición formal en §5; en uso real por `GET /api/notifications`/`PATCH /api/notifications/<id>/read`, generada como efecto secundario de `POST /api/posts/<id>/like`, `POST /api/posts/<id>/comments` y `POST /api/users/<id>/follow`) | Quinta entidad de la capa objetivo (§4.B, "Notificaciones") en pasar a implementada, solo para los tipos `like`/`comment`/`follow`. Modelo: `recipient_id`+`actor_id` (FKs a `users`), `type` (discriminador), `post_id` (FK a `posts`, nullable), `read_at` (nullable) — sin respuestas/menciones/mensajes, sin push/email, sin preferencias configurables |
| `password_reset_tokens` | **IMPLEMENTADA — v0.14** (reescrita por `ADR-010-password-reset-otp-flow.md`, reemplaza la v0.13 de `ADR-009-password-reset-and-email-verification.md`; definición formal en §5; en uso real por `POST /api/forgot-password`/`POST /api/verify-reset-code`/`POST /api/reset-password`) | Sexta entidad de la capa objetivo (§4.B, "Autenticación y cuenta"). Modelo: `user_id` (FK a `users`), `code_hash` (scrypt del código OTP de 6 dígitos), `attempts`, `expires_at`, `verified_at` (nullable), `reset_authorization_hash`/`_expires_at` (nullable), `used_at` (nullable) — código de un solo uso (10 min), autorización temporal de propósito específico tras verificarlo (10 min), máximo 5 intentos, a lo sumo una solicitud activa por usuario (índice único parcial) |
| `email_verification_tokens` | **IMPLEMENTADA — v0.15** (reescrita por `ADR-011-mandatory-email-verification.md`, reemplaza la v0.13 de `ADR-009-password-reset-and-email-verification.md`; definición formal en §5; en uso real por `POST /api/register`/`POST /api/verify-registration-code`/`POST /api/resend-registration-code`) | Séptima entidad de la capa objetivo (§4.B, "Autenticación y cuenta"). Modelo: `user_id` (FK a `users`), `code_hash` (scrypt del código OTP de 6 dígitos), `attempts`, `expires_at`, `used_at` (nullable) — código de un solo uso (10 min), máximo 5 intentos, a lo sumo un código activo por usuario (índice único parcial); sin columnas de autorización temporal, a diferencia de `password_reset_tokens` — verificar el código ya es la acción final |
| `refresh_tokens` | **IMPLEMENTADA — v0.18** (ratificada por `ADR-017-jwt-session-policy.md`; definición formal en §5.16; en uso real por `POST /api/login`, `/api/auth/google`, `/api/refresh` y `/api/logout`) | Sesiones de larga vida con refresh token rotativo: familia por login, hash SHA-256 del `jti`, índice único parcial «un token activo por familia». |
| `user_identities` | **IMPLEMENTADA — v0.16** (ratificada por `ADR-012-google-sign-in.md`; definición formal en §5.9; en uso real por `POST /api/auth/google`) | Octava entidad de la capa objetivo (§4.B, "Autenticación y cuenta", candidata `oauth_accounts`). Modelo: `user_id` (FK a `users`), `provider` (string libre, `"google"` hoy), `provider_subject` (el claim `sub`, único junto con `provider`) — un usuario puede tener varias identidades vinculadas a la vez (account linking); preparada para Apple/Microsoft sin otra migración de `users` |
| `messages` | **IMPLEMENTADA — v0.17** (ratificada por `ADR-013-messages-minimal-model.md`; definición formal en §5.10; en uso real por `POST`/`GET /api/users/<id>/messages`, `PATCH`/`DELETE /api/messages/<id>`, `GET /api/conversations`) | Novena entidad de la capa objetivo (§4.B, "Mensajería") en pasar a implementada, solo su mitad 1:1 — sin `conversation_participants`, sin grupos. Modelo: `sender_id`+`recipient_id` (FKs a `users`), `content` (texto), `read_at` (nullable) — sin fotos/archivos adjuntos, sin tiempo real (polling desde el Frontend). **v0.18:** gana `edited_at` (nullable), igual que `posts`/`comments` (`ADR-021`) |

**Ninguna otra entidad está en esta capa.** Todo lo demás pertenece a la capa objetivo (§4.B) o a pendientes (§4.C).

---

### 4.B ARQUITECTURA OBJETIVO DEL PRODUCTO

El equipo confirmó el alcance funcional de THERS. Aquí se traduce cada grupo funcional a su **forma candidata de persistencia**, bajo dos reglas estrictas:

1. **Una funcionalidad no equivale a una tabla.** Varias funciones colapsan en una sola estructura (p. ej. *seguidores + seguidos + seguir + dejar de seguir* = una única tabla puente `follows`; *todos los tipos de notificación* = una sola entidad `notifications` con discriminador de tipo).
2. **No se decide el modelado.** No se fijan PK/FK, tipos SQL ni cardinalidades definitivas (reglas 6–7 de esta tarea). La "forma candidata" es una **hipótesis a ratificar por ADR**, no una decisión.

Estados usados en esta capa:
- **OBJETIVO** — confirmado como parte del producto; forma candidata identificable; modelado a ratificar.
- **PENDIENTE DE DECISIÓN** — incluso la *forma* de persistencia (tabla vs columna vs configuración vs evento) está genuinamente abierta.

#### Autenticación y cuenta
| Requisito funcional | Forma candidata de persistencia | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Registro, Login, Cerrar sesión | Operan sobre `users` (ya ratificada) — son **comportamientos**, no tablas nuevas | OBJETIVO | El registro persistente reemplaza la validación hardcodeada; depende de implementar `users` |
| Login con Google | ~~Entidad `oauth_accounts` **o** columnas de proveedor en `users`~~ — **resuelto en v0.16** (`ADR-012-google-sign-in.md`, ver §4.A/§5.9): entidad separada, `user_identities` | IMPLEMENTADA | — |
| Verificación de correo, Recuperación de contraseña | ~~Tabla(s) de tokens de un solo uso~~ — **resuelto en v0.13** (`ADR-009-password-reset-and-email-verification.md`, ver §4.A/§5.7/§5.8): dos tablas, `password_reset_tokens`/`email_verification_tokens` | IMPLEMENTADA | — |
| Cambio de contraseña | Comportamiento sobre `users`; historial opcional (ver Seguridad) | PENDIENTE DE DECISIÓN | Persistir historial es opcional y depende de requisitos de auditoría |
| Gestión / desactivación / eliminación de cuenta | Columna de estado (`status`/`deleted_at`, borrado lógico) **vs** borrado físico | PENDIENTE DE DECISIÓN | La política de borrado (lógico vs físico) no está decidida |
| Sesiones y dispositivos | Entidades `sessions`, `devices` | OBJETIVO | Hoy el JWT es stateless; pasar a sesiones/dispositivos persistidos es un cambio a ratificar |

#### Perfil
| Requisito funcional | Forma candidata | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Nombre | Columna `users.name` (ya existe) | **IMPLEMENTADA** | — |
| Username | Columna `users.username` (única) | **IMPLEMENTADA** (v0.5, `ADR-002`) | — |
| Teléfono | Columnas `users.phone` + `users.country_code` | **IMPLEMENTADA** (v0.5, `ADR-002`) | — |
| Fecha de nacimiento | Columna `users.birth_date` | **IMPLEMENTADA** (v0.5, `ADR-002`) | — |
| Foto de perfil | Columna `avatar_url` en `users` **o** referencia a entidad `media` | PENDIENTE DE DECISIÓN | URL simple vs entidad de medios, no decidido |
| Biografía | Columna `bio` en `users` | OBJETIVO | Longitud/tipo a decidir; no añade PK/FK |
| Edición del perfil | Comportamiento (UPDATE sobre `users`, `PATCH /api/users/me`) | **IMPLEMENTADA** (v0.6, `ADR-003`) — solo `name`/`username`/`phone`/`country_code`/`birth_date`; `email`/`password` excluidos por decisión explícita del ADR | — |

> ⚠️ **Contradicción registrada en v0.1–v0.4, cerrada en v0.5.** La v0.1 (§5) excluía `username` por no recolectarse en el registro; v0.2–v0.4 la registraron como **columna objetivo**, pendiente de ADR. `ADR-002-user-profile-fields.md` (THERS Backend Fase 2.1) resuelve esa pendiente: `username`, `phone`, `country_code` y `birth_date` pasan a **IMPLEMENTADA** (ver §5). `avatar_url`/`bio` **siguen** como objetivo/pendiente — este ADR no las toca.

#### Configuración
| Requisito funcional | Forma candidata | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Cuenta, Privacidad, Seguridad, Notificaciones, Preferencias | Entidad `user_settings` (1:1) **o** columnas en `users` **o** documento JSON | PENDIENTE DE DECISIÓN | La forma (tabla 1:1 vs columnas vs JSON) es una decisión de modelado abierta |
| Sesiones / dispositivos | = entidades `sessions`/`devices` (ver Autenticación/Seguridad) | OBJETIVO | Misma estructura, no se duplica |
| Usuarios bloqueados | Tabla puente `blocks` (ver Relaciones sociales) | OBJETIVO | Misma estructura que el bloqueo social |
| Gestión de datos (export/borrado) | Comportamiento/proceso; no necesariamente una tabla | PENDIENTE DE DECISIÓN | Puede no requerir persistencia propia |

#### Contenido
| Requisito funcional | Forma candidata | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Posts (solo texto) | Entidad `posts` (`author_id` → `users`, ver §6) | **IMPLEMENTADA — v0.8** (`ADR-004`, §4.A/§5) | — |
| Fotos, Videos, Reels | Entidad `media` ligada a `posts` (con tipo) **o** tablas separadas | PENDIENTE DE DECISIÓN | Tabla de medios con discriminador vs tablas por tipo; "reel" ¿es tipo de video o entidad propia? |
| Editar / Eliminar publicaciones | ~~Comportamientos + columnas (`updated_at`, borrado lógico) sobre `posts`~~ — **resuelta**: eliminar por *hard delete* sin borrado lógico (`ADR-019`, v0.17 de `API_CONTRACT.md`); editar in place con `posts.edited_at` (`ADR-021`, §5.2), no con `updated_at` | **IMPLEMENTADA — v0.18** | — (la política fue *hard delete*; el borrado lógico queda descartado para esta versión, `ADR-019` §Opciones consideradas) |
| Compartir publicaciones | Entidad de *repost* **vs** evento **vs** compartir externo | PENDIENTE DE DECISIÓN | La semántica de "compartir" (interno/externo) no está definida |
| Visibilidad de publicaciones | Columna `visibility` (enum) en `posts` | OBJETIVO | Estrategia de enum pendiente (§7) |

#### Interacciones
| Requisito funcional | Forma candidata | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Likes / reacciones | ~~Entidad `reactions` (N:N usuario↔post, con tipo) — colapsa "like" y "reacción"~~ — **resuelto en v0.9 para el caso binario** (`ADR-005-likes-minimal-model.md`, tabla `likes`, ver §4.A/§5.3); la forma general "con tipo" (❤️/👍/😂/etc.) sigue sin ratificar | OBJETIVO (tipos de reacción) / IMPLEMENTADA (binario) | Modelado de tipos de reacción sin decidir |
| Comentarios + Respuestas a comentarios | ~~Entidad única `comments`~~ — **la mitad plana resuelta en v0.10** (`ADR-006-comments-minimal-model.md`, ver §4.A/§5.4); auto-referencial (respuesta = comentario con `parent_comment_id`) sigue sin ratificar | OBJETIVO (respuestas) / IMPLEMENTADA (comentario plano) | Modelado de `parent_comment_id`/hilos sin decidir |
| Guardar publicaciones | Tabla puente `saves` (usuario↔post) | OBJETIVO | — |
| Menciones | ~~Entidad `mentions`~~ — **resuelta en v0.19**: tabla `mentions` con dos targets posibles (post o comentario) y `users.who_can_mention` como control de permiso (`ADR-023-mentions.md`, §5.11) | **IMPLEMENTADA — v0.19** | — |
| Hashtags | Entidad `hashtags` + puente `post_hashtags` (N:N) | OBJETIVO | Modelado sin decidir |
| Compartir | = ver Contenido › Compartir publicaciones | PENDIENTE DE DECISIÓN | Misma decisión abierta |

#### Relaciones sociales
| Requisito funcional | Forma candidata | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Seguir, Dejar de seguir, Seguidores, Seguidos | ~~**Una** tabla puente `follows` (auto-referencial `users`↔`users`) — las cuatro funciones son la misma estructura~~ — **resuelto en v0.11** (`ADR-007-follows-minimal-model.md`, ver §4.A/§5.5): seguir/dejar de seguir y los contadores; listar seguidores/seguidos sigue sin ratificar | IMPLEMENTADA (seguir/contar) / PENDIENTE (listar) | Listar seguidores/seguidos sin decidir |
| Bloquear usuarios | Tabla puente `blocks` (auto-referencial) | OBJETIVO | — |
| Restringir usuarios | Tabla puente `restrictions` **o** atributo de la relación social | PENDIENTE DE DECISIÓN | La semántica de "restringir" vs "bloquear" está por definir |

#### Mensajería
| Requisito funcional | Forma candidata | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Conversaciones grupales, Participantes | `conversations` + puente `conversation_participants` | OBJETIVO | Modelado sin decidir — la mitad 1:1 se resolvió sin esta tabla (ver fila de abajo), grupos siguen pendientes |
| Mensajes (1:1) | ~~Entidad `messages`~~ — **resuelto en v0.17** (`ADR-013-messages-minimal-model.md`, ver §4.A/§5.10): `sender_id`/`recipient_id` directos, sin tabla `conversations` | IMPLEMENTADA | — |
| Fotos/videos en mensajes | `message_media` **o** reutilizar `media` | PENDIENTE DE DECISIÓN | Reutilización vs entidad propia |
| Estado leído/no leído | ~~Columna `last_read_at` en participante **o** tabla `message_reads`~~ — **resuelto en v0.17**: `messages.read_at` por mensaje individual (no por conversación) | IMPLEMENTADA | — |

#### Notificaciones
| Requisito funcional | Forma candidata | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Likes, Comentarios, Nuevos seguidores | ~~**Una** entidad `notifications` con discriminador de tipo — no una tabla por tipo~~ — **resuelto en v0.12** (`ADR-008-notifications-minimal-model.md`, ver §4.A/§5.6) para estos tres eventos | IMPLEMENTADA | — |
| Respuestas (a comentarios), Menciones, Actividad relevante | Misma entidad `notifications`, tipos adicionales | PENDIENTE DE DECISIÓN | Dependen de que existan primero las entidades de origen (`parent_comment_id`/hilos, `mentions`) — ninguna está ratificada todavía |
| Mensajes nuevos | Misma entidad `notifications`, tipo `'message'` | PENDIENTE DE DECISIÓN | `messages` ya existe (v0.17, `ADR-013`) — lo que falta es una decisión de producto explícita sobre si un mensaje nuevo debe generar notificación además de aparecer en `GET /api/conversations`, no una entidad faltante |

#### Seguridad
| Requisito funcional | Forma candidata | Estado | Por qué aún requiere decisión |
|---|---|---|---|
| Sesiones, Dispositivos | Entidades `sessions`, `devices` (mismas que Autenticación) | OBJETIVO | Requiere pasar de JWT stateless a estado persistido |
| Cambios de contraseña (historial) | Entidad `password_changes` | PENDIENTE DE DECISIÓN | Solo si se requiere historial/auditoría |
| Eventos de seguridad / Auditoría | Entidad `security_events` / log de auditoría | PENDIENTE DE DECISIÓN | El propio alcance dice "auditoría cuando sea necesaria" — es condicional |

---

### 4.C DECISIONES DE PERSISTENCIA TODAVÍA PENDIENTES

Lo que impide pasar de la capa objetivo (§4.B) a un esquema real:
- **Forma de cada candidato** marcado *PENDIENTE DE DECISIÓN* arriba (tabla vs columna vs configuración vs evento).
- **Modelado transversal** de todas las entidades objetivo: tipo de PK, FK y políticas `ON DELETE`, tipos SQL, enums, índices. **No** se fijan aquí (reglas 6–7 de esta tarea).
- **Decisiones de motor y operación** ya listadas en §14 (versión, driver/ORM, migraciones, backups, variables de entorno, roles de acceso).

Ninguna entidad de la capa objetivo se implementa hasta que su modelado se ratifique por ADR (`HB-001` §11–12) y se incorpore a este documento. El `DATABASE_ERD.md` seguirá representando **solo** la capa 4.A (`users`) hasta entonces.

---

## 5. Entidades ratificadas

> **v0.8 — `posts` se suma a `users`** como segunda entidad con definición formal (capa 4.A, `ADR-004-posts-minimal-model.md`). El resto sigue en §4.B (objetivo) y §14 (pendientes).

### 5.1 `users`

**Propósito.** Representar a una persona registrada en THERS y ser la fuente de verdad para autenticación — rol que ya cumple en producción de código desde v0.3 (`register`/`login` reales, `BACKEND_ARCHITECTURE.md` §8/§9).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria. `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — el valor se genera **en PostgreSQL** (`gen_random_uuid()`, función nativa desde PostgreSQL 13, no requiere `pgcrypto`/`uuid-ossp`), no en Python. Implementado en `app/infrastructure/persistence/models.py` (`sqlalchemy.dialects.postgresql.UUID(as_uuid=True)`, `server_default=text("gen_random_uuid()")`) y en la migración `a1b2c3d4e5f6_create_users_table.py` |
| `name` | `VARCHAR(120)` | No | Campo `name` recolectado en `Register.jsx`; devuelto por el backend |
| `username` | `VARCHAR(30)`, **UNIQUE** (`uq_users_username`) | No | **v0.5 (`ADR-002`).** Campo `username` recolectado en `Register.jsx`; formato `^[a-zA-Z0-9_]{3,20}$` validado en `domain/auth/validators.py`. A diferencia de `email`, **no** usa `CITEXT` — comparación case-sensitive, decisión explícita (`ADR-002` §3): ningún flujo hoy (login sigue siendo por email) requiere case-insensitivity para username |
| `phone` | `VARCHAR(20)` | **Sí** desde v0.16 | **v0.5 (`ADR-002`).** Campo `phone` recolectado en `Register.jsx` (`PhoneField`); validación laxa de 7–15 dígitos tras limpiar separadores. **v0.16 (`ADR-012-google-sign-in.md`):** pasa a nullable — Google no lo entrega; el registro tradicional sigue exigiéndolo siempre a nivel de route, así que nunca queda en `NULL` para una cuenta creada así |
| `country_code` | `VARCHAR(6)` | **Sí** desde v0.16 | **v0.5 (`ADR-002`).** Campo `countryCode` recolectado en `Register.jsx` (`PhoneField`, p. ej. `+503`); formato `^\+[1-9]\d{0,3}$`. **v0.16:** mismo motivo que `phone` — nullable, Google no lo entrega |
| `birth_date` | `DATE` | **Sí** desde v0.16 | **v0.5 (`ADR-002`).** Campo `birthDate` recolectado en `Register.jsx` (`BirthDateField`, ISO `yyyy-mm-dd`); edad mínima 13 años validada en el backend (mismo placeholder que ya usaba el Frontend, `dateUtils.js` `MIN_AGE_YEARS`). **v0.16:** mismo motivo — nullable, Google no lo entrega |
| `password_hash` | `TEXT` | **Sí** desde v0.16 | Deriva del campo `password` del registro. **Nunca se guarda en claro** — se almacena el hash (necesidad técnica evidente; §11). **v0.16 (`ADR-012`):** pasa a nullable — una cuenta creada exclusivamente vía "Continuar con Google" no tiene contraseña local; `NULL` significa exactamente eso, nunca un valor inventado |
| `username_changed_at` | `TIMESTAMPTZ` | **Sí** | **v0.6 (`ADR-003`).** Marca de tiempo del último cambio de `username` vía `PATCH /api/users/me`; `NULL` significa "nunca cambió su username". Sostiene la regla de cooldown de 30 días (`domain/auth/username_policy.py`) — no se reutiliza `updated_at` porque esa cambia con cualquier campo, no solo con `username`. Nunca se expone en la API pública (`API_CONTRACT.md` §5). **v0.16:** el username provisorio de una cuenta Google nunca toca esta columna (se queda en `NULL`) hasta que la persona elige uno propio en "Complete your profile" — esa primera elección real nunca choca con el cooldown |
| `email_verified` | `BOOLEAN`, `DEFAULT false` | No | **v0.13 (`ADR-009-password-reset-and-email-verification.md`).** `false` en toda cuenta hasta completar la verificación (reescrito a OTP en `ADR-011`, v0.15). **v0.16 (`ADR-012`):** una cuenta creada vía Google nace en `true` directamente (la garantía de Google reemplaza al OTP); también puede pasar de `false` a `true` al vincular Google con una cuenta tradicional nunca verificada (account linking, `ADR-012` §Decisión) |
| `bio` | `VARCHAR(160)` | **Sí** | **ADR-015 (migración `a5c8e2d71f34`).** Texto del perfil. `NULL` = no definido, nunca una cadena vacía. |
| `location` | `VARCHAR(60)` | **Sí** | **ADR-015.** Ubicación textual libre del perfil. |
| `website` | `VARCHAR(100)` | **Sí** | **ADR-015.** URL del perfil, validada al escribir. |
| `avatar_path` | `VARCHAR(255)` | **Sí** | **ADR-015.** **Clave del objeto** en el almacenamiento (p. ej. `avatars/<uuid>.webp`), no una URL: la URL pública depende del entorno (disco local, Supabase o R2) y se resuelve al presentar (`application/media/media_url.py`). |
| `cover_path` | `VARCHAR(255)` | **Sí** | **ADR-015.** Igual que `avatar_path`, para la portada. |
| `profile_completed` | `BOOLEAN`, `DEFAULT true` | No | **v0.16 (`ADR-012-google-sign-in.md`).** `true` para toda cuenta existente antes de esta migración y para todo registro tradicional (siempre exige `phone`/`country_code`/`birth_date`); una cuenta nueva vía Google nace en `false` hasta completar esos tres campos vía `PATCH /api/users/me`. Nunca vuelve a `false` una vez en `true` |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Convención de auditoría (§7); estándar para toda entidad |
| `is_private` | `BOOLEAN`, `DEFAULT false` | No | **v0.19 (`ADR-022`).** `true` = solo ven tu contenido quienes tengan un follow en estado `'accepted'` (§5.5), más vos mismo. `false` preserva el comportamiento histórico — ninguna cuenta se vuelve privada por efecto de la migración. Es la única columna de `users` que participa en una regla de **autorización de lectura** |
| `who_can_mention` | `VARCHAR(20)`, `DEFAULT 'everyone'` | No | **v0.19 (`ADR-023`).** `'everyone'`/`'followers'`/`'nobody'`. Quién puede mencionarte con `@username`. `'followers'` significa "solo quienes **me** siguen". Discriminador validado en la aplicación (`domain/privacy/audience.py`), no `ENUM` de PostgreSQL — mismo criterio que `notifications.type` |
| `who_can_message` | `VARCHAR(20)`, `DEFAULT 'everyone'` | No | **v0.19 (`ADR-024`).** Mismo vocabulario que `who_can_mention`, deliberadamente compartido: significan lo mismo, así que duplicarlo invitaría a que se desincronizaran. `'everyone'` es el comportamiento que `POST /api/users/<id>/messages` ya tenía desde `ADR-013` |
| `hide_offensive_comments` | `BOOLEAN`, `DEFAULT false` | No | **v0.19 (`ADR-024`).** Filtra los comentarios de **tus** publicaciones contra la lista de términos del sistema (`domain/moderation/offensive_words.py`, que vive en el repositorio y **no** en la base de datos: es configuración de producto revisable, no dato de usuario). `false` por defecto — nadie empieza a ver su hilo filtrado sin pedirlo |
| `show_activity_status` | `BOOLEAN`, `DEFAULT true` | No | **v0.19 (`ADR-024`).** Única preferencia de esta revisión que nace **abierta**, y es seguro: hasta ahora no existía ningún dato de presencia, así que activarla no expone nada retroactivo |
| `last_seen_at` | `TIMESTAMPTZ` | **Sí** | **v0.19 (`ADR-024`).** `NULL` = nunca se registró actividad. La escribe un hook `after_request` en cualquier petición autenticada que resuelve bien, con un **throttle de 5 minutos impuesto en el propio `WHERE` del `UPDATE`** — no en memoria del proceso, para que funcione igual con varios workers (a diferencia del indicador de "escribiendo", `ADR-014`, que es efímero y acepta esa limitación). Nunca cruza la frontera HTTP hacia terceros si `show_activity_status` es `false` |
| `login_alerts_enabled` | `BOOLEAN`, `DEFAULT true` | No | **v0.20 (`ADR-025`).** Avisar por correo de un acceso desde un dispositivo no visto antes. Nace **activada**: una alerta de seguridad que hay que descubrir y encender no protege a nadie. Sin `RESEND_API_KEY` el envío es un no-op registrado por log, así que el default no rompe el desarrollo local |
| `two_factor_enabled` | `BOOLEAN`, `DEFAULT false` | No | **v0.20 (`ADR-026`).** Separada de `totp_secret` a propósito: durante el alta existe un secreto todavía **sin confirmar**. Sin esa separación, escanear el QR y abandonar dejaría la cuenta exigiendo un código que nadie puede generar |
| `terms_accepted_at` | `TIMESTAMPTZ` | **Sí** | **v0.23 (`ADR-032` §5).** Cuándo aceptó los términos de uso. `NULL` = nunca aceptó: es el caso de **todas** las cuentas anteriores a esta columna |
| `terms_version` | `VARCHAR(32)` | **Sí** | **v0.23 (`ADR-032` §5).** La versión que aceptó (una fecha de publicación), **no** la vigente: así se sabe a quién volver a preguntarle cuando los términos cambian |
| `totp_secret` | `TEXT` | **Sí** | **v0.20 (`ADR-026`).** Secreto compartido TOTP en base32. **Se guarda recuperable, NO hasheado**, y es inevitable: verificar un código TOTP exige recalcularlo a partir del secreto. Es la diferencia estructural con `PasswordResetToken.code_hash` (§5.7) y `EmailVerificationToken.code_hash` (§5.8), que sí se hashean porque el código viaja una vez y solo hay que compararlo. Sin cifrado en reposo — la clave acabaría en la misma base o el mismo `.env` mientras no haya gestión de secretos (`ADR-026` §Riesgos) |
| `updated_at` | `TIMESTAMPTZ`, `DEFAULT now()`, mantenida por trigger | No | Convención de auditoría (§7). Un trigger de PostgreSQL (`set_updated_at`/`trg_users_updated_at`, ver migración) la actualiza en cada `UPDATE` — funciona igual vía ORM o SQL directo, no depende de que el código de aplicación la toque |

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** Ninguna en esta versión — `users` no depende de otra entidad todavía.

**Relaciones.** `posts.author_id → users.id` (v0.7, ver §5.2/§6) — `users` es la entidad referenciada, nunca al revés. `user_identities.user_id → users.id` (v0.16, ver §5.9/§6) — mismo patrón. Cuando existan más entidades sociales (`follows`, etc.), seguirán el mismo patrón.

**Constraints relevantes**
- `email` **UNIQUE** (case-insensitive, vía `CITEXT`) y **NOT NULL** — el login identifica al usuario por email; dos cuentas no pueden compartirlo, ni siquiera con distinto casing. (Justifica también el índice de §8.)
- `name` **NOT NULL** — el formulario lo exige (`isValid` requiere `name.trim()`).
- `password_hash` **NOT NULL hasta v0.15, nullable desde v0.16** (`ADR-012-google-sign-in.md`) — ver tabla de arriba.

**`confirm_password`** se valida en la route (`interfaces/routes/auth_routes.py`, debe coincidir con `password`) y **nunca se persiste** — no existe como columna de `users`, ni siquiera transitoriamente.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14): algoritmo de hashing definitivo (sigue usándose `werkzeug.security`/scrypt, ya en uso para la credencial de prueba — ver `BACKEND_ARCHITECTURE.md` §9). **Ya resueltos:** tipo de PK (UUID, `gen_random_uuid()`), tipo de `email` (`CITEXT`), longitud de `name` (`VARCHAR(120)`), tipo de `password_hash` (`TEXT`), estrategia de `updated_at` (trigger), desde v0.5 también `username`/`phone`/`country_code`/`birth_date` (`ADR-002`), y desde v0.6 `username_changed_at` (`ADR-003`) — ver tabla arriba.

> **Actualización v0.2 — reconciliación con el alcance objetivo.** El alcance funcional confirmado por el equipo incorporó `username`, `avatar_url` y `bio` como **columnas OBJETIVO** de `users` (§4.B › Perfil), pendientes de ADR. **Actualización v0.5:** `username` (junto con `phone`/`country_code`/`birth_date`, no anticipadas en v0.2) ya se ratificaron e implementaron por `ADR-002-user-profile-fields.md` — ver tabla arriba. **Actualización v0.6:** `username_changed_at` se ratificó e implementó por `ADR-003-profile-update-contract.md`, exclusivamente como soporte de la regla de cooldown de `PATCH /api/users/me` — no era una columna candidata previa en §4.B. `avatar_url`/`bio` siguen como columnas OBJETIVO, sin ADR propio todavía.

---

### 5.2 `posts`

> Segunda entidad con definición formal (capa 4.A), ratificada por `ADR-004-posts-minimal-model.md` — deliberadamente mínima: solo lo indispensable para que el feed deje de ser mock. Reacciones, comentarios, hashtags, medios, mood, ubicación, edición/borrado, visibilidad **no** están en esta entidad — cada uno es su propia candidata en §4.B, a resolver en un ADR futuro y acotado (mismo patrón que este).

**Propósito.** Un post de texto publicado por un usuario autenticado — primera pieza real de contenido del producto, más allá de la cuenta/perfil.

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` en PostgreSQL — mismo patrón que `users.id` |
| `author_id` | **UUID**, FK → `users.id` | No | Autor del post. Siempre resuelto desde `get_jwt_identity()` en el backend, nunca aceptado del body (`ADR-004` §Contrato, mismo principio anti mass-assignment que `PATCH /api/users/me`) |
| `content` | `TEXT` | No | Sin límite de longitud a nivel de esquema — la validación de negocio (máximo 2000 caracteres, placeholder revisable) vive en `domain/posts/validators.py`, no en el tipo de columna |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Define el orden del feed (`GET /api/posts`, `ORDER BY created_at DESC`) |
| `updated_at` | `TIMESTAMPTZ`, `DEFAULT now()`, mantenida por trigger | No | Convención de auditoría (§7), mismo trigger `set_updated_at()` reutilizado de `users`. **Sigue sin uso funcional y sin exponerse en la API** incluso desde que existe la edición (v0.18): la señal de "fue editado" es `edited_at`, no esta columna (`ADR-021` §Opciones consideradas) |
| `edited_at` | `TIMESTAMPTZ` | **Sí** | **v0.18 (`ADR-021`).** `NULL` = nunca editado. La fija `PATCH /api/posts/<id>` con `now()` de PostgreSQL en cada edición (sin `coalesce`, a diferencia de `read_at`: refleja la **última** edición, no la primera). Se expone en la API como el booleano `edited`, nunca como el timestamp crudo (`API_CONTRACT.md` §5) — mismo criterio que `notifications.read_at` |

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `author_id → users.id`, `ON DELETE CASCADE` — placeholder razonable dado que borrado de cuenta tampoco existe todavía como funcionalidad (§4.B, "Gestión/desactivación/eliminación de cuenta", `PENDIENTE DE DECISIÓN`); revisar esta política cuando esa funcionalidad se ratifique (`ADR-004` §Riesgos).

**Relaciones.** `users (1) ←→ (N) posts` — un usuario puede tener muchos posts; cada post tiene exactamente un autor.

**Constraints relevantes**
- `author_id` **NOT NULL** — todo post tiene autor, sin excepción.
- `content` **NOT NULL** — la validación de "no vacío tras trim()" vive en la capa de aplicación (`domain/posts/validators.py`), no como `CHECK` de PostgreSQL en esta versión.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-004` §Decisiones pendientes): índice compuesto por `author_id` (si en el futuro se necesita filtrar por autor — hoy `GET /api/posts` no filtra), `CHECK` de longitud máxima a nivel de esquema (hoy solo aplicación), política `ON DELETE` definitiva (depende de la decisión de borrado de cuenta).

---

### 5.3 `likes`

> Tercera entidad con definición formal (capa 4.A), ratificada por `ADR-005-likes-minimal-model.md` — resuelve únicamente el caso binario like/no-like de la candidata `reactions` (§4.B). Tipos de reacción, notificaciones y listar quién dio like **no** están en esta entidad — quedan para un ADR futuro si el producto los necesita.

**Propósito.** Registra que un usuario le dio "me gusta" a un post — tabla puente N:N entre `users` y `posts`, sin ningún atributo más allá de quién/qué/cuándo.

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que `users.id`/`posts.id` |
| `post_id` | **UUID**, FK → `posts.id` | No | Post likeado |
| `user_id` | **UUID**, FK → `users.id` | No | Quién dio el like. Siempre resuelto desde `get_jwt_identity()`, nunca aceptado del body (mismo principio anti mass-assignment que `posts.author_id`) |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Auditoría — sin uso funcional todavía (no hay orden ni listado de likes en esta versión) |

**Sin `updated_at`.** A diferencia de `users`/`posts`, un like no se edita in place — se crea o se borra, nunca se actualiza (`ADR-005` §Modelo de datos).

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `post_id → posts.id` y `user_id → users.id`, ambas `ON DELETE CASCADE` — mismo placeholder que `ADR-004` ya aceptó para `posts.author_id` (borrado de cuenta/post tampoco existe todavía como funcionalidad).

**Relaciones.** `users (1) ←→ (N) likes ←→ (N) 1) posts` — tabla puente N:N entre `users` y `posts`.

**Constraints relevantes**
- `post_id`/`user_id` **NOT NULL** — todo like tiene post y usuario, sin excepción.
- `UNIQUE (post_id, user_id)` (`uq_likes_post_user`) — un usuario no puede likear el mismo post dos veces; también sostiene la idempotencia de `POST /api/posts/<id>/like` (`ADR-005` §Decisión).

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-005` §Decisiones pendientes): tipos de reacción más allá del binario, tabla/columna de notificaciones asociadas, forma de exponer quién dio like (si el producto lo necesita).

---

### 5.4 `comments`

> Cuarta entidad con definición formal (capa 4.A), ratificada por `ADR-006-comments-minimal-model.md` — resuelve solo la mitad plana de la candidata combinada "Comentarios + Respuestas" (§4.B). `parent_comment_id`/hilos de respuestas **no** están en esta entidad — quedan para un ADR futuro si el producto los necesita.

**Propósito.** Un comentario de texto plano sobre un post, publicado por un usuario autenticado.

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que `users.id`/`posts.id` |
| `post_id` | **UUID**, FK → `posts.id` | No | Post comentado |
| `author_id` | **UUID**, FK → `users.id` | No | Autor del comentario. Siempre resuelto desde `get_jwt_identity()`, nunca aceptado del body (mismo principio anti mass-assignment que `posts.author_id`) |
| `content` | `TEXT` | No | Sin límite de longitud a nivel de esquema — la validación de negocio (máximo 1000 caracteres, placeholder revisable, más corto que el de `posts`) vive en `domain/comments/validators.py` |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Define el orden del hilo (cronológico ascendente, a diferencia del feed) |
| `updated_at` | `TIMESTAMPTZ`, `DEFAULT now()`, mantenida por trigger | No | Convención de auditoría (§7), mismo trigger `set_updated_at()` reutilizado de `users`/`posts`. **Sigue sin uso funcional y sin exponerse**, igual que `posts.updated_at` (§5.2) — la señal de edición es `edited_at` |
| `edited_at` | `TIMESTAMPTZ` | **Sí** | **v0.18 (`ADR-021`).** `NULL` = nunca editado. La fija `PATCH /api/comments/<id>`; se expone como el booleano `edited` — mismo criterio y misma semántica que `posts.edited_at` (§5.2) |

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `post_id → posts.id` y `author_id → users.id`, ambas `ON DELETE CASCADE` — mismo placeholder que `ADR-004`/`ADR-005` ya aceptaron (borrado de cuenta/post no existe todavía como funcionalidad).

**Relaciones.** `posts (1) ←→ (N) comments` y `users (1) ←→ (N) comments` — un post puede tener muchos comentarios, un usuario puede escribir muchos comentarios; cada comentario tiene exactamente un post y un autor.

**Constraints relevantes**
- `post_id`/`author_id` **NOT NULL** — todo comentario tiene post y autor, sin excepción.
- `content` **NOT NULL** — la validación de "no vacío tras trim()" vive en la capa de aplicación, no como `CHECK` de PostgreSQL en esta versión.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-006` §Decisiones pendientes): `parent_comment_id` (hilos de respuestas), edición/borrado, `CHECK` de longitud máxima a nivel de esquema, política `ON DELETE` definitiva.

---

### 5.5 `follows`

> Quinta entidad con definición formal (capa 4.A), ratificada por `ADR-007-follows-minimal-model.md` — primera relación auto-referencial (`users`↔`users`) del esquema. Listar seguidores/seguidos, notificaciones y personalizar el feed **no** están en esta entidad — quedan para un ADR futuro si el producto los necesita.

**Propósito.** Registra que un usuario sigue a otro — tabla puente N:N auto-referencial sobre `users`, sin ningún atributo más allá de quién/a quién/cuándo.

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que el resto de entidades |
| `follower_id` | **UUID**, FK → `users.id` | No | Quién sigue. Siempre resuelto desde `get_jwt_identity()`, nunca aceptado del body |
| `followed_id` | **UUID**, FK → `users.id` | No | A quién se sigue. Viene de la URL (`user_id`), nunca del body |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Auditoría — sin uso funcional todavía (no hay orden ni listado de follows en esta versión) |

**`status`** (`VARCHAR(20) NOT NULL DEFAULT 'accepted'`) — **v0.19 (`ADR-022-private-accounts.md`).** Dos valores: `'accepted'` (relación efectiva) y `'pending'` (solicitud sin responder, solo alcanzable hacia una cuenta con `is_private = true`). El `server_default 'accepted'` hace de **backfill**: todo follow previo a esta migración se hizo hacia una cuenta pública, así que ya estaba aceptado de hecho.

La `UNIQUE (follower_id, followed_id)` **no se amplía** con `status`, y es deliberado: así una misma pareja nunca puede tener a la vez una solicitud pendiente y un follow aceptado — son dos estados de la misma fila, no dos filas. Es también el motivo por el que se descartó una tabla `follow_requests` aparte (`ADR-022` §Opciones consideradas): habría que mantener esa invariante a mano, sin que el esquema ayude.

Todas las lecturas que significan "relación efectiva" (`is_following`, `followers_count`, `following_count`, el filtro de visibilidad del feed) cuentan **solo** `'accepted'`: un pendiente no es un seguidor, porque todavía no tiene acceso a nada.

**Sin `updated_at`.** Igual que `likes` (`ADR-005` §Modelo de datos): una relación de "seguir" se crea o se borra, y desde v0.19 también cambia de `status` — ese cambio tiene su propia semántica ("fue aprobada"), que un timestamp genérico de última escritura no capturaría.

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `follower_id → users.id` y `followed_id → users.id`, ambas `ON DELETE CASCADE` — mismo placeholder que el resto de entidades (borrado de cuenta no existe todavía como funcionalidad).

**Relaciones.** `users (1) ←→ (N) follows ←→ (N) 1) users` — tabla puente N:N auto-referencial: un usuario puede seguir a muchos, y ser seguido por muchos.

**Constraints relevantes**
- `follower_id`/`followed_id` **NOT NULL** — todo follow tiene ambos lados, sin excepción.
- `UNIQUE (follower_id, followed_id)` (`uq_follows_follower_followed`) — un usuario no puede seguir dos veces al mismo usuario; sostiene la idempotencia de `POST /api/users/<id>/follow`.
- `CHECK (follower_id <> followed_id)` (`ck_follows_no_self_follow`) — **primera `CHECK` constraint del esquema**: un usuario no puede seguirse a sí mismo, impuesto a nivel de motor y no solo en la aplicación (`DATABASE_ARCHITECTURE.md` §3, "la base de datos como última línea de defensa").

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-007` §Decisiones pendientes): personalizar el feed por seguidos, listar seguidores/seguidos, notificaciones de "nuevo seguidor", perfiles públicos de otros usuarios.

---

### 5.6 `notifications`

> Sexta entidad con definición formal (capa 4.A), ratificada por `ADR-008-notifications-minimal-model.md` — cubre solo los tres eventos que el backend ya genera: `like`, `comment`, `follow`. Respuestas a comentarios, menciones y mensajes **no** están en esta entidad — dependen de que sus propias entidades de origen se ratifiquen primero.

**Propósito.** Registra que un evento social (like, comentario, follow) generó una notificación para el usuario destinatario — discriminada por `type`, no una tabla por tipo de evento (§4.B › Notificaciones).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que el resto de entidades |
| `recipient_id` | **UUID**, FK → `users.id` | No | Quién recibe la notificación — el autor del post (`like`/`comment`) o el usuario seguido (`follow`) |
| `actor_id` | **UUID**, FK → `users.id` | No | Quién generó el evento. Siempre resuelto desde `get_jwt_identity()` de quien hizo la acción original, nunca aceptado del body |
| `type` | `VARCHAR(20)` | No | Discriminador: `'like'` / `'comment'` / `'follow'`. Validado en `domain/`, no como `ENUM` de PostgreSQL — agregar un tipo nuevo el día de mañana no requiere `ALTER TYPE` (`ADR-008` §Opciones consideradas) |
| `post_id` | **UUID**, FK → `posts.id` | **Sí** | Post de origen — solo aplica a `like`/`comment`; `NULL` en `follow` |
| `read_at` | `TIMESTAMPTZ` | **Sí** | `NULL` = no leída. Se expone en la API como booleano (`read`), nunca como el timestamp crudo (`API_CONTRACT.md` §5) |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Define el orden de la lista (más reciente primero) |

**Sin `updated_at`.** Igual que `likes`/`follows`: una notificación no se edita in place más allá de marcarse como leída (`read_at`), que tiene su propia semántica de "solo se fija una vez" (`ADR-008` §Contrato API).

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `recipient_id → users.id` y `actor_id → users.id` (ambas `ON DELETE CASCADE`, mismo placeholder que el resto de entidades); `post_id → posts.id` (`ON DELETE CASCADE` — si el post se borra, no tiene sentido conservar notificaciones sobre un post inexistente).

**Relaciones.** `users (1) ←→ (N) notifications` (dos veces: como destinatario y como actor) y `posts (1) ←→ (N) notifications` — un post puede generar muchas notificaciones (una por cada like/comentario que recibe), una notificación tiene exactamente un destinatario, un actor, y opcionalmente un post de origen.

**Constraints relevantes**
- `recipient_id`/`actor_id`/`type` **NOT NULL** — toda notificación tiene destinatario, actor y tipo, sin excepción.
- **Sin `UNIQUE`.** A diferencia de `likes`/`follows`, dos notificaciones legítimas pueden compartir destinatario/actor/post/tipo (like → unlike → like genera dos notificaciones reales, `ADR-008` §Opciones consideradas) — no hay una repetición a impedir a nivel de esquema.
- **Sin `CHECK` de auto-notificación.** Ningún endpoint acepta datos para esta tabla directamente del usuario — los tres únicos puntos de creación (`like_post_use_case`, `create_comment_use_case`, `follow_user_use_case`) ya comparan `actor_id`/`recipient_id` en la capa de aplicación antes de crear la fila; no hay superficie de ataque que una `CHECK` adicional esté cerrando (a diferencia de `follows`, donde sí hacía falta como segunda línea de defensa).

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-008` §Decisiones pendientes): notificaciones push/email, preferencias configurables, tipos adicionales (respuestas, menciones, mensajes — dependen de sus propias entidades), endpoint de "marcar todas como leídas", contador de no leídas como endpoint propio, borrado/expiración, actualización en tiempo real (WebSockets/SSE).

---

### 5.7 `password_reset_tokens`

> Séptima entidad con definición formal (capa 4.A). Ratificada originalmente por `ADR-009-password-reset-and-email-verification.md` (v0.13, flujo de enlace); **reconstruida** por `ADR-010-password-reset-otp-flow.md` (v0.14, flujo de código OTP) — la entidad es la misma, su modelo cambió por completo. Una sola fila cubre las tres etapas del ciclo de vida de una solicitud: creada (código emitido) → verificada (código correcto, autorización emitida) → usada (contraseña cambiada) — no hay una tabla por etapa (`ADR-010` §Decisión).

**Propósito.** Una solicitud de recuperación de contraseña: primero un código de 6 dígitos que el usuario recibe por correo y transcribe de vuelta (`POST /api/forgot-password` → `POST /api/verify-reset-code`), después la autorización temporal que esa verificación emite para el paso final (`POST /api/reset-password`).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que el resto de entidades |
| `user_id` | **UUID**, FK → `users.id` | No | Dueño de la solicitud |
| `code_hash` | **TEXT** | No | Hash **scrypt** (`domain/auth/auth_service.hash_password`, el mismo algoritmo que `users.password_hash`) del código de 6 dígitos — nunca SHA-256: con solo `10^6` combinaciones, un hash rápido no protege nada ante una tabla filtrada (`ADR-010` §Opciones consideradas). `TEXT`, no una longitud fija corta: el formato de salida de scrypt no la tiene |
| `attempts` | **INTEGER**, `DEFAULT 0` | No | Intentos de verificación fallidos contra esta solicitud (`ADR-010` §Seguridad) |
| `expires_at` | `TIMESTAMPTZ` | No | Vigencia del código en sí — 10 minutos desde su creación (`domain/auth/token_policy.PASSWORD_RESET_CODE_TTL_MINUTES`) |
| `verified_at` | `TIMESTAMPTZ` | **Sí** | `NULL` = código todavía no verificado correctamente. Se fija una sola vez, junto con la autorización |
| `reset_authorization_hash` | `VARCHAR(64)` | **Sí** | SHA-256 (`domain/auth/token_generator.hash_token`) de la autorización temporal emitida al verificar el código — a diferencia de `code_hash`, esta sí es alta entropía (256 bits), mismo criterio de hash rápido que ya usaba el token de enlace de v0.13 |
| `reset_authorization_expires_at` | `TIMESTAMPTZ` | **Sí** | Vigencia de la autorización — 10 minutos desde la verificación (`PASSWORD_RESET_AUTHORIZATION_TTL_MINUTES`) |
| `used_at` | `TIMESTAMPTZ` | **Sí** | `NULL` = la contraseña todavía no se cambió con esta solicitud. Se fija una sola vez al consumirse (`reset_password_use_case.py`), nunca se revierte |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Sostiene el cooldown anti-spam de `POST /api/forgot-password`/"Reenviar código" (`has_recent_unused_code`) |

**Sin `updated_at`.** Mismo criterio que `likes`/`follows`/`notifications`: una solicitud avanza de etapa (creada → verificada → usada) mediante columnas propias, nunca se "edita" en el sentido de un `PATCH` genérico.

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `user_id → users.id`, `ON DELETE CASCADE` — mismo placeholder que el resto de entidades.

**Relaciones.** `users (1) ←→ (N) password_reset_tokens` — un usuario puede tener varias solicitudes a lo largo del tiempo (nunca más de una **activa** a la vez, ver constraint de abajo).

**Constraints relevantes**
- `user_id`/`code_hash`/`expires_at` **NOT NULL**.
- **`uq_password_reset_tokens_active_user`** — índice único **parcial**: `UNIQUE (user_id) WHERE used_at IS NULL`. **Primer índice parcial del esquema de THERS.** Garantiza a nivel de motor que nunca hay más de una solicitud activa por usuario, incluso ante dos "Reenviar código" simultáneos (`ADR-010` §Opciones consideradas — condición de carrera) — el repositorio (`infrastructure/persistence/repositories/password_reset_repository.py`) invalida la solicitud activa previa e inserta la nueva; si dos requests concurrentes chocan contra este índice, la que pierde la carrera reintenta (hasta 3 veces) en vez de fallar.
- **Sin `UNIQUE` sobre `code_hash`/`reset_authorization_hash`** (a diferencia de `token_hash` en v0.13) — dos solicitudes distintas del mismo o de distintos usuarios pueden, en teoría, terminar con el mismo código de 6 dígitos (espacio de solo `10^6` valores); el hash con salado de scrypt ya produce salidas distintas igual, pero la unicidad no es una invariante de negocio real acá como sí lo era con un token de 256 bits.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-010` §Decisiones pendientes): limpieza periódica de solicitudes vencidas.

---

### 5.8 `email_verification_tokens`

> Octava entidad con definición formal (capa 4.A). Ratificada originalmente por `ADR-009-password-reset-and-email-verification.md` (v0.13, flujo de enlace, sin cambios en v0.14 — solo `password_reset_tokens`, §5.7, se reconstruyó entonces); **reconstruida** por `ADR-011-mandatory-email-verification.md` (v0.15, flujo de código OTP de 6 dígitos, mismo patrón que §5.7) — la entidad es la misma, su modelo cambió por completo. A diferencia de `password_reset_tokens`, verificar el código **es** la acción final: no hay columnas de autorización temporal, el propio acierto ya marca `users.email_verified = true`.

**Propósito.** Un código de verificación de 6 dígitos que confirma que quien se registró controla de verdad la dirección de correo indicada, emitido automáticamente por `POST /api/register` (y reenviado por `POST /api/resend-registration-code`) y consumido por `POST /api/verify-registration-code`.

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que el resto de entidades |
| `user_id` | **UUID**, FK → `users.id` | No | Dueño del código |
| `code_hash` | **TEXT** | No | Hash **scrypt** (`domain/auth/auth_service.hash_password`, mismo algoritmo que `users.password_hash` y que `password_reset_tokens.code_hash`) del código de 6 dígitos — nunca SHA-256, mismo motivo que §5.7 (`10^6` combinaciones, un hash rápido no protege nada ante una tabla filtrada) |
| `attempts` | **INTEGER**, `DEFAULT 0` | No | Intentos de verificación fallidos contra este código (`ADR-011` §Seguridad) |
| `expires_at` | `TIMESTAMPTZ` | No | Vigencia del código — 10 minutos desde su creación (`domain/auth/token_policy.REGISTRATION_CODE_TTL_MINUTES`) |
| `used_at` | `TIMESTAMPTZ` | **Sí** | `NULL` = el código todavía no se verificó correctamente. Se fija una sola vez al verificarse (`verify_registration_code_use_case.py`), nunca se revierte |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Sostiene el cooldown anti-spam de `POST /api/register`/`POST /api/resend-registration-code` (`has_recent_unused_code`) |

**Sin `updated_at`.** Mismo criterio que `password_reset_tokens` (§5.7).

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `user_id → users.id`, `ON DELETE CASCADE`.

**Relaciones.** `users (1) ←→ (N) email_verification_tokens` — un usuario puede tener varios códigos a lo largo del tiempo (nunca más de uno **activo** a la vez, ver constraint de abajo); incluye los reintentos de registro sobre una cuenta nunca verificada (`ADR-011` §Decisión, Estrategia A).

**Constraints relevantes**
- `user_id`/`code_hash`/`expires_at` **NOT NULL**.
- **`uq_email_verification_tokens_active_user`** — índice único **parcial**: `UNIQUE (user_id) WHERE used_at IS NULL`. Mismo patrón que `uq_password_reset_tokens_active_user` (§5.7, primer índice parcial del esquema) — garantiza a nivel de motor que nunca hay más de un código activo por usuario, incluso ante dos "Reenviar código" simultáneos o un reintento de registro concurrente; el repositorio (`infrastructure/persistence/repositories/email_verification_repository.py`) invalida el código activo previo e inserta el nuevo, con el mismo reintento (hasta 3 veces) ante `IntegrityError` que `password_reset_repository.py`.
- **Sin `UNIQUE` sobre `code_hash`** — mismo motivo que §5.7: espacio de solo `10^6` combinaciones, no es una invariante de negocio real.
- **Tabla estructuralmente separada de `password_reset_tokens`** (`ADR-011` §Decisión, purpose separation) — no es un discriminador de tipo sobre una tabla compartida: un código de esta tabla nunca es una fila que `verify-reset-code` consulte, ni viceversa, así que el propósito de cada código queda separado por esquema, no solo por convención de aplicación.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-011` §Decisiones pendientes): limpieza periódica de códigos vencidos/cuentas nunca verificadas.

---

### 5.9 `user_identities`

> Novena entidad con definición formal (capa 4.A), ratificada por `ADR-012-google-sign-in.md`. Tabla separada de `users` (no columnas `google_sub`/`auth_provider` sueltas ahí) para que agregar Apple/Microsoft más adelante sea una fila nueva con otro `provider`, no una migración de esquema de `users`.

**Propósito.** Vincula una identidad externa (hoy solo Google) a un usuario de THERS. Un usuario puede tener cero, una, o varias identidades vinculadas a la vez -- por ejemplo, password + Google al mismo tiempo (account linking, `ADR-012` §Decisión).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que el resto de entidades |
| `user_id` | **UUID**, FK → `users.id` | No | Usuario de THERS al que pertenece esta identidad |
| `provider` | `VARCHAR(20)` | No | `"google"` hoy -- string libre, no `ENUM` de PostgreSQL, mismo criterio que `notifications.type` (`ADR-008`): discriminador validado en la aplicación |
| `provider_subject` | `TEXT` | No | El claim `sub` del ID Token de Google (identificador estable de la cuenta) -- nunca el email, que en teoría podría cambiar sin que la cuenta de Google deje de ser la misma |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Auditoría de cuándo se vinculó esta identidad |

**Sin `updated_at`.** Una identidad vinculada no se "edita" -- se crea o, en el futuro, se desvincula (funcionalidad todavía no implementada).

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `user_id → users.id`, `ON DELETE CASCADE`.

**Relaciones.** `users (1) ←→ (N) user_identities` — un usuario puede tener varias identidades vinculadas; cada identidad pertenece a exactamente un usuario.

**Constraints relevantes**
- `user_id`/`provider`/`provider_subject` **NOT NULL**.
- **`uq_user_identities_provider_subject`** — índice único: `UNIQUE (provider, provider_subject)`. Garantiza a nivel de motor que la misma cuenta de Google nunca termine vinculada a dos usuarios de THERS a la vez -- defensa de última línea contra la condición de carrera de dos requests simultáneas de `POST /api/auth/google` para una cuenta de Google que todavía no existía en THERS.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-012` §Decisiones pendientes): endpoint para listar/desvincular identidades propias; soporte para Apple/Microsoft (la tabla ya está preparada, falta el adaptador correspondiente).

---

### 5.10 `messages`

> Décima entidad con definición formal (capa 4.A), ratificada por `ADR-013-messages-minimal-model.md` — cubre solo la mitad 1:1 de la candidata "Conversaciones + Mensajes" (§4.B › Mensajería): mensaje directo entre dos usuarios reales, sin tabla `conversations`/`conversation_participants`. Una "conversación" es una vista derivada de los mensajes entre dos usuarios (`GET /api/conversations`), no una fila propia.

**Propósito.** Un mensaje de texto directo de un usuario a otro, con su estado de lectura.

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que el resto de entidades |
| `sender_id` | **UUID**, FK → `users.id` | No | Quién manda — siempre resuelto desde `get_jwt_identity()`, nunca aceptado del body |
| `recipient_id` | **UUID**, FK → `users.id` | No | Quién recibe — viene de la URL, nunca del body |
| `content` | **TEXT** | No | Sin límite de longitud a nivel de esquema — validado en la aplicación (máximo 2000 caracteres, mismo criterio que `posts`) |
| `read_at` | `TIMESTAMPTZ` | **Sí** | `NULL` = no leído. Se expone en la API como booleano (`read`), nunca como el timestamp crudo — mismo criterio que `notifications.read_at` |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Define el orden cronológico del hilo |
| `edited_at` | `TIMESTAMPTZ` | **Sí** | **v0.18 (`ADR-021`).** `NULL` = nunca editado. La fija `PATCH /api/messages/<id>`; se expone como el booleano `edited`, nunca como timestamp crudo — mismo criterio que `read_at`. Editar **no** toca `read_at`: un mensaje ya leído no vuelve a no leído porque se corrigió una palabra |

**Sigue sin `updated_at`** incluso desde que un mensaje se puede editar (v0.18), a diferencia de `posts`/`comments`: no hace falta un timestamp de "última escritura" genérico cuando las dos escrituras posibles sobre un mensaje (marcarse leído, editarse) ya tienen cada una su propia columna (`read_at`, `edited_at`).

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `sender_id → users.id` y `recipient_id → users.id` (ambas `ON DELETE CASCADE`, mismo placeholder que el resto de entidades).

**Relaciones.** `users (1) ←→ (N) messages` (dos veces: como remitente y como destinatario) — un usuario puede mandar y recibir muchos mensajes; cada mensaje tiene exactamente un remitente y un destinatario.

**Constraints relevantes**
- `sender_id`/`recipient_id`/`content` **NOT NULL**.
- **`ck_messages_no_self_message`** — segunda `CHECK` del esquema (`sender_id <> recipient_id`), mismo criterio que `ck_follows_no_self_follow` (§5.5): impide mandarse un mensaje a sí mismo incluso con un `INSERT` directo.
- **Sin `UNIQUE`.** Dos mensajes entre las mismas dos personas son eventos legítimos e independientes, no un duplicado a impedir — mismo criterio que `notifications`.

**Índices.** `ix_messages_sender_recipient_created` (`sender_id`, `recipient_id`, `created_at`) e `ix_messages_recipient_sender_created` (`recipient_id`, `sender_id`, `created_at`) — el hilo entre dos usuarios se busca con un `OR` sobre ambos sentidos de la relación, que ninguna columna única cubre; ambos índices permiten que PostgreSQL resuelva ese `OR` sin escanear la tabla completa (`ADR-013` §Índices).

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-013` §Decisiones pendientes): conversaciones grupales (`conversation_participants`), fotos/archivos adjuntos, actualización en tiempo real (WebSockets/Flask-SocketIO en vez de polling), confirmación de lectura visible para el remitente ("visto"). **Ya resueltos:** borrado de mensajes (`ADR-014`, *hard delete*) y edición de mensajes (`ADR-021`, v0.18, vía `edited_at`); el **historial de versiones** de una edición queda como pendiente nuevo (`ADR-021` §Decisiones pendientes) — exigiría una tabla propia, no una columna.

---

### 5.11 `mentions`

> Undécima entidad con definición formal (capa 4.A), ratificada por `ADR-023-mentions.md` — resuelve la candidata "Menciones" (§4.B › Notificaciones).

**Propósito.** Registrar que una persona fue mencionada (`@username`) en una publicación **o** en un comentario.

**Por qué se persiste en vez de derivarse del texto.** El permiso (`users.who_can_mention`) se evalúa **una vez, al escribir**. Así una mención ya aceptada sigue siendo válida si después la persona cierra sus menciones, y un `@username` que nunca tuvo permiso no se convierte en mención retroactivamente al cambiar la preferencia. Derivarla en cada lectura haría que el significado de un texto ya publicado cambiara con el tiempo (`ADR-023` §Opciones consideradas).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` — mismo patrón que el resto |
| `mentioned_user_id` | **UUID**, FK → `users.id` | No | A quién se menciona |
| `author_id` | **UUID**, FK → `users.id` | No | Quién la escribió. Redundante con `posts.author_id`/`comments.author_id`, pero guardarlo evita un JOIN en cada lectura y deja la fila auto-explicativa |
| `post_id` | **UUID**, FK → `posts.id` | **Sí** | Exactamente una de estas dos, impuesto por la `CHECK` de abajo |
| `comment_id` | **UUID**, FK → `comments.id` | **Sí** | — |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | — |

**Sin `updated_at` ni `edited_at`.** Una mención no se edita. Si se edita el texto que la contenía (`ADR-021`), las menciones de esa fila se **recalculan**: se borran las que ya no están y se crean las nuevas.

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** Las cuatro con `ON DELETE CASCADE`: borrar el post, el comentario o cualquiera de los dos usuarios se lleva la mención con él.

**Relaciones.** `users (1) ←→ (N) mentions` dos veces (como mencionado y como autor); `posts (1) ←→ (N) mentions` y `comments (1) ←→ (N) mentions`, de las cuales cada fila usa exactamente una.

**Constraints relevantes**
- `mentioned_user_id`/`author_id` **NOT NULL**.
- **`ck_mentions_exactly_one_target`** — **tercera `CHECK` del esquema** (`(post_id IS NULL) <> (comment_id IS NULL)`), después de `ck_follows_no_self_follow` (§5.5) y `ck_messages_no_self_message` (§5.10). Es lo que permite usar **una** tabla con dos targets posibles en vez de dos tablas casi idénticas (`ADR-023` §Opciones consideradas).

**Índices.** `uq_mentions_user_post` (`mentioned_user_id`, `post_id`) y `uq_mentions_user_comment` (`mentioned_user_id`, `comment_id`), las dos **UNIQUE parciales** (`WHERE ... IS NOT NULL`): una `UNIQUE` no parcial sobre las tres columnas no impediría nada, porque en PostgreSQL dos filas con `NULL` en una columna del índice no se consideran duplicadas. Más `ix_mentions_post_id` e `ix_mentions_comment_id`, para resolver "¿a quién menciona esto?" al renderizar un post o un hilo.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-023` §Decisiones pendientes): autocompletado de `@` (necesita un endpoint de búsqueda de usuarios que no existe), quitarse una mención ajena, listar las publicaciones donde me mencionaron, menciones en mensajes directos, y añadir `comment_id` a `notifications` para que una mención en un comentario apunte al comentario en vez de a su post (heredada de `ADR-020` §Riesgos).

---

### 5.12 `muted_keywords`

> Duodécima entidad con definición formal (capa 4.A), ratificada por `ADR-024-content-filters-and-privacy-preferences.md` — resuelve "Filtros de palabras clave personalizadas" de REF-SET-02.

**Propósito.** Términos que una persona no quiere ver, aplicados en el servidor a cada lectura de publicaciones y comentarios.

**Por qué es una tabla y no un array/JSON en `users`.** Hay que poder preguntar "¿algún término de este usuario aparece en este texto?" **desde el mismo `WHERE`** que lista posts/comentarios. Con un array habría que traer la lista a Python y filtrar después del `LIMIT`, que es exactamente lo que devuelve páginas cortas (mismo razonamiento que el filtro de visibilidad de `ADR-022`).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` |
| `user_id` | **UUID**, FK → `users.id` | No | De quién es el término. Nunca se acepta del body: sale de `get_jwt_identity()` |
| `keyword` | `VARCHAR(100)` | No | Normalizado a minúsculas y sin espacios alrededor por la aplicación (`domain/moderation/keyword_matching.py`) **antes** de insertar, con la misma función que después lo busca — si fueran dos criterios distintos se podría guardar un término que nunca llega a encontrarse. Acotado en el esquema, a diferencia de `content` (`TEXT`): un keyword no es texto libre. El límite real de negocio (60) vive en la aplicación |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Define el orden de la lista (más reciente primero) |

**Sin `updated_at`.** Mismo criterio que `likes`/`follows`: un término se agrega o se quita, nunca se edita in place.

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `user_id → users.id`, `ON DELETE CASCADE`.

**Relaciones.** `users (1) ←→ (N) muted_keywords`.

**Constraints relevantes**
- `user_id`/`keyword` **NOT NULL**.
- **`uq_muted_keywords_user_keyword`** (`user_id`, `keyword`) — impide duplicados y hace que agregar un término ya existente sea idempotente (mismo criterio que `likes`/`follows`). Como `keyword` se guarda ya normalizado, la UNIQUE distingue términos realmente distintos y no variaciones de mayúsculas.

**Índices.** Ninguno adicional: la `UNIQUE (user_id, keyword)` ya lidera por `user_id`, que es el único patrón de acceso real ("los términos de este usuario") — mismo razonamiento que `likes` (§5.3), que tampoco necesitó uno aparte.

**Límite de cardinalidad.** Máximo **100** términos por usuario, impuesto en la aplicación (no en el esquema). Existe porque cada término se traduce a un `ILIKE` en las consultas de lectura: una lista sin tope degradaría el feed de quien la tenga (`ADR-024` §Riesgos).

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-024` §Decisiones pendientes): normalización de acentos/Unicode al comparar (hoy "mañana" y "manana" son términos distintos a propósito), coincidencia por palabra completa en vez de subcadena, y filtrar `GET /api/notifications` por estos términos.

---

### 5.13 `sessions`

> Decimotercera entidad con definición formal (capa 4.A), ratificada por `ADR-025-session-registry.md`. **Es la entidad con más alcance del modelo:** no agrega un hecho al margen, redefine qué significa que un JWT sea válido.

**Propósito.** Representar cada token de sesión emitido, para poder listarlo y revocarlo.

**Por qué existe.** Hasta ADR-025 el JWT era puramente *stateless*: firmado, autocontenido, válido mientras no expirara y **sin ninguna operación capaz de invalidarlo**. Eso no era un descuido — es la propiedad por la que se elige un JWT — pero hacía que "cerrar sesión en ese dispositivo" fuera literalmente imposible de implementar. Esta tabla es el precio asumido para que ese control funcione de verdad (`ADR-025` §Opciones consideradas, que descarta una lista negra en memoria por perderse al reiniciar y no compartirse entre workers).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()`. Es lo que el cliente usa para revocar -- **no** el `jti` |
| `user_id` | **UUID**, FK → `users.id` | No | De quién es la sesión |
| `jti` | `VARCHAR(36)` | No | El identificador que flask_jwt_extended pone en cada JWT (un UUID v4 en texto). `VARCHAR` y no UUID nativo: es un valor que produce la librería, no el esquema, y tratarlo como texto evita depender de que su formato siga siendo exactamente un UUID. **Nunca cruza la frontera HTTP** (`API_CONTRACT.md` §4.12) |
| `user_agent` | `TEXT` | **Sí** | Lo que el cliente dijo de sí mismo, **crudo y sin parsear**: el servidor no tiene una base de datos de user agents y adivinar produciría etiquetas equivocadas *persistidas*. El resumen vive en el Frontend. Nullable porque un cliente no está obligado a mandarlo |
| `ip_address` | `VARCHAR(45)` | **Sí** | 45 = longitud máxima de una IPv6 en texto (incluido el formato mapeado a IPv4). Sale de `X-Forwarded-For` cuando existe, que el cliente puede falsificar -- **solo se muestra, nunca autoriza** |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Cuándo se inició; define el orden de la lista |
| `last_used_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Con throttle de 5 min impuesto en el propio WHERE, igual que `users.last_seen_at` (§5.1, ADR-024) -- sin él, el polling del chat (4 s, ADR-014) escribiría en cada petición. Es por eso **aproximado** |
| `revoked_at` | `TIMESTAMPTZ` | **Sí** | `NULL` = sesión viva |

**Sin `updated_at`.** Mismo criterio que `likes`/`follows`: las dos escrituras posibles (`last_used_at`, `revoked_at`) tienen cada una su columna con su propia semántica.

**Revocar marca, no borra.** La fila se conserva para que la heurística de "dispositivo conocido" de las alertas siga sabiendo que ese `user_agent` ya se había visto: si se borrara, cerrar sesión y volver a entrar desde el mismo navegador generaría una alerta falsa. Las revocadas **no se listan** -- conservarlas es para el servidor.

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `user_id → users.id`, `ON DELETE CASCADE`.

**Relaciones.** `users (1) ←→ (N) sessions`.

**Constraints relevantes**
- `user_id`/`jti` **NOT NULL**.
- **`uq_sessions_jti`** — un `jti` identifica una sola sesión. Es además el índice que sostiene la consulta más caliente del backend.

**Índices.** `uq_sessions_jti` (acceso por token, en cada petición protegida) e `ix_sessions_user_id_created_at` (listar las de una persona, que lidera por otra columna).

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-025` §Decisiones pendientes): purga periódica de las filas revocadas (crecen sin límite y no hay proceso programado, `CLAUDE.md` §15), *refresh tokens* y rotación, geolocalización aproximada de la IP, alertas por IP nueva además de por dispositivo nuevo, y límite de sesiones simultáneas.

---

### 5.14 `two_factor_recovery_codes`

> Decimocuarta entidad con definición formal (capa 4.A), ratificada por `ADR-026-two-factor-authentication.md`.

**Propósito.** Códigos de un solo uso para entrar cuando se pierde el dispositivo con la app autenticadora. Sin ellos, perder el teléfono significaría perder la cuenta.

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` |
| `user_id` | **UUID**, FK → `users.id` | No | De quién es el código |
| `code_hash` | `TEXT` | No | Hash **scrypt** del código, nunca el valor crudo -- mismo criterio que `PasswordResetToken.code_hash` (§5.7) y `EmailVerificationToken.code_hash` (§5.8). Acá **sí** se puede hashear, a diferencia de `users.totp_secret` (§5.1): el código viaja una vez y solo hay que compararlo, no reconstruirlo |
| `created_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | — |
| `used_at` | `TIMESTAMPTZ` | **Sí** | `NULL` = sin usar. Se marca en vez de borrar la fila, para poder informar cuántos quedan sin perder el rastro de cuántos se gastaron |

**Sin `updated_at`.** Mismo criterio que `password_reset_tokens` (§5.7): la fila avanza de etapa (creada → usada) mediante una columna propia.

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** `user_id → users.id`, `ON DELETE CASCADE`. Se borran además explícitamente al desactivar el 2FA: dejarlos permitiría entrar con un código de recuperación de un 2FA que ya no existe.

**Relaciones.** `users (1) ←→ (N) two_factor_recovery_codes`.

**Constraints relevantes**
- `user_id`/`code_hash` **NOT NULL**.
- **Sin `UNIQUE` sobre `code_hash`.** scrypt usa sal, así que dos códigos iguales producirían hashes distintos: una UNIQUE no garantizaría nada y tampoco hay motivo para impedirlo.

**Índices.** `ix_two_factor_recovery_codes_user_id` -- buscar los códigos sin usar de una persona al intentar entrar con uno. Hay que compararlos de a uno (scrypt usa sal, no se puede buscar por hash), pero son diez como máximo.

**Propiedades de los códigos** (en la aplicación, no en el esquema): diez por cuenta, diez caracteres de un alfabeto base32 sin ambigüedades visuales (sin `I`/`L`/`O`/`0`/`1`), ~48 bits de entropía. Mucho más que un OTP de 6 dígitos porque **no expiran** -- viven hasta que se usan, así que no pueden depender de una ventana de tiempo corta para ser seguros. Se comparan normalizados (mayúsculas, sin guion) para que escribirlos sin el guion no deje a nadie fuera de su cuenta.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-026` §Decisiones pendientes): ***rate limiting* de `POST /api/2fa/verify`** -- el más urgente, porque un TOTP son 10⁶ combinaciones y sin límite de intentos la fuerza bruta es concebible; cifrado de `users.totp_secret` en reposo; WebAuthn/llaves de seguridad; "recordar este dispositivo"; y 2FA obligatorio por rol (no existe el concepto de rol, §4.B).

---

### 5.15 `rate_limit_buckets`

> Decimoquinta entidad con definición formal (capa 4.A), ratificada por `ADR-027-rate-limiting.md`. **Es la única que no modela un hecho del producto** sino una defensa operativa: no aparece en ninguna respuesta de la API y su contenido es descartable.

**Propósito.** Contar intentos por (qué se limita, quién lo intenta) dentro de una ventana de tiempo, para poder rechazar los que se pasan del límite.

**Por qué existe.** Ningún endpoint limitaba intentos. Con `ADR-026` en producción eso dejó de ser una buena práctica ausente y pasó a ser explotable: `POST /api/2fa/verify` acepta un código de 10⁶ combinaciones en una ventana de 30 s, así que sin límite el segundo factor no protege nada.

**Por qué en PostgreSQL y no en memoria.** Un contador en memoria del proceso se pierde al reiniciar y no se comparte entre *workers*: con dos *workers* el límite real sería el doble del configurado. Es el mismo criterio por el que `ADR-025` descartó una lista negra en memoria para revocar tokens, y la razón por la que el indicador de "escribiendo" de `ADR-014` sí podía permitírselo (es efímero y cosmético; esto es un control de seguridad).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` |
| `scope` | `VARCHAR(40)` | No | Qué se limita (`'login'`, `'2fa_verify'`, `'register'`...). Los valores viven en `domain/rate_limiting/policy.py`, no en el esquema -- agregar un scope nuevo no debe exigir una migración (mismo criterio que `Notification.type`, ADR-008, y `Follow.status`, ADR-022) |
| `identity_hash` | `CHAR(64)` | No | **SHA-256 de la identidad** (una IP, un email, un `user_id`), en hexadecimal: siempre 64 caracteres, de ahí el CHAR fijo. Se hashea porque esta tabla solo necesita **contar**, nunca saber de quién. SHA-256 y no scrypt (a diferencia de `code_hash`, §5.7/§5.8): acá no se protege un secreto de baja entropía contra fuerza bruta offline, solo se evita guardar el dato en claro -- y corre en el camino caliente de cada intento de login |
| `window_started_at` | `TIMESTAMPTZ`, `DEFAULT now()` | No | Inicio de la ventana en curso. La fila se **reutiliza** (se reinicia la ventana) en vez de crearse una nueva por período |
| `attempts` | `INTEGER`, `DEFAULT 0` | No | Intentos dentro de la ventana en curso |

**Sin `created_at`/`updated_at`.** `window_started_at` ya es el timestamp que importa, y la fila no tiene historia: se reinicia, no se versiona.

**Clave primaria (PK).** `id`.

**Claves foráneas (FK).** **Ninguna**, y es deliberado: la identidad puede ser una IP o el email de una cuenta que no existe (un intento de login contra un email inventado también tiene que contar, porque si no se podría enumerar cuentas sin límite). Atarla a `users` dejaría fuera justamente los casos que más interesa limitar.

**Relaciones.** Ninguna. Es la única tabla aislada del esquema (§6).

**Constraints relevantes**
- `scope`/`identity_hash`/`window_started_at`/`attempts` **NOT NULL**.
- **`uq_rate_limit_scope_identity`** (`scope`, `identity_hash`) — un contador por combinación. Es además el índice sobre el que se resuelve el `ON CONFLICT` del UPSERT, que es el único acceso real a la tabla.

**Índices.** `uq_rate_limit_scope_identity` (el UPSERT) e `ix_rate_limit_buckets_window_started_at` (la purga de ventanas vencidas, que no usa el otro porque lidera por otra columna).

**Atomicidad.** Crear la fila, reiniciar la ventana vencida y sumar el intento ocurren en **una sola sentencia** (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`). Si fueran tres pasos, dos peticiones simultáneas leerían el mismo valor y escribirían el mismo incremento, perdiendo uno -- y la concurrencia **es** el escenario de un ataque de fuerza bruta, no un caso raro.

**Purga.** Las filas vencidas se borran de forma **oportunista** (una de cada 200 escrituras borra lo vencido hace más de 24 h), no por un proceso programado: el proyecto no tiene tareas periódicas (DevOps sin documentación oficial, `CLAUDE.md` §15). Funciona mientras haya tráfico; en un sistema parado las filas vencidas se quedan, sin afectar a ningún límite.

**Decisiones sobre esta entidad marcadas como PENDIENTES** (§14, `ADR-027` §Decisiones pendientes): extender el límite a los endpoints de **producto** (feed, posts, comentarios, mensajes) con un mecanismo más barato que una escritura por petición; purga programada en vez de oportunista; y *sliding window* en vez de ventana fija si el borde entre ventanas llega a importar (hoy permite un ritmo instantáneo de hasta 2× el configurado, aceptado conscientemente).

---

### 5.16 `refresh_tokens`

> Undécima entidad con definición formal, ratificada por `ADR-017-jwt-session-policy.md` (implementada el 2026-10-02).

**Propósito.** Sostener las sesiones de larga vida: un refresh token rotativo por login/dispositivo, revocable por reuso, logout o cambio de contraseña.

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` |
| `user_id` | **UUID**, FK → `users.id` | No | Dueño del token. `ON DELETE CASCADE` |
| `family_id` | **UUID** | No | Cadena de renovaciones de un mismo login. Se revoca entera ante reuso o logout |
| `token_hash` | **VARCHAR(64)** | No | SHA-256 hexadecimal del `jti` del JWT. Nunca el token ni su `jti` en claro (`ADR-017` §4.1) |
| `created_at` | **TIMESTAMPTZ** | No | `DEFAULT now()` |
| `expires_at` | **TIMESTAMPTZ** | No | 30 días desde la emisión (configurable) |
| `used_at` | **TIMESTAMPTZ** | Sí | Se fija al consumirlo en una renovación |
| `revoked_at` | **TIMESTAMPTZ** | Sí | Se fija en toda la familia ante reuso, logout o cambio de contraseña |
| `replaced_by_id` | **UUID** | Sí | Sucesor emitido al consumirlo (trazabilidad) |

**Relaciones.** `users (1) ←→ (N) refresh_tokens`.

**Constraints e índices**
- **`uq_refresh_tokens_token_hash`** — `UNIQUE (token_hash)`: lookup de `POST /api/refresh` y `/api/logout`.
- **`uq_refresh_tokens_active_family`** — índice único parcial sobre `family_id` `WHERE used_at IS NULL AND revoked_at IS NULL`: a lo sumo un token activo por familia (`ADR-017` §4.3), defensa de última línea contra dos rotaciones simultáneas.
- `ix_refresh_tokens_user_id` (revocar todas las sesiones de un usuario) y `ix_refresh_tokens_family_id`.

**Pendiente (no decidido):** limpieza periódica de filas expiradas o revocadas — hoy se acumulan.

---

### 5.17 `reports`

> Entidad con definición formal, **PROPUESTA** por `ADR-032-content-reports-and-moderation.md` (fase 1 implementada en una rama, sin mergear).

**Propósito.** Un reporte de un post, comentario, mensaje o cuenta, hecho por una persona, para que alguien lo revise (fase 2).

**Atributos principales**

| Columna | Tipo (conceptual) | Nulo | Justificación / origen |
|---|---|---|---|
| `id` | **UUID** | No | Clave primaria, `DEFAULT gen_random_uuid()` |
| `reporter_id` | **UUID**, FK → `users.id` | **Sí** | Quién reportó. **`ON DELETE SET NULL`**: si esa persona elimina su cuenta (`ADR-031`) el reporte sigue, sin autor |
| `target_type` | **VARCHAR(10)** | No | `post`, `comment`, `message` o `user`. Validado en la aplicación (`domain/reports/kinds.py`), no con un `ENUM`: agregar un tipo no exige migración |
| `target_id` | **UUID** | No | **Sin clave foránea**: apunta a tablas distintas según `target_type` |
| `reported_user_id` | **UUID**, FK → `users.id` | **Sí** | Autor del contenido o la cuenta reportada. `SET NULL` por el mismo motivo |
| `reason` | **VARCHAR(20)** | No | `spam`, `harassment`, `hate`, `sexual`, `violence`, `self_harm`, `illegal`, `impersonation`, `other`, `child_safety` (v0.24) |
| `priority` | **VARCHAR(10)** | No | **v0.24.** `normal` o `critical`; `DEFAULT 'normal'`, con `CHECK`. La asigna el **servidor** a partir del motivo: `child_safety` → `critical`, el resto → `normal`. Un reporte se eleva (nunca se degrada) si el mismo objetivo se reporta de nuevo con un motivo más urgente |
| `details` | **VARCHAR(500)** | Sí | Texto libre opcional |
| `status` | **VARCHAR(10)** | No | `open`, `reviewing`, `actioned`, `dismissed`. `DEFAULT 'open'`. En la fase 1 todo reporte nace y queda `open` |
| `content_snapshot` | **TEXT** | Sí | Copia del texto reportado (hasta 2000 caracteres) para que quien modere vea qué se dijo aunque el contenido se borre. **Se vacía al resolver** (fase 2). Para una cuenta, solo el texto **público** del perfil |
| `created_at` | **TIMESTAMPTZ** | No | `DEFAULT now()` |
| `resolved_at`, `resolved_by`, `resolution_note` | `TIMESTAMPTZ` / FK `users.id` `SET NULL` / `VARCHAR(500)` | Sí | De la fase 2: sin uso todavía |

**Relaciones.** `users (1) ←→ (N) reports` por tres columnas distintas (`reporter_id`, `reported_user_id`, `resolved_by`), todas `SET NULL`.

**Constraints e índices**
- **`uq_reports_reporter_target`** — `UNIQUE (reporter_id, target_type, target_id)`: reportar lo mismo dos veces es idempotente, también ante dos peticiones simultáneas. Con `reporter_id` nulo (cuenta eliminada) PostgreSQL no considera iguales dos filas, así que esos reportes no se bloquean entre sí: es lo deseado.
- **`ix_reports_status_created_at`** — la cola de moderación: abiertos primero, del más antiguo al más nuevo.
- **`ix_reports_status_priority_created_at`** — (v0.24) la cola con lo crítico primero. Aún no hay cola que la use: se crea ahora para no tener que migrar después.
- **`ck_reports_priority`** — `CHECK (priority IN ('normal', 'critical'))`.
- **`ix_reports_reported_user_id`** — «¿cuántos reportes tiene esta cuenta?».

**Pendiente (no decidido):** cuánto tiempo se conserva un reporte ya resuelto, y el esquema de la fase 2 (`is_moderator`, `suspended_at`, `suspension_reason`). Ver `ADR-032`.

---

### 5.18 `place_categories` y `places` (`ADR-040-thers-places.md`, fase 1, **PROPUESTO**)

Requieren la extensión **PostGIS** (la migración `a7c3e9d1b504` ejecuta `CREATE EXTENSION IF NOT EXISTS postgis`; el
`downgrade` no la borra).

**`place_categories`:** `id` (UUID), `slug` (único), `name`, `sort_order`, `is_active`. Las 12 categorías iniciales se
siembran en la propia migración: son datos de referencia, no de prueba.

**`places`:** `id` (UUID), `name`, `slug` (único), `description`, `category_id` (FK `RESTRICT`), `location`
(`geography(Point, 4326)`), `address`, `municipality`, `department`, `phone`, `website`, `verification_status`,
`source`, `coordinate_source`, `is_active`, `created_by_user_id` y `verified_by_user_id` (FK a `users`, `SET NULL`),
`last_verified_at`, `created_at`, `updated_at`.

- `CHECK` (no `ENUM`) sobre `verification_status`, `source` y `coordinate_source`; los valores viven en
  `domain/places/kinds.py`.
- Índices: **GiST** sobre `location` (`ix_places_location`), `category_id` y `(is_active, verification_status)`.
- **PostGIS no rechaza coordenadas fuera de rango:** `geography` guarda una latitud 95 como 85 y una longitud 190 como
  -170, sin error. Ninguna restricción de la base lo detecta, así que **toda escritura debe validar antes** con
  `validators.parse_coordinates`.
- Rendimiento verificado con 1016 lugares: `nearby` usa `ix_places_location` (`Bitmap Index Scan`), ~17 ms
  (`EXPLAIN ANALYZE`, detalle en `ADR-040` §12).
- No incluye todavía etiquetas, guardados, reportes, fotos ni cambios (fases siguientes).

### 5.19 `saved_places`, `place_reports` y `admin_audit_log` (`ADR-040`, fase 2, **PROPUESTO**)

Migración `b8d4f1a6c295` (aditiva). También crea la función `thers_unaccent` (inmutable) y el índice GIN trigram
`ix_places_name_search` para la búsqueda por nombre; activa `pg_trgm` y `unaccent` (el `downgrade` no las borra).

- **`saved_places`:** PK compuesta `(user_id, place_id)` (la base impide duplicados), `created_at`. FK a `users` y `places` con `CASCADE`.
- **`place_reports`:** `id`, `place_id` (`CASCADE`), `reporter_id` (`SET NULL`: el reporte sobrevive a quien lo hizo, como `reports`),
  `reason` y `status` con `CHECK`, `details`, `resolved_by_user_id` (`SET NULL`), `resolved_at`, `resolution_note`, `created_at`.
  Índice único parcial `(reporter_id, place_id, reason) WHERE status IN ('open','reviewing')`.
- **`admin_audit_log`:** `actor_id` (`SET NULL`: el registro sobrevive a la cuenta), `action`, `resource_type`, `resource_id`, `changes` (JSONB),
  `created_at`. Nunca guarda secretos.
- `ADR-031`: `places`, `place_reports` y `admin_audit_log` son excepciones documentadas (`SET NULL`) en la guardia de claves foráneas hacia `users`.
- `ADR-028`: la exportación de datos incluye `saved_places.json` y `place_reports.json`.

## 6. Relaciones entre entidades

**v0.8 — primera relación implementada:** `posts.author_id → users.id` (`ADR-004-posts-minimal-model.md`, ver §5.2) — `ON DELETE CASCADE`.

**v0.9 — segunda y tercera relación implementadas:** `likes.post_id → posts.id` y `likes.user_id → users.id` (`ADR-005-likes-minimal-model.md`, ver §5.3), ambas `ON DELETE CASCADE` — `likes` es la primera tabla puente N:N real del esquema.

**v0.10 — cuarta y quinta relación implementadas:** `comments.post_id → posts.id` y `comments.author_id → users.id` (`ADR-006-comments-minimal-model.md`, ver §5.4), ambas `ON DELETE CASCADE`.

**v0.11 — sexta y séptima relación implementadas:** `follows.follower_id → users.id` y `follows.followed_id → users.id` (`ADR-007-follows-minimal-model.md`, ver §5.5), ambas `ON DELETE CASCADE` — primera relación auto-referencial (`users`↔`users`) del esquema. Todo lo demás sigue siendo candidato (§4.B).

**v0.12 — octava, novena y décima relación implementadas:** `notifications.recipient_id → users.id`, `notifications.actor_id → users.id` y `notifications.post_id → posts.id` (`ADR-008-notifications-minimal-model.md`, ver §5.6), todas `ON DELETE CASCADE`. Todo lo demás sigue siendo candidato (§4.B).

**v0.13 — decimoprimera y decimosegunda relación implementadas:** `password_reset_tokens.user_id → users.id` (`ADR-009-password-reset-and-email-verification.md`, ver §5.7) y `email_verification_tokens.user_id → users.id` (ver §5.8), ambas `ON DELETE CASCADE`. Todo lo demás sigue siendo candidato (§4.B).

**v0.16 — decimotercera relación implementada:** `user_identities.user_id → users.id` (`ADR-012-google-sign-in.md`, ver §5.9), `ON DELETE CASCADE`.

**v0.17 — decimocuarta y decimoquinta relación implementadas:** `messages.sender_id → users.id` y `messages.recipient_id → users.id` (`ADR-013-messages-minimal-model.md`, ver §5.10), ambas `ON DELETE CASCADE`. Todo lo demás (conversaciones grupales) sigue siendo candidato (§4.B).

Regla de diseño para cuando existan más entidades (para evitar decisiones improvisadas durante la implementación):
- Las entidades dependientes referencian a `users` y/o `posts` (o a otras entidades ratificadas, cuando corresponda) con una FK.
- La cardinalidad, la política `ON DELETE` y las tablas puente (p. ej. relaciones N:N de "follows") se definirán **cuando esas entidades se ratifiquen**, cada una como ADR (`HB-001` §12). Las relaciones candidatas del producto objetivo se listan en §4.B, pero **no** se dibujan ni modelan aquí.

---

## 7. Convenciones

> ⚠️ Ninguna convención de base de datos está ratificada en `/docs` (`CLAUDE.md` §14). Las siguientes son **propuestas** alineadas con lo que el repo ya hace en otras capas (código en inglés, Python en `snake_case`). **Requieren ratificación del equipo (ADR, `HB-001` §12)** antes de tratarse como contrato cerrado.

| Elemento | Convención propuesta | Ejemplo |
|---|---|---|
| Nombres de tabla | inglés, `snake_case`, **plural** | `users`, `posts` |
| Nombres de columna | inglés, `snake_case`, singular | `email`, `created_at` |
| Clave primaria | columna `id` | `users.id` |
| Clave foránea | `<entidad_singular>_id` | `author_id`, `user_id` |
| Timestamps | `created_at`, `updated_at` (timestamp **con** zona horaria) | — |
| Booleanos | prefijo `is_`/`has_` | `is_active` |
| Enums / status | valores en `snake_case`; preferir columna de texto con `CHECK` o tipo `ENUM` de PostgreSQL — **la elección entre ambos queda PENDIENTE** (§14) | `status IN ('active','suspended')` |
| Nombres de índice | `ix_<tabla>_<columna(s)>`; únicos: `uq_<tabla>_<columna(s)>` | `uq_users_email` |

---

## 8. Índices

**Principio (repetido por su importancia):** no se crean índices especulativos. Cada índice listado justifica su existencia con una consulta real ya presente en el código.

| Índice propuesto | Tabla / columna | Consulta que lo justifica |
|---|---|---|
| Índice único de email | `users(email)` — `UNIQUE` | El login busca al usuario **por email** en cada intento de autenticación (`Login.jsx` envía `email`; el backend deberá hacer `SELECT ... WHERE email = ?`). La restricción `UNIQUE` de §5 crea este índice automáticamente y sirve tanto para integridad como para el lookup de login. |
| Índice único de username (`uq_users_username`) | `users(username)` — `UNIQUE` | **v0.5 (`ADR-002`).** `POST /api/register` valida unicidad de `username` en cada registro; la constraint `UNIQUE` de §5 crea este índice automáticamente. Ningún flujo consulta hoy por `username` fuera de esa validación de unicidad (login sigue siendo por email) — no se justifica un índice adicional de búsqueda. |
| `ix_posts_created_at` | `posts(created_at)` | **v0.8 (`ADR-004`).** `GET /api/posts` ordena por `created_at DESC` en cada consulta del feed — primer índice justificado por una consulta de una entidad distinta de `users`. |
| `uq_likes_post_user` | `likes(post_id, user_id)`, `UNIQUE` | **v0.9 (`ADR-005`).** Impone la regla de negocio (un usuario no likea el mismo post dos veces) y, por ser `post_id` su columna líder, ya cubre `COUNT(*)`/`IN (...)` por post sin necesitar un índice adicional. |
| `ix_comments_post_id_created_at` | `comments(post_id, created_at)`, compuesto | **v0.10 (`ADR-006`).** `GET /api/posts/<id>/comments` filtra por `post_id` y ordena por `created_at ASC` — la columna líder (`post_id`) cubre además el `COUNT(*)` de `comments_count` sin necesitar un índice adicional. |
| `uq_follows_follower_followed` | `follows(follower_id, followed_id)`, `UNIQUE` | **v0.11 (`ADR-007`).** Impone la regla de negocio (no seguir dos veces al mismo usuario) y cubre `following_count`/`POST .../follow` por ser `follower_id` su columna líder. |
| `ix_follows_followed_id` | `follows(followed_id)` | **v0.11 (`ADR-007`).** `followers_count` y "¿me sigue esta persona?" filtran por `followed_id` — a diferencia de `likes`, esta *no* es la columna líder de la `UNIQUE` de arriba, así que necesita su propio índice o escanearía la tabla completa. |
| `ix_notifications_recipient_id_created_at` | `notifications(recipient_id, created_at)`, compuesto | **v0.12 (`ADR-008`).** `GET /api/notifications` filtra por `recipient_id` (siempre el usuario autenticado) y ordena por `created_at DESC` — la columna líder (`recipient_id`) cubre el filtro sin escanear la tabla completa, mismo patrón que `ix_comments_post_id_created_at`. |
| `ix_messages_sender_recipient_created` / `ix_messages_recipient_sender_created` | `messages(sender_id, recipient_id, created_at)` y `messages(recipient_id, sender_id, created_at)`, ambos compuestos | **v0.17 (`ADR-013`).** El hilo entre dos usuarios (`GET /api/users/<id>/messages`) filtra con `(sender_id=A AND recipient_id=B) OR (sender_id=B AND recipient_id=A)` y ordena por `created_at` — ninguna `UNIQUE` cubre ese acceso (a diferencia de `likes`/`follows`), así que hacen falta ambos índices para que PostgreSQL resuelva el `OR` sin escanear la tabla completa. |
| `ix_password_reset_tokens_user_id_created_at` | `password_reset_tokens(user_id, created_at)`, compuesto | **v0.13 (`ADR-009`), sin cambios en v0.14.** `has_recent_unused_code` filtra por `user_id` y compara `created_at` contra el cooldown. |
| `ix_password_reset_tokens_reset_authorization_hash` | `password_reset_tokens(reset_authorization_hash)` | **v0.14 (`ADR-010`).** `find_valid_by_reset_authorization_hash` busca por este hash en cada `POST /api/reset-password` — reemplaza al índice de `token_hash` de v0.13 (ese lookup ahora es sobre `reset_authorization_hash`, no sobre el código en sí, que ya no admite búsqueda directa por hash al estar salado con scrypt). |
| `uq_password_reset_tokens_active_user` | `password_reset_tokens(user_id)`, `UNIQUE` **parcial** (`WHERE used_at IS NULL`) | **v0.14 (`ADR-010`).** Primer índice parcial del esquema — garantiza a lo sumo una solicitud activa por usuario, defensa de última línea contra la condición de carrera de dos "Reenviar código" simultáneos. |
| `ix_email_verification_tokens_user_id_created_at` | `email_verification_tokens(user_id, created_at)`, compuesto | **v0.13 (`ADR-009`), sin cambios en v0.15.** Mismo criterio que `ix_password_reset_tokens_user_id_created_at`, para el cooldown de `POST /api/register`/`POST /api/resend-registration-code`. |
| `uq_email_verification_tokens_active_user` | `email_verification_tokens(user_id)`, `UNIQUE` **parcial** (`WHERE used_at IS NULL`) | **v0.15 (`ADR-011`), reemplaza a `uq_email_verification_tokens_token_hash` de v0.13.** Mismo criterio que `uq_password_reset_tokens_active_user` — garantiza a lo sumo un código activo por usuario, defensa de última línea contra dos "Reenviar código" simultáneos o un reintento de registro concurrente. |
| `uq_user_identities_provider_subject` | `user_identities(provider, provider_subject)`, `UNIQUE` | **v0.16 (`ADR-012`).** `POST /api/auth/google` busca por (`provider`, `provider_subject`) en cada intento -- garantiza además que la misma cuenta de Google nunca quede vinculada a dos usuarios de THERS a la vez. |
| `ix_user_identities_user_id` | `user_identities(user_id)` | **v0.16 (`ADR-012`).** Lookup de "identidades de este usuario" -- no expuesto por ningún endpoint todavía, preparado para cuando lo esté (p. ej. listar/desvincular proveedores conectados). |

**No se añaden más índices en esta versión.** La PK (`id`) de cada entidad ya está indexada por definición. Cualquier índice adicional (p. ej. `posts(author_id)`, si en el futuro se filtra el feed por autor) se justificará **cuando exista la consulta que lo pague**, no antes.

---

## 9. Migraciones

| Aspecto | Estado |
|---|---|
| Estrategia | **Migraciones versionadas e incrementales**, cada cambio de esquema como un archivo de migración revisado por PR (coherente con el git flow de `HB-001` §7–9: nada al esquema sin PR + aprobación). |
| Herramienta | ~~PENDIENTE DE APROBACIÓN~~ — **resuelto: Flask-Migrate/Alembic** (`backend/migrations/`), implementado y verificado en esta tarea: `flask db upgrade`/`downgrade` probados dos veces cada uno contra PostgreSQL 16 real (Docker), incluida la reconstrucción completa desde un volumen vacío. Ratificación formal por el Comité Técnico pendiente de confirmar (`HB-001` §11.1). |
| Versionado | Cada migración es inmutable una vez fusionada a `develop`/`main`; los cambios posteriores son migraciones nuevas, no ediciones de una anterior. |
| Rollback | Cada migración debe declarar su reverso (downgrade). El **procedimiento operativo** de rollback en un entorno desplegado depende de DevOps, que es territorio no especificado (`CLAUDE.md` §14) → **PENDIENTE**. |
| Ubicación de artefactos | `REPOSITORY_STRUCTURE.md` §10 anticipa una carpeta futura `database/` para "scripts de migración, semillas y esquema versionado", hoy "presumiblemente dentro de `backend/`". La ubicación definitiva queda **PENDIENTE** hasta que el equipo la confirme. |

---

## 10. Seeds

| Aspecto | Definición |
|---|---|
| Propósito | Poblar la base con datos mínimos para desarrollo local y pruebas manuales. |
| Datos de desarrollo | Un conjunto pequeño de usuarios de prueba con contraseñas **de prueba** documentadas como tales. Nunca contraseñas reales de personas. |
| Separación desarrollo / producción | Los seeds de desarrollo **nunca** se ejecutan contra producción. Producción no lleva usuarios de ejemplo. La forma concreta de separar entornos (variable de entorno, comando distinto) depende de la configuración de entornos, hoy **PENDIENTE** (§14). |

> Actualización (v0.3): el usuario hardcodeado (`test@test.com` / `123456`) que vivía en `auth_service.py` **se eliminó del código** al integrar `register`/`login` con `users` real (`BACKEND_ARCHITECTURE.md` §9, v0.6) — no migró a un seed, simplemente se retiró. Sigue sin existir ninguna estrategia de seeds implementada (script, comando, datos de ejemplo); esta sección sigue describiendo el diseño esperado, no algo ya construido.

---

## 11. Integridad y seguridad

- **Constraints como defensa de datos.** Las reglas de integridad (unicidad de `email`, `NOT NULL`, futuros `CHECK`/enums) se declaran en el esquema, no solo en la aplicación (§3, §5).
- **Extensión `citext`.** El tipo `CITEXT` de `email` (§5) requiere `CREATE EXTENSION IF NOT EXISTS citext`, creada por la propia migración (`a1b2c3d4e5f6_create_users_table.py`) antes de crear la tabla — no requiere instalación manual adicional en la base.
- **Contraseñas.** Se almacena `password_hash`, **nunca** la contraseña en claro (§5). El algoritmo de hashing concreto queda **PENDIENTE** (§14) — es una decisión de seguridad que debe confirmar el equipo, no inferirse.
- **Secretos y credenciales.** La cadena de conexión y credenciales de la base **nunca** se suben al repositorio (`HB-001` §20, regla innegociable) y se proveen por variables de entorno. No hay lista oficial de variables de entorno (`CLAUDE.md` §9, §14) → definirla es **PENDIENTE**.
- **Acceso.** El backend accede a la base con un usuario de base de datos de privilegios acotados. La política concreta de roles/privilegios de PostgreSQL es **PENDIENTE** (depende de DevOps, no especificado).
- **Datos sensibles.** Hoy el único dato sensible identificado es la credencial de acceso del usuario (`password` → `password_hash`). Cualquier dato personal adicional que introduzcan futuras features (y su relación con las políticas de `Privacy`/`Cookies` del Frontend) deberá evaluarse cuando esas features existan → **PENDIENTE**.

> ✅ **Hallazgo de seguridad resuelto — corregido en v0.7 de este documento.** Versiones anteriores de esta sección advertían `backend/app/config.py` con `JWT_SECRET_KEY = "super-secret-key"` **hardcodeado en el repositorio**. Verificado directamente contra el código real en esta auditoría: `config.py` ya no tiene ningún literal hardcodeado — lee `JWT_SECRET_KEY` de `os.environ.get(...)`, con un valor de desarrollo explícitamente marcado como inseguro (`dev-only-insecure-key-CHANGE-ME`) como único fallback si la variable no está definida, y una advertencia impresa en `stderr` cuando eso ocurre (mismo mecanismo que `BACKEND_ARCHITECTURE.md` §12/§16/§19 ya documentaba como resuelto desde su v0.2). Esta sección quedó desincronizada con esa corrección — ya señalado, sin corregirse, en `ADR-003-profile-update-contract.md` §Estado actual. Sigue **pendiente**, sin cambios: la gestión de secretos para un entorno desplegado (vault, CI/CD) — ver §14.

---

## 12. Backups y recuperación

**No existe ninguna estrategia de backups o recuperación documentada** en `/docs` (`CLAUDE.md` §14 lo confirma explícitamente).

Estado: **PENDIENTE DE APROBACIÓN — sección completa.**

Preguntas abiertas que el equipo debe responder antes de considerar esta sección cerrada: frecuencia de respaldo, retención, ubicación de los backups, procedimiento y objetivo de recuperación (RPO/RTO), y responsable. Todo esto depende de DevOps, que es territorio no especificado — **no se inventa aquí**.

---

## 13. Integración con el Backend

Se describe la responsabilidad de cada capa **usando la estructura ya observada** en `backend/` (`domain/`, `application/`, `interfaces/routes/`), sin inventar una arquitectura distinta. `CLAUDE.md` §4 y `REPOSITORY_STRUCTURE.md` §6 advierten que estas capas están **observadas, no ratificadas**; este documento las respeta pero no las eleva a contrato cerrado.

| Capa observada | Responsabilidad respecto a la base de datos |
|---|---|
| **`domain/`** | Entidades y reglas de negocio puras (p. ej. qué es un usuario válido). **No** conoce SQL, ni el ORM, ni PostgreSQL. Hoy contiene `auth_service.py` (validación). |
| **`application/`** (use cases / services) | Orquesta el caso de uso (p. ej. "iniciar sesión") pidiendo datos a un repositorio, sin saber **cómo** se persisten. Hoy contiene `login_use_case.py`. |
| **Repositories** (capa a introducir) | Punto único donde vive el acceso a datos: traduce entre las entidades del dominio y las tablas de PostgreSQL. Es la frontera que aísla al resto del backend de los detalles del motor (coherente con el principio de "bajo acoplamiento", `FAS-001` §2). **Su ubicación exacta dentro de la estructura de capas queda PENDIENTE** (§14) porque no hay un documento de arquitectura de backend ratificado. |
| **Database layer / infraestructura** | Conexión, configuración del pool, inicialización del ORM/driver y ejecución de migraciones. Hoy `config.py` y `extensions.py` son los puntos donde esta responsabilidad encajaría, pero **no hay nada de base de datos cableado todavía**. |
| **`interfaces/routes/`** | Adaptadores HTTP; no tocan la base directamente — delegan en `application/`. Hoy contiene `auth_routes.py`. |

**Regla de dependencia:** las rutas dependen de los casos de uso, los casos de uso de los repositorios (abstractos), y solo la capa de infraestructura conoce PostgreSQL. Nunca al revés. Esto es una **descripción** del patrón ya insinuado por la estructura existente, no una decisión nueva.

---

## 14. PENDIENTES DE APROBACIÓN

Decisiones que este documento **no toma** porque no están respaldadas por la documentación oficial ni por una necesidad técnica evidente. Cada una debe resolverse como ADR (`HB-001` §11–12) antes de implementarse.

### Motor y dependencias
- ~~Versión de PostgreSQL para desarrollo local~~ — **resuelto: PostgreSQL 16** (`postgres:16-alpine` vía `docker-compose.yml`, raíz del repo), reproducible por cualquier integrante con `docker compose up -d`. No hay todavía una base compartida por el equipo o de producción; la versión oficial para esos entornos sigue sin ratificación formal.
- **Driver/adaptador Python** y **ORM** — **implementado en código** (`psycopg` v3 + SQLAlchemy + Flask-Migrate/Alembic, ver §2); ratificación formal por el Comité Técnico pendiente de confirmar.

### Esquema
- ~~Tipo de PK de `users`~~ — **resuelto: UUID**, `DEFAULT gen_random_uuid()` a nivel de PostgreSQL (implementado, ver §5; ratificación formal pendiente de confirmar).
- ~~Longitudes máximas de columnas de texto~~ — **resuelto:** `name VARCHAR(120)`; `email` (`CITEXT`) y `password_hash` (`TEXT`) sin límite fijo de longitud (ver §5).
- ~~Normalización de `email`~~ — **resuelto: `CITEXT`** (extensión de PostgreSQL, comparación e índice único case-insensitive a nivel de motor — ver §5, §11).
- **Algoritmo de hashing** de contraseñas — sigue pendiente (se usa `werkzeug.security`/scrypt como corrección puntual, no ratificado como definitivo).
- **Estrategia de enums** (columna de texto con `CHECK` vs tipo `ENUM` nativo) — no aplica a `users` todavía, sigue pendiente para entidades futuras.

### Entidades candidatas del modelo objetivo
La lista completa de estructuras candidatas del producto objetivo (con su **forma candidata, estado y motivo de decisión**) vive ahora en **§4.B**, para no duplicarla ni arriesgar divergencia. Criterio invariable: **ninguna se implementa sin ratificación por ADR** (`HB-001` §11–12), y su **modelado (PK/FK/tipos) permanece PENDIENTE**. ~~`posts`~~ — **resuelto en v0.8** (`ADR-004-posts-minimal-model.md`, ver §4.A/§5.2): solo su versión mínima de texto; sigue pendiente todo lo demás que §4.B › Contenido listaba junto a ella (`visibility`, edición/borrado, compartir). ~~`reactions` (caso binario)~~ — **resuelto en v0.9** (`ADR-005-likes-minimal-model.md`, ver §4.A/§5.3): solo like/no-like; sigue pendiente la forma general con tipos de reacción. ~~`comments` (mitad plana)~~ — **resuelto en v0.10** (`ADR-006-comments-minimal-model.md`, ver §4.A/§5.4): solo comentar un post; sigue pendiente `parent_comment_id`/hilos de respuestas. ~~`follows`~~ — **resuelto en v0.11** (`ADR-007-follows-minimal-model.md`, ver §4.A/§5.5): seguir/dejar de seguir y contadores; sigue pendiente listar seguidores/seguidos. ~~`notifications`~~ — **resuelto en v0.12** (`ADR-008-notifications-minimal-model.md`, ver §4.A/§5.6): solo los tipos `like`/`comment`/`follow`; sigue pendiente todo lo demás (respuestas, menciones, mensajes, push/email, preferencias, "marcar todas como leídas", borrado). ~~`password_reset_tokens`/`email_verification_tokens`~~ — **resuelto en v0.13** (`ADR-009-password-reset-and-email-verification.md`, ver §4.A/§5.7/§5.8); `password_reset_tokens` **reconstruida en v0.14** (`ADR-010-password-reset-otp-flow.md`, mismo §5.7 actualizado) y `email_verification_tokens` **reconstruida en v0.15** (`ADR-011-mandatory-email-verification.md`, mismo §5.8 actualizado), ambas para el mismo flujo de código OTP de 6 dígitos, sin afectar el estado "resuelto" de la candidata en sí. ~~`oauth_accounts`~~ — **resuelto en v0.16** (`ADR-012-google-sign-in.md`, ver §4.A/§5.9): entidad separada `user_identities`, preparada para más proveedores sin otra migración de `users`. ~~`messages` (mitad 1:1)~~ — **resuelto en v0.17** (`ADR-013-messages-minimal-model.md`, ver §4.A/§5.10): mensaje directo `sender_id`/`recipient_id`, sin tabla `conversations`/`conversation_participants`; sigue pendiente todo lo demás que §4.B › Mensajería seguía listando (grupos, fotos/archivos adjuntos). Entre las candidatas que siguen sin ratificar: `sessions`/`devices`, `user_settings`, columnas de perfil (`avatar_url`/`bio`), `media`, `reactions` (forma general con tipos), `saves`, `mentions`, `hashtags` (+`post_hashtags`), `blocks`, `restrictions`, `conversations` (+`conversation_participants`, para grupos), `message_media`, `password_changes`, `security_events`.

### Operación
- ~~Herramienta de migraciones~~ — **resuelto en código: Flask-Migrate/Alembic**, scaffolding en `backend/migrations/` (ver `BACKEND_ARCHITECTURE.md` §8); ratificación formal pendiente de confirmar. **Ubicación de la carpeta `database/`** sigue sin definir — las migraciones quedaron dentro de `backend/`, no en una carpeta `database/` separada.
- **Procedimiento de rollback** en entornos desplegados (DevOps).
- **Estrategia de backups y recuperación** — §12, sección completa pendiente.
- **Lista oficial de variables de entorno** — `DATABASE_URL` ya documentada en `backend/.env.example` (formato `postgresql+psycopg://usuario:password@host:puerto/nombre_bd`); sigue sin existir una lista oficial completa más allá de `JWT_SECRET_KEY` y `DATABASE_URL`.
- **Roles/privilegios de acceso** de PostgreSQL.
- **Ubicación exacta de la capa de repositorios** dentro de la estructura de backend — el modelo ya vive en `backend/app/infrastructure/persistence/models.py`, pero el repositorio que lo conecte con `application/`/`domain/` todavía no existe.

### Contradicciones / hallazgos reportados (no resueltos aquí)
- **README raíz dice MySQL** vs. PostgreSQL oficial (§2). Gana `/docs`; corregir el README en tarea aparte. *(Nota v0.7: `CLAUDE.md` §15 ya registra el `README.md` raíz como corregido en una tarea posterior — este documento no verificó esa corrección directamente, se deja la entrada por si el README volviera a divergir.)*
- ~~`JWT_SECRET_KEY` hardcodeado en `config.py`~~ — **corregido en v0.7 de este documento** (era un hallazgo obsoleto: el código ya lee `JWT_SECRET_KEY` de `os.environ` desde `BACKEND_ARCHITECTURE.md` v0.2; ver §11).
- ~~`username`/`phone`/`country_code`/`birth_date` en `users`~~ — **resuelto en v0.5** por `ADR-002-user-profile-fields.md` (ver §5). `avatar_url`/`bio` (§4.B › Perfil) **siguen** pendientes de ADR — no cubiertas por `ADR-002`.

---

## 15. Cierre

Este documento **no modifica** el backend, el Frontend, el Handbook ni instala dependencias: define el contrato de base de datos que la implementación futura deberá respetar, separando explícitamente **lo implementado (§4.A)**, **lo objetivo (§4.B)** y **lo pendiente (§4.C, §14)**. Cualquier cambio a este contrato sigue el proceso de decisiones de impacto medio/alto de `HB-001` §11–12 (ADR), no el criterio individual de quien implementa.
