# API_CONTRACT

| Campo | Valor |
|---|---|
| Documento | `docs/architecture/API_CONTRACT.md` |
| Versión | 0.37 (Propuesta) |
| Estado | **Pendiente de ratificación formal del equipo** (proceso de decisiones de alto impacto, `HB-001` §11–12) |
| Depende de | `BACKEND_ARCHITECTURE.md` (fuente directa del estado real del backend), `DATABASE_ARCHITECTURE.md` (modelo de datos disponible), `FRONTEND_ARCHITECTURE.md` (consumidor del contrato), `HB-001` §15.1 (exige documentar cada endpoint el mismo día del PR) |
| Autoridad sobre este documento | `/docs` oficial > estructura real observada en el código > este documento (mismo orden que `CLAUDE.md` §3) |

> ⚠️ **Nota de estado.** Este documento nace de un hueco identificado en la auditoría arquitectónica integral de THERS: no existía ninguna fuente única de verdad para el contrato entre Frontend y Backend, pese a que `HB-001` §15.1 ya exige documentar cada endpoint el mismo día de su PR. `BACKEND_ARCHITECTURE.md` §14 declara explícitamente fuera de su propio alcance "el catálogo completo de endpoints" — este documento es esa pieza separada, y hasta ahora no existía ninguna.
>
> Sigue el mismo método que `BACKEND_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md` y `FRONTEND_ARCHITECTURE.md` ya validaron: separa explícitamente **lo implementado** (un único endpoint real, con limitaciones conocidas) de **lo pendiente de definición** (formato de error estándar, convención de paginación, versionado de API, etc.). No se inventa aquí ningún endpoint, contrato o convención que el código o la documentación oficial no respalden todavía.
>
> Este documento no implementa, refactoriza ni modifica ningún código de `backend/` ni de `Frontend/`. Documenta el contrato tal como existe hoy y, donde falta una decisión, señala el hueco explícito — nunca un contrato inventado.
>
> **v0.2 — integración de autenticación con persistencia real:** `POST /api/register` pasó de "esperado pero no implementado" a **implementado** (§4.1), y `POST /api/login` se actualizó para consultar `users` real en vez de una credencial hardcodeada, incluyendo el cambio de `identity` del JWT de `email` a `user.id` (UUID). Reflejado en §4, §5, §6, §9. El Frontend (`Register.jsx`, `useAuth.js`) todavía no consume este contrato — esa integración queda fuera del alcance de esta tarea, que fue exclusivamente de backend.
>
> **v0.3 — perfil completo de registro + primer endpoint protegido (THERS Backend Fase 2.1, `ADR-002`):** `POST /api/register` ahora requiere también `username`, `phone`, `country_code`, `birth_date` y `confirm_password` (ratificado por `ADR-002-user-profile-fields.md`, que cierra la contradicción que `DATABASE_ARCHITECTURE.md` §4.B/§14 tenía registrada sobre estas columnas). `POST /api/login` expone los mismos campos nuevos en su respuesta. Se agrega `GET /api/users/me` — primer endpoint protegido del backend (`@jwt_required()`), documentado en §4.2. El Frontend (`Register.jsx`) ya recolecta estos campos pero todavía no los envía (comentario `TODO BACKEND` en el propio archivo) — esa integración sigue fuera de alcance, exclusivamente de backend igual que v0.2.
>
> **v0.4 — integración real del Frontend (THERS Frontend Fase 2.1):** `Register.jsx` ya envía el payload completo (`name`, `username`, `email`, `phone`, `country_code`, `birth_date`, `password`, `confirm_password`) — el comentario `TODO BACKEND` mencionado arriba fue removido. `AuthContext.jsx` reemplazó su restauración de sesión simulada (leer el último `user` guardado en `localStorage`) por una llamada real a `GET /api/users/me` con el JWT guardado, tanto al montar la aplicación como para toda lectura de la identidad actual; un `401`/`404` limpia la sesión local. Verificado end-to-end contra el backend real (`register` → `login` → `GET /api/users/me`, incluidos los casos sin token y con token inválido) — ver informe de la tarea para el detalle. No cambia ningún contrato de este documento, solo actualiza el estado de la integración del lado del Frontend.
>
> **v0.5 — actualización de perfil (THERS Backend, `ADR-003-profile-update-contract.md`):** se agrega `PATCH /api/users/me` (§4.2), primer endpoint de escritura protegido del backend. Permite actualizar `name`, `username`, `phone`+`country_code` y `birth_date` sobre `users` (mismas columnas que `GET /api/users/me` ya expone) — `email`/`password` quedan fuera por decisión explícita de `ADR-003`. `username` está sujeto a un cooldown de 30 días entre cambios (`users.username_changed_at`, migración `b2f4a19c3d7e`). El Frontend (`Profile.jsx`) todavía no consume este endpoint — sigue editando `bio`/`mood`/`interests`/`favoriteTrack` en `localStorage` y `name`/`username` con `updateStoredUser()`; conectar `Profile.jsx` a este contrato queda fuera de alcance de esta tarea, que fue exclusivamente de backend.
>
> **v0.6 — manejador global de errores (cierra §9 ítem 1):** `app/interfaces/error_handlers.py` (nuevo, `BACKEND_ARCHITECTURE.md` §11/§18/§19 v0.10) traduce cualquier `404`, `405`, otro `HTTPException` de Werkzeug (incluido un body no-JSON en `POST /api/register`/`POST /api/login`, que antes producía HTML) y cualquier excepción no controlada (`500`) al mismo formato `{"msg": "..."}` que ya usaban los 4 endpoints — **se mantiene ese formato sin cambios**, no se introduce `{"error": {...}}`, así que ningún endpoint existente cambia de contrato. Reflejado en §2 y §3. Verificado con 4 pruebas nuevas + la suite completa (56/56, ejecutada contra PostgreSQL 16 real).
>
> **v0.8 — primer endpoint de una entidad social real (`ADR-004-posts-minimal-model.md`):** se agrega `POST`/`GET /api/posts` (§4.3) — primera entidad del alcance objetivo del producto (`DATABASE_ARCHITECTURE.md` §4.B) en pasar a implementada, más allá de `users`. Modelo deliberadamente mínimo: solo texto, sin mood/imagen/hashtags/ubicación/reacciones/comentarios (cada uno queda para su propio ADR). Feed **global** — `GET /api/posts` devuelve posts de todos los autores, sin filtrar por `follows` (esa relación no existe todavía). El Frontend (`Home.jsx`, `CreateCapsuleFlow.jsx`) todavía no consume este contrato — sigue mostrando `mockCapsules`; conectar el Frontend queda fuera de alcance de esta tarea, que fue exclusivamente de backend. Verificado con 12 pruebas nuevas + la suite completa (71/71, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade`/`downgrade`).
>
> **v0.7 — validación de formato de `email` y longitud mínima de `password` en `POST /api/register` (cierra §9 ítem 2):** `domain/auth/validators.py` gana `is_valid_email()` (regex básica, sin verificar dominio real) e `is_valid_password()` (mínimo 8 caracteres, `MIN_PASSWORD_LENGTH`) — mismo patrón que los validadores ya existentes de `username`/`phone`/`country_code`/`birth_date`. Ambos umbrales son placeholders de producto explícitos y revisables (mismo criterio que `MIN_AGE_YEARS`, `ADR-002` §3), decididos como cambio técnico de bajo impacto (`HB-001` §11) por no alterar arquitectura, esquema ni ningún endpoint más allá de `register`. `POST /api/login` y `PATCH /api/users/me` **no cambian** — ninguno de los dos valida formato de credenciales (login no reformatea lo que ya existe; `PATCH` no permite editar `email`/`password`, `ADR-003`). Reflejado en §4.1 y §9. Verificado con 3 pruebas nuevas + la suite completa (59/59, ejecutada contra PostgreSQL 16 real).
>
> **v0.9 — corrección retroactiva de estado de integración del Frontend (este documento quedó desactualizado, no el código):** `Profile.jsx` (`feature/frontend-profile-page-redesign`, PR #43) ya consume `PATCH /api/users/me` para `name`/`username`, contradiciendo la nota de v0.5 de que "todavía no consume este endpoint" — `bio`/`mood`/`interests`/`favoriteTrack` siguen en `localStorage`, correctamente, porque esas columnas no están ratificadas (`DATABASE_ARCHITECTURE.md` §4.B). El feed (`AppShell.jsx`, `feature/frontend-feed-posts-integration`, PR #39) ya consume `GET`/`POST /api/posts` en vez de `mockCapsules`, contradiciendo la nota de v0.8. Ninguno de los dos contratos cambió — solo se corrige el estado de integración documentado, que no se había actualizado el mismo día de esos PRs (`HB-001` §15.1).
>
> **v0.10 — likes sobre posts (`ADR-005-likes-minimal-model.md`):** se agregan `POST`/`DELETE /api/posts/<post_id>/like` (§4.4) — segunda entidad del alcance objetivo del producto (`DATABASE_ARCHITECTURE.md` §4.B, candidata `reactions`) en pasar a implementada, en su versión mínima binaria (like/no-like, sin tipos de reacción). `GET`/`POST /api/posts` se extienden de forma aditiva con `likes_count`/`liked_by_me` (§4.3, §5) — no rompen el contrato existente. Ambos endpoints nuevos son idempotentes por diseño (§4.4). El Frontend (`CapsuleCard.jsx`) ya consume este contrato en la misma tarea. Verificado con 18 pruebas nuevas + la suite completa (89/89, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`).
>
> **v0.11 — comentarios sobre posts (`ADR-006-comments-minimal-model.md`):** se agregan `POST`/`GET /api/posts/<post_id>/comments` (§4.5) — tercera entidad del alcance objetivo del producto (`DATABASE_ARCHITECTURE.md` §4.B, candidata combinada "Comentarios + Respuestas") en pasar a implementada, solo en su mitad plana: comentar un post, sin hilos de respuestas. `GET`/`POST /api/posts` se extienden de forma aditiva con `comments_count` (§4.3, §5), sumado a `likes_count`/`liked_by_me` de v0.10 — no rompen el contrato existente. A diferencia del feed, el listado de comentarios va en orden cronológico ascendente (§4.5). El Frontend (`CapsuleCard.jsx`) ya consume este contrato en la misma tarea — panel expandible que carga el hilo bajo demanda (`GET .../comments` al abrirse, no precargado con el feed) y publica comentarios nuevos (`POST .../comments`). Verificado con 22 pruebas nuevas + la suite completa (93/93, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`), más una prueba manual end-to-end contra el backend real.
>
> **v0.12 — seguir/dejar de seguir usuarios (`ADR-007-follows-minimal-model.md`):** se agregan `POST`/`DELETE /api/users/<user_id>/follow` (§4.6) — cuarta entidad del alcance objetivo del producto (`DATABASE_ARCHITECTURE.md` §4.B, candidata `follows`) en pasar a implementada. `GET`/`PATCH /api/users/me` se extienden con `followers_count`/`following_count` (§4.2, §5); `GET`/`POST /api/posts` se extienden con `author.is_followed_by_me` (§4.3, §5) — ninguna rompe el contrato existente. El feed **sigue global**, no se personaliza por seguidos (`ADR-007` §No objetivos — decisión de producto separada, no un efecto colateral de este ADR). El Frontend ya consume este contrato en la misma tarea: `CapsuleCard.jsx` gana "Seguir"/"Siguiendo" sobre el autor de un post real, `Profile.jsx` muestra `followers_count`/`following_count` reales. El panel de sugerencias mock de `Home.jsx` no se toca — sus personas no son usuarios reales. Verificado con 17 pruebas nuevas + la suite completa (124/124, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`), más una prueba manual end-to-end contra el backend real.
>
> **v0.15 — recuperación de contraseña por código OTP de 6 dígitos (`ADR-010-password-reset-otp-flow.md`, reemplaza el flujo de enlace de v0.14):** `POST /api/forgot-password` deja de generar un enlace y genera un código de 6 dígitos (también sirve como "Reenviar código"); se agrega `POST /api/verify-reset-code` (§4.8) que verifica el código y devuelve una autorización temporal de propósito específico (nunca un JWT de sesión); `POST /api/reset-password` cambia su body de `token` a `reset_authorization`. Protecciones nuevas: máximo 5 intentos por solicitud, hashing scrypt del código (no SHA-256, por su baja entropía), índice único parcial que garantiza a lo sumo un código activo por usuario incluso ante reenvíos simultáneos. `send-verification-email`/`verify-email` **no cambian** — siguen exactamente como en v0.14. El Frontend queda conectado de punta a punta: `ForgotPassword.jsx` (sin conectar hasta ahora), nueva pantalla `VerifyResetCode.jsx`, `ResetPassword.jsx` adaptada. Verificado con 31 pruebas nuevas + la suite completa (189/189, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`), más una prueba manual end-to-end contra el backend real (código incorrecto, código correcto, autorización de un solo uso, login con la contraseña nueva).
>
> **v0.17 — "Continuar con Google" (`ADR-012-google-sign-in.md`):** se agrega `POST /api/auth/google` (§4.9) — método de autenticación **adicional**, no reemplaza `register`/`login` tradicional. Recibe `{credential}` (ID Token de Google Identity Services), lo verifica criptográficamente (firma/`iss`/`aud`/`exp`, librería oficial `google-auth`), y crea/vincula/loguea según corresponda; nunca confía en datos que el Frontend diga que vienen de Google. `users` relaja `phone`/`country_code`/`birth_date`/`password_hash` a nullable (Google no entrega los primeros tres, y una cuenta Google-only no tiene contraseña local) — `register`/`login` tradicional siguen exigiendo todo igual que siempre, sin cambio de comportamiento. El objeto `user` (§5) gana `profile_completed` (si falta completar `phone`/`country_code`/`birth_date`, reutiliza `PATCH /api/users/me` sin endpoint nuevo) y `has_password` (booleano derivado). Account linking con una cuenta tradicional del mismo email: se vincula automático si esa cuenta ya estaba verificada, se "reclama" (anulando cualquier contraseña existente) si nunca se verificó — nunca por la sola coincidencia del email sin esa garantía. Una cuenta Google-only puede fijar su primera contraseña reutilizando `forgot-password`/`verify-reset-code`/`reset-password` (`ADR-010`) sin ningún cambio de código ahí. Verificado con 30 pruebas nuevas (`test_google_id_token_verifier.py` + `test_google_auth.py`, Google mockeado — nunca llamadas reales) + la suite completa (242/242, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`).
>
> **v0.16 — verificación obligatoria de email al registrarse (`ADR-011-mandatory-email-verification.md`, reemplaza `send-verification-email`/`verify-email` de v0.14):** `POST /api/register` (§4.1) sigue devolviendo `201` con el usuario creado, pero ahora `email_verified` nace en `false` y de inmediato se envía un código de 6 dígitos — la cuenta no puede iniciar sesión todavía. Registrar de nuevo con un email que existe pero nunca se verificó **actualiza esa misma cuenta** (incluida la contraseña) y reenvía un código, en vez de un `409` — el `409` real solo ocurre si el email ya pertenece a una cuenta verificada. `POST /api/login` (§4.1) gana un caso nuevo: credenciales correctas pero cuenta sin verificar responde `403` con `{"msg": "...", "email_verified": false}`, sin emitir ningún JWT. Se agregan `POST /api/verify-registration-code` y `POST /api/resend-registration-code` (§4.8) — mismo patrón que `verify-reset-code`/`forgot-password` (`ADR-010`): 6 dígitos, hash scrypt, máximo 5 intentos, cooldown de 60s, índice único parcial (a lo sumo un código activo por usuario). Un código de registro nunca sirve para verificar una recuperación de contraseña ni viceversa — viven en tablas/repositorios completamente separados, no un discriminador de tipo sobre una tabla compartida. **Se retiran** `POST /api/send-verification-email` y `POST /api/verify-email` (`ADR-009`, flujo de enlace) — con el login ya bloqueado para cuentas sin verificar, una cuenta sin verificar nunca puede obtener el JWT que el primero exigía, dejando ambos permanentemente inalcanzables. El Frontend queda conectado de punta a punta: `Register.jsx` navega a la nueva pantalla `VerifyRegistrationCode.jsx` en vez de a `/login`; `Login.jsx` distingue el `403` de cuenta sin verificar y redirige a la misma pantalla. Verificado con 36 pruebas nuevas (`test_registration.py`, reemplaza a `test_email_verification.py`) + la suite completa (212/212, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`).
>
> **v0.14 — recuperación de contraseña y verificación de email vía Resend (`ADR-009-password-reset-and-email-verification.md`):** se agregan `POST /api/forgot-password`, `POST /api/reset-password`, `POST /api/send-verification-email` y `POST /api/verify-email` (§4.8) — séptima y octava entidad del alcance objetivo del producto (`DATABASE_ARCHITECTURE.md` §4.B, candidata "Verificación de correo, Recuperación de contraseña") en pasar a implementadas. Rutas planas bajo `/api`, sin prefijo `/auth/` — mismo criterio que `/api/register`/`/api/login`. `forgot-password` nunca revela si un email está registrado (mismo mensaje `200` siempre); `reset-password`/`verify-email` usan tokens de un solo uso, expirables, con hash SHA-256 persistido (nunca el valor crudo). `GET`/`PATCH /api/users/me` y `register`/`login` se extienden de forma aditiva con `email_verified` (§4.2, §5) — no rompe el contrato existente. Nuevo servicio de correo centralizado (Resend, SDK oficial) detrás de un `EmailSender` abstracto — ningún endpoint llama a Resend directamente. Verificado con 30 pruebas nuevas + la suite completa (175/175, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`), más una prueba manual end-to-end contra el backend real (los cuatro endpoints, con `NullEmailSender` en desarrollo sin `RESEND_API_KEY`).
>
> **v0.37 — THERS Places, fase 2 (`ADR-040`, **PROPUESTO**):** `GET /api/places/search`, `GET /api/places/saved`, `POST|DELETE /api/places/<id>/save`, `POST /api/places/<id>/report` y las rutas de moderación `/api/moderation/places/*` (§4.24). **Cambio en el contrato de la fase 1:** los resúmenes y el detalle de lugares ganan `is_saved` (siempre presente; `false` para quien no ha iniciado sesión). Un token ausente, vencido o inválido en el catálogo público se trata como anónimo, no como error. Las rutas de moderación de lugares reutilizan `is_moderator`: quien no lo es recibe el mismo `404` que una ruta inexistente. Tablas nuevas `saved_places`, `place_reports` y `admin_audit_log` (`DATABASE_ARCHITECTURE.md` v0.29).
> **v0.36 — THERS Places, fase 1 (`ADR-040-thers-places.md`, **PROPUESTO**):** `GET /api/places/categories`, `GET /api/places`, `GET /api/places/nearby` y `GET /api/places/<id>` (§4.23). **Lectura pública, sin JWT**, con límite de uso por IP (`places_read`, 120/min). Solo devuelven lugares activos y `verified`. Cambios aditivos: ningún cliente actual se rompe. Tablas nuevas `place_categories` y `places` (`DATABASE_ARCHITECTURE.md` v0.28). Los guardados, reportes, administración y búsqueda de texto son de la fase 2.
> **v0.35 — moderación de la plataforma (`ADR-032`, fase 2):** `GET /api/moderation/reports` y `POST /api/moderation/reports/<id>/resolve` (§4.22), solo para cuentas con `is_moderator` (cualquier otra recibe el mismo `404` que una ruta inexistente). El objeto `user` propio gana `is_moderator`. `POST /api/login`, `POST /api/auth/google` y `POST /api/2fa/verify` responden `403` con `suspended: true` y `suspension_reason` a una cuenta suspendida. Cambios aditivos.
>
> **v0.34 — sincronización del chat (`ADR-035-chat-sync.md`, **PROPUESTO**):** `POST /api/users/<id>/messages` acepta `client_id` opcional (envío idempotente por remitente: `201` la primera vez, `200` si ya existía); `GET /api/users/<id>/messages` acepta `limit`, `before` y `after` (instantes ISO 8601 con zona horaria) y devuelve `has_more`. El mensaje público gana `client_id`. Cambios aditivos y compatibles (§4.10).
>
> **v0.33 — eliminación de cuenta (`ADR-031-account-deletion.md`, aceptado con cambios, implementado sin commit hasta esta rama):** `POST /api/account-deletion/request` y `POST /api/account-deletion/confirm` (§4.19), públicos y sin JWT. Cambio aditivo. Los mensajes de la cuenta eliminada se borran en las dos bandejas.
>
> **v0.32 — seguridad infantil en los reportes (`ADR-038-child-safety-reports.md`, **PROPUESTO**, implementado sin commit):** `POST /api/reports` acepta el motivo nuevo `child_safety` («Explotación o abuso de menores») y la respuesta gana `priority` (`normal` o `critical`). **La prioridad la decide solo el servidor**: `child_safety` es siempre `critical`, y cualquier `priority` enviada por el cliente se ignora. Un reporte posterior más urgente sobre el mismo objetivo **eleva** el existente (no se degrada nunca). Límite propio de 30 por hora para este motivo. Cambio aditivo y compatible. Ver §4.18.
>
> **v0.31 — reportes de contenido y aceptación de términos (`ADR-032-content-reports-and-moderation.md`, fase 1, **PROPUESTO**, implementado en una rama sin mergear):** se agrega `POST /api/reports` y `POST /api/users/me/terms-acceptance` (§4.18). `POST /api/register` y `POST /api/auth/google` aceptan `terms_accepted` (opcional por defecto; obligatorio cuando el entorno define `TERMS_ACCEPTANCE_REQUIRED`, que arranca **apagado**). El objeto `user` gana `terms_accepted` (§5). Tabla nueva `reports` y columnas `users.terms_accepted_at` / `users.terms_version` (`DATABASE_ARCHITECTURE.md` v0.23). Cambio aditivo: ningún cliente actual se rompe. No incluye las rutas de moderación (cola, resolver, suspender): son de la fase 2. **Pendiente de la ratificación de `ADR-032`.**
>
> **v0.30 — corrección retroactiva de `POST /api/2fa/verify` (§4.12):** la respuesta `200` ya devolvía `refresh_token` (el segundo paso del login emite la sesión por el mismo camino que `login` y `auth/google`, `ADR-017`), pero no figuraba en este contrato. Sin ese campo, un cliente que implemente el 2FA no sabe que debe guardarlo. Hallado al implementar el segundo factor en la app móvil. Sin cambio de código.
>
> **v0.29 — integración de la sesión con refresh token (`ADR-017`) y el registro de sesiones (`ADR-025`):** las dos ramas de trabajo se unen. `POST /api/login`, `POST /api/auth/google` y `POST /api/2fa/verify` devuelven ahora `token` **y** `refresh_token`. Cada login abre **una** sesión visible en `GET /api/sessions`; `POST /api/refresh` re-vincula esa misma sesión al access token nuevo (no crea una fila por renovación). **Cerrar una sesión (`DELETE /api/sessions/<id>`), cambiar la contraseña o desactivar el 2FA invalida también su refresh token**: la renovación exige una sesión viva en la familia y responde `401` si no la hay. `POST /api/logout` cierra la sesión del registro además de la familia. Los refresh tokens se validan contra `refresh_tokens` y no contra `sessions`. Los ADR de la rama de privacidad y seguridad se renumeraron a `ADR-019`…`ADR-030` para no chocar con `ADR-015`…`ADR-018`; las secciones `refresh` y de imágenes de perfil de la otra rama pasan a ser §4.16 y §4.17.
>
> **v0.28 — preferencias de contenido y feed (`ADR-030-content-preferences.md`):** se agrega §4.15 con `GET`/`POST`/`DELETE /api/users/me/muted-topics` y `GET /api/users/suggestions`, más dos **campos nuevos en endpoints existentes**: `is_sensitive` (entrada opcional de `POST /api/posts` y salida de todo post) y `hide_sensitive_content` (en `/api/users/me/privacy`). Ninguna respuesta existente pierde ni cambia un campo. Una migración (`e1b5c9d3a7f4`): `posts.is_sensitive`, `users.hide_sensitive_content` y la tabla `muted_topics`. **Las palabras ocultas (`ADR-024`) ya funcionaban y no se tocaron.** `GET /api/posts` ahora también omite los posts sensibles (si la persona lo activó) y los de temas silenciados.
>
> **v0.27 — bloqueo y restricción de cuentas (`ADR-029-blocked-and-restricted-accounts.md`):** se agrega §4.14 con `GET`/`POST`/`DELETE /api/users/me/blocks` y `/api/users/me/restrictions`. Resuelve los dos controles `pending` de REF-SET-10. **Es el único cambio hasta ahora que modifica el comportamiento de endpoints existentes:** feed, comentarios, likes, follows, mensajes, notificaciones y menciones respetan el bloqueo (§4.14), con dos respuestas nuevas — `409` en `POST /users/<id>/follow` y `POST /users/<id>/messages` cuando quien pregunta bloqueó al destino. Una migración (`d9a3b7f1c5e2`): tabla `user_restrictions`. La forma de ningún endpoint existente cambia en su camino de éxito.
>
> **v0.26 — exportación de datos (`ADR-028-data-export.md`):** se agrega §4.13 con `POST /api/data-exports`, `GET /api/data-exports` y `GET /api/data-exports/<id>/download`. Resuelve los tres controles `pending` de «Descarga de datos y archivo» (REF-SET-09). Una migración (`c4d8e2a6f913`): tabla `data_exports`. El ZIP no está cifrado y caduca a los 7 días; máximo una solicitud por hora y por cuenta. Ningún endpoint existente cambia.
>
> **v0.25 — rate limiting de los endpoints de autenticación (`ADR-027-rate-limiting.md`):** **resuelve el ítem 8 de §9**, que v0.24 había registrado como pendiente explícito tras descubrir que en `POST /api/2fa/verify` esa ausencia era explotable (un código TOTP son 10⁶ combinaciones en una ventana de 30 s).
>
> **Primer uso de `429` en la API** (§3). Nueve endpoints pueden devolverlo ahora: `POST /api/login`, `/register`, `/forgot-password`, `/resend-registration-code`, `/verify-reset-code`, `/verify-registration-code`, `/2fa/verify`, `/2fa/confirm`, `/2fa/disable` y `/2fa/recovery-codes`. **Ninguno cambia de forma en su camino de éxito** — el `429` es una respuesta nueva, no una modificación de las existentes. Siempre lleva el header `Retry-After` y, además, `retry_after_seconds` en el body: decir "demasiados intentos" sin decir cuánto esperar deja al cliente reintentando a ciegas.
>
> Dos semánticas distintas y deliberadas: en los endpoints de **credenciales** se cuentan los **fallos** y un acierto borra el contador (lo que hay que frenar es *adivinar*, no *usar* — si no, quien entra y sale legítimamente varias veces quedaría bloqueado); en los que **mandan un correo o crean una cuenta** se cuentan **todas** las llamadas, porque ahí el éxito ES el abuso. Los endpoints que protegen una cuenta concreta (`login`, `2fa/verify`) limitan por **cuenta y por IP** a la vez: la IP sola es evadible (`X-Forwarded-For` se falsifica), la cuenta sola no vería un ataque contra muchas cuentas desde un mismo origen.
>
> Complementa, sin reemplazarlos, los límites que ya existían: los 5 intentos **por código** de `ADR-010`/`ADR-011` y sus cooldowns de 60 s **por cuenta**. El hueco que cerraban a medias era que pedir un código nuevo daba 5 intentos más indefinidamente, y que el cooldown no frenaba a una IP bombardeando muchas direcciones distintas.
>
> Una migración (`b6e3a9d4f270`): tabla `rate_limit_buckets`, con la identidad **hasheada** (SHA-256) porque la tabla solo necesita contar, nunca saber de quién. Sin dependencias nuevas — se descartó Flask-Limiter porque su almacenamiento recomendado es Redis, que no está en el stack, y su backend en memoria no sirve con varios workers (mismo criterio por el que `ADR-025` descartó una lista negra en memoria). Verificado con 20 pruebas nuevas + la suite completa (476/476, ejecutada contra PostgreSQL 16 real, incluido un ciclo `upgrade`/`downgrade`/`upgrade`). **Lo que sigue pendiente, acotado y dicho:** los endpoints de producto (feed, posts, comentarios, mensajes) **no** tienen límite, y donde solo se limita por IP el header sigue siendo falsificable (`ADR-027` §Riesgos).
>
> **v0.24 — pantalla de Seguridad: registro de sesiones, alertas de acceso y 2FA (`ADR-025-session-registry.md`, `ADR-026-two-factor-authentication.md`):** de los cinco controles de REF-SET-03, dos ya funcionaban (el correo de cambio de contraseña, `ADR-010`, y la verificación de email, `ADR-011`) y **no se tocaron**; los tres restantes pasan a funcionar.
>
> **Cambio transversal más importante de todas las versiones de este contrato: el JWT deja de ser puramente *stateless*.** Ningún endpoint cambia de forma, pero **todos los protegidos cambian de condición de validez**: un token solo autentica si su `jti` tiene una sesión viva en `sessions`. Cerrar una sesión invalida su token de inmediato (antes era imposible: un token firmado valía hasta expirar). Consecuencias asumidas: una consulta a la base por petición protegida, y los tokens emitidos antes de la migración dejan de valer (todo el mundo se desloguea una vez). El `401` de un token revocado lleva un mensaje propio, distinto del de expirado.
>
> **`POST /api/login` y `POST /api/auth/google` ganan una SEGUNDA forma de respuesta `200`** (§4.1, §4.9): si la cuenta tiene 2FA, devuelven `{"two_factor_required": true, "two_factor_token": "..."}` **sin** `token` ni `user` — es `200` y no `4xx` porque nada salió mal, falta el segundo paso. Un cliente que asuma que un `200` siempre trae `token` se rompe; la forma vieja sigue siendo la de toda cuenta sin 2FA. El segundo paso es `POST /api/2fa/verify` (§4.12), que acepta un TOTP de 6 dígitos **o** un código de recuperación y devuelve la sesión real.
>
> Endpoints nuevos (§4.12): `GET`/`PATCH /api/users/me/security` (preferencia de alertas; endpoint propio y no parte de `/users/me/privacy` — privacidad es "quién ve qué", seguridad es "quién puede entrar"), `GET /api/sessions`, `DELETE /api/sessions/<session_id>`, `DELETE /api/sessions` (cierra las demás, nunca la propia), `GET /api/2fa`, `POST /api/2fa/setup`, `POST /api/2fa/confirm`, `POST /api/2fa/disable`, `POST /api/2fa/recovery-codes` y `POST /api/2fa/verify` (el único público de los diez).
>
> `POST /api/reset-password` **no cambia de forma** pero ahora cierra **todas** las sesiones de la cuenta: antes del registro de sesiones esto era imposible, y era un agujero concreto -- quien restablecía su contraseña porque sospechaba un acceso ajeno no echaba a ese acceso.
>
> **Dos migraciones** (`f1a4c8e2d573`, `a3c9f5b1e648`): tablas `sessions` y `two_factor_recovery_codes`, más `users.login_alerts_enabled`/`totp_secret`/`two_factor_enabled`. Una dependencia nueva de backend (`pyotp`, confinada a `infrastructure/auth/`) y una de frontend (`qrcode`: el QR se genera en el navegador para que el secreto no pase por un servicio externo). **El *rate limiting* se registra por fin como pendiente explícito en §9 (ítem 8)** — varios ADR anteriores lo citaban como si ya estuviera ahí y no lo estaba; v0.24 lo corrige, y señala que en `POST /api/2fa/verify` esa ausencia sí es explotable. Verificado con 42 pruebas nuevas + la suite completa (456/456, ejecutada contra PostgreSQL 16 real, incluido un ciclo `upgrade`/`downgrade`/`upgrade` sobre `thers_dev` y `thers_test`).
>
> **v0.23 — pantalla de Privacidad: cuentas privadas, menciones y filtros de contenido (`ADR-022-private-accounts.md`, `ADR-023-mentions.md`, `ADR-024-content-filters-and-privacy-preferences.md`):** los seis controles de REF-SET-02 estaban marcados como "sin soporte"; cinco pasan a aplicarse de verdad en el servidor. **Es la primera versión en que endpoints de lectura ya existentes dejan de devolver lo mismo a todo el mundo:** `GET /api/posts` excluye las publicaciones de cuentas privadas que quien pregunta no sigue, y `GET /api/posts/<id>/comments` + `POST`/`DELETE /api/posts/<id>/like` responden `404` sobre contenido de una cuenta privada ajena (`404` y no `403`: un `403` confirmaría que ese post existe y de quién es). Ninguno de los tres **cambia de forma**. Endpoints nuevos (§4.11): `GET`/`PATCH /api/users/me/privacy` (las siete preferencias; endpoint propio y no parte de `PATCH /api/users/me`, que es el contrato del perfil y tiene reglas que no aplican acá), `GET /api/follow-requests`, `POST /api/follow-requests/<user_id>/accept`, `DELETE /api/follow-requests/<user_id>` y `GET`/`POST`/`DELETE /api/users/me/muted-keywords`. `POST`/`DELETE /api/users/<id>/follow` ganan el campo aditivo `follow_status` (`null`/`'pending'`/`'accepted'`): seguir a una cuenta privada crea una **solicitud**, no una relación, y `following` conserva su significado exacto (relación efectiva, `false` en una pendiente). `POST /api/users/<id>/messages` gana un `403` cuando el destinatario no acepta mensajes de quien escribe — excepción deliberada al `404` de cuentas privadas: quien escribe ya sabía que esa cuenta existe. `post`/`comment` ganan `mentions` (aditivo, solo las menciones que el servidor autorizó — un `@username` inexistente o no autorizado **no** es mención y no debe enlazarse); `post.author` gana `follow_status` e `is_private`; `user` gana `is_private`; `notification.type` suma `follow_request`, `follow_accepted` y `mention`; `conversation.user` gana `last_seen_at` (`null` tanto si está oculto como si nunca hubo actividad, indistinguibles a propósito). **`comments_count` y el listado de comentarios pasan a depender de quién pregunta** y usan el mismo predicado, para que el contador nunca contradiga la lista. **Tres migraciones** (`c3e7b1d9a482`, `d5f9c3e1b764`, `e7b2d4f8c916`): `users.is_private`/`who_can_mention`/`who_can_message`/`hide_offensive_comments`/`show_activity_status`/`last_seen_at`, `follows.status`, y las tablas `mentions` y `muted_keywords`. El sexto control (canales de audio) **sigue sin soporte**, con el motivo corregido: no falta un endpoint, falta la función de producto. Verificado con 76 pruebas nuevas + la suite completa (414/414, ejecutada contra PostgreSQL 16 real, incluido un ciclo completo de `flask db upgrade`/`downgrade`/`upgrade` sobre `thers_dev` y `thers_test`).
>
> **v0.22 — edición de contenido propio: publicaciones, comentarios y mensajes (`ADR-021-content-editing.md`, extiende `ADR-004`/`ADR-006`/`ADR-013`):** se agregan `PATCH /api/posts/<post_id>` (§4.3), `PATCH /api/comments/<comment_id>` (§4.5) y `PATCH /api/messages/<message_id>` (§4.10) — las tres superficies de contenido propio se podían crear y borrar, pero no corregir. Los tres comparten la misma forma: body `{"content"}` (único campo editable, **obligatorio**, con el mismo validador y el mismo límite que al crear), respuesta `200` con el recurso completo ya actualizado, y `404` indistinguible si el id no existe **o** existe pero es de otra persona (mismo criterio que los tres `DELETE` equivalentes, v0.19/v0.20/v0.21). Verbo `PATCH` y ruta plana, igual que `PATCH /api/users/me` y `DELETE /api/messages/<id>`. **Esta versión sí trae migración** (`a2c6e9b3f571`), a diferencia de v0.20/v0.21: una columna `edited_at` nullable en `posts`, `comments` y `messages`. `POST`/`GET` de las tres entidades se extienden de forma **aditiva** con el booleano `edited` (§5) — ningún campo existente cambia de nombre, tipo ni semántica. `edited_at` **nunca** cruza la frontera HTTP como timestamp: solo se expone `edited`, así que la UI dice «editado» y no «editado hace 5 min» (mismo criterio que `read_at`→`read`). Editar preserva todo lo que el contenido acumuló: el `id` de la fila no cambia, así que likes y comentarios siguen colgando del mismo post; `created_at` tampoco, así que una publicación editada **no sube** en el feed; `read_at` tampoco, así que editar un mensaje ya leído no lo devuelve a no leído. Sin historial de versiones, sin ventana de tiempo para editar y sin notificación de la edición (`ADR-021` §No objetivos/§Riesgos). El Frontend queda conectado en la misma tarea: edición **en línea** (sin `ConfirmDialog` — una edición se puede volver a editar) en `CapsuleCard.jsx` (publicaciones y comentarios) y `Messages.jsx` (mensajes), con la marca «editado» junto a la hora. Verificado con 46 pruebas nuevas + la suite completa (338/338, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`).
>
> **v0.21 — borrado de comentarios propios (`ADR-020-comment-deletion.md`, extiende `ADR-006`):** se agrega `DELETE /api/comments/<comment_id>` (§4.5) — hasta ahora `comments` solo se podía crear y listar. Solo el autor del comentario puede borrarlo; si no existe **o** existe pero es de otra persona responde el mismo `404`, sin distinguir cuál ocurrió — incluido el dueño de la publicación, que **no** puede borrar comentarios ajenos en ella (decisión de producto separada, `ADR-020` §Decisiones pendientes). *Hard delete*, no idempotente (`200` y luego `404`), ruta plana bajo `/comments/<id>` (mismo razonamiento que `DELETE /api/messages/<id>`, v0.19). Ningún endpoint existente cambia de contrato y no hay migración: `comments` no tiene tablas dependientes. `comments_count` de `GET`/`POST /api/posts` baja en consecuencia. Limitación conocida: la notificación "comentó tu publicación" ya generada **no se retira**, porque `notifications` no guarda a qué comentario corresponde (`ADR-020` §Riesgos). El Frontend queda conectado en la misma tarea: `CapsuleCard.jsx` gana una papelera sobre los comentarios propios, con confirmación en un diálogo propio de THERS.
>
> **v0.20 — borrado de publicaciones propias (`ADR-019-post-deletion.md`, extiende `ADR-004`):** se agrega `DELETE /api/posts/<post_id>` (§4.3) — hasta ahora `posts` solo se podía crear y listar, sin ninguna operación de borrado. Solo el autor puede borrar su propia publicación; si el post no existe **o** existe pero es de otra persona, responde el mismo `404`, sin distinguir cuál de los dos ocurrió (mismo criterio que `DELETE /api/messages/<message_id>`, v0.19). *Hard delete*, sin placeholder "publicación eliminada". **No es idempotente**, a diferencia de `DELETE .../like` y `DELETE .../follow` (`ADR-005`/`ADR-007`): borrar dos veces devuelve `200` y después `404`. Ningún endpoint existente cambia de contrato y no hay migración nueva — los `ON DELETE CASCADE` de `likes`/`comments`/`notifications` sobre `posts.id` (`ADR-005`/`ADR-006`/`ADR-008`) ya estaban declarados y pasan a ejercerse por primera vez: borrar un post borra sus likes, comentarios y notificaciones en la misma transacción. El Frontend queda conectado en la misma tarea: `CapsuleCard.jsx` gana una acción "Eliminar" visible solo sobre una publicación propia (con confirmación previa) y `AppShell.jsx` la resuelve con actualización optimista y rollback, más una recarga de `GET /api/notifications` porque las de ese post desaparecen en cascada.
>
> **(rama `develop`, antes numerada v0.20) — corrección retroactiva: imágenes y bio de perfil (`ADR-015-profile-media.md`):** este documento quedó atrasado respecto al código (no al revés), igual que en v0.9. `ADR-015` ya estaba implementado en el backend y consumido por el Frontend sin figurar aquí, contra `HB-001` §15.1. Se documentan: el objeto `user` gana `bio`, `location`, `website`, `avatar_url` y `cover_url`; `PATCH /api/users/me` acepta `bio`/`location`/`website`; y cuatro rutas nuevas (`POST`/`DELETE /api/users/me/avatar`, `POST`/`DELETE /api/users/me/cover`) más `GET /api/media/<ruta>` (§4.12). Se verificaron contra el código y la suite del backend, no contra el ADR.
>
> **(rama `develop`, antes numerada v0.21) — sesión con refresh token rotativo (`ADR-017-jwt-session-policy.md`):** `POST /api/login` y `POST /api/auth/google` **agregan** `refresh_token` al cuerpo (cambio aditivo: `token` y `user` no cambian). Se agregan `POST /api/refresh` y `POST /api/logout` (§4.16), ambos autenticados con el **refresh** token en `Authorization: Bearer`. Cada renovación consume el refresh presentado y emite un par nuevo; reusar uno ya consumido revoca toda esa sesión. `POST /api/reset-password` ahora además revoca todas las sesiones del usuario. Access token: 15 min; refresh: 30 días; ambos explícitos en `config.py` y sobreescribibles por entorno. Nueva tabla `refresh_tokens` (`DATABASE_ARCHITECTURE.md` v0.18). Ningún endpoint protegido cambia: siguen aceptando solo access tokens. Verificado con 24 pruebas nuevas (incluida una carrera real de dos renovaciones simultáneas) + la suite completa (316/316, contra PostgreSQL 16 real).
>
> **v0.19 — borrado de mensajes, corte de no-leídos y "escribiendo..." (`ADR-014-messages-ux-improvements.md`, extiende `ADR-013`):** se agregan `DELETE /api/messages/<message_id>` (borra un mensaje propio, sin placeholder) y `POST`/`GET /api/users/<user_id>/typing` (§4.10) — a partir de feedback real probando el chat entre el equipo. `GET /api/users/<user_id>/messages` **no cambia de forma**, pero corrige cuándo se evalúa `read`: ahora refleja el estado antes de que esa misma llamada marque como leído (antes, por cómo Flask-SQLAlchemy expira sus objetos tras un `commit()`, ya aparecía en `true` para los mensajes recién marcados) — permite que el Frontend ubique un separador de "mensajes no leídos". El indicador de "escribiendo" vive en memoria del proceso del backend, no en PostgreSQL — es información efímera, sin migración ni tabla nueva; no sobrevive un reinicio ni se comparte entre varios workers (`ADR-014` §Riesgos). El Frontend (`Messages.jsx`) hace *polling* de `GET .../typing` cada 2 segundos mientras un hilo está abierto (más rápido que el *polling* general del chat, 4s) y manda `POST .../typing` con *debounce* mientras el usuario escribe. Verificado con 13 pruebas nuevas + la suite completa (276/276, ejecutada contra PostgreSQL 16 real).
>
> **v0.18 — mensajes directos (`ADR-013-messages-minimal-model.md`):** se agregan `POST`/`GET /api/users/<user_id>/messages` y `GET /api/conversations` (§4.10) — décima entidad del alcance objetivo del producto (`DATABASE_ARCHITECTURE.md` §4.B, candidata `conversations`+`messages`) en pasar a implementada, solo en su mitad 1:1: mensaje directo entre dos usuarios reales, sin conversaciones grupales ni tabla `conversation_participants`. `GET .../messages` marca como leídos, como efecto secundario, los mensajes recibidos de esa persona — no hay un `PATCH .../read` separado (`ADR-013` §Opciones consideradas). Sin tiempo real: el Frontend refresca por *polling*, mismo criterio que `ADR-008` para notificaciones. Ningún endpoint existente cambia de contrato. El Frontend queda conectado en la misma tarea: `Messages.jsx` deja de estar vacío y consume `GET /api/conversations`/`GET .../messages`; `unreadMessages` de `Sidebar`/`Topbar` pasa a sumar `unread_count` real en vez de quedar en `0`. Verificado con 21 pruebas nuevas + la suite completa (263/263, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`).
>
> **v0.13 — notificaciones (`ADR-008-notifications-minimal-model.md`):** se agregan `GET /api/notifications` y `PATCH /api/notifications/<id>/read` (§4.7) — sexta entidad del alcance objetivo del producto (`DATABASE_ARCHITECTURE.md` §4.B, candidata `notifications`) en pasar a implementada. Cubre solo los tres eventos que el backend ya sabe generar: dar like a un post (`ADR-005`), comentarlo (`ADR-006`) y seguir a un usuario (`ADR-007`) — nunca al propio actor sobre su propio contenido, y nunca duplicada por una repetición idempotente de un like/follow ya existente (`ADR-008` §Opciones consideradas). `POST /api/posts/<id>/like`, `POST /api/posts/<id>/comments` y `POST /api/users/<id>/follow` **no cambian su contrato** — la notificación es un efecto secundario invisible en la respuesta de quien dispara la acción. El Frontend ya consume este contrato en la misma tarea: `AppShell.jsx` reemplaza `mockNotifications` por `GET /api/notifications` (mismo patrón que `capsules`/`posts`, `ADR-004`) y `handleMarkRead`/`handleMarkAllRead` llaman a `PATCH .../read` con optimistic update (mismo patrón que `handleToggleLike`, `ADR-005`); sin endpoint de "marcar todas" en el backend (`ADR-008` §No objetivos), `handleMarkAllRead` itera sobre las no leídas. Verificado con 21 pruebas nuevas + la suite completa (145/145, ejecutada contra PostgreSQL 16 real, incluido un ciclo de `flask db upgrade` sobre `thers_dev` y `thers_test`), más una prueba manual end-to-end contra el backend real con dos usuarios reales generando los tres tipos de evento.

---

## 1. Propósito y alcance

**Propósito.** Ser la única fuente de verdad del contrato HTTP entre `Frontend/` y `backend/`: qué endpoints existen, qué reciben, qué devuelven, cómo se autentican y cómo se comunican los errores — de modo que Backend y Frontend puedan implementar en paralelo contra el mismo contrato acordado, en vez de negociarlo ad-hoc en cada feature (que es lo que ha ocurrido hasta ahora: `Register.jsx` ya asume un endpoint `/register` que el backend no expone).

**Alcance.** Cubre exclusivamente el contrato HTTP expuesto por `backend/` bajo el prefijo `/api` y consumido por `Frontend/` a través de `shared/lib/api.js`. Incluye: catálogo de endpoints, formato de request/response, autenticación, formato de error, códigos HTTP y convenciones para endpoints futuros.

**Fuera de alcance de este documento:**
- Implementación interna del backend (capas `domain/`, `application/`, `interfaces/`) — cubierta por `BACKEND_ARCHITECTURE.md`.
- Modelo de datos y persistencia — cubierto por `DATABASE_ARCHITECTURE.md`.
- Cómo el Frontend consume el contrato internamente (hooks, componentes, estado) — cubierto por `FRONTEND_ARCHITECTURE.md`.
- Especificación formal OpenAPI/Swagger — se evalúa como evolución futura (§10), no se adopta en esta versión por ser desproporcionado frente a un único endpoint real (principio de simplicidad, mismo criterio que `FAS-001` §2 aplica por analogía en los otros documentos de THERS).
- Autorización por roles/permisos — no existe ningún concepto de rol en el sistema hoy (`BACKEND_ARCHITECTURE.md` §9); no se inventa aquí.

---

## 2. Convenciones generales

| Aspecto | Estado |
|---|---|
| Prefijo base | `/api` — todos los blueprints se registran bajo este prefijo (`create_app()`, `url_prefix="/api"`) |
| Formato de body | JSON exclusivamente, en request y response (`request.get_json()` / `jsonify(...)`) — sin excepción observada en el código actual |
| Autenticación | `Bearer <jwt>` en el header `Authorization` — **v0.3: ya verificada contra un endpoint protegido real** (`GET /api/users/me`, §4.2), usando `@jwt_required()`/`get_jwt_identity()` de `flask_jwt_extended` |
| Verbos HTTP | Declarados explícitamente por ruta (`methods=["POST"]`); **no hay convención documentada** todavía para operaciones futuras (GET de colección, PUT/PATCH de actualización, DELETE) — `PENDIENTE DE APROBACIÓN` (§9) |
| Versionado de API | **No existe.** No hay prefijo de versión (`/api/v1`) ni ningún mecanismo de versionado — `PENDIENTE DE APROBACIÓN` (§9) |
| Paginación | **No existe.** Ningún endpoint actual devuelve una colección — `PENDIENTE DE APROBACIÓN` (§9) |
| CORS | Habilitado globalmente sin restricción de origen (`CORS(app)`, `BACKEND_ARCHITECTURE.md` §13) — responsabilidad del backend, el Frontend no la controla |
| Manejo global de errores | **v0.6 — implementado.** `app/interfaces/error_handlers.py` (`BACKEND_ARCHITECTURE.md` §11/§18/§19) captura cualquier error no anticipado por una route específica (`404`, `405`, otros `HTTPException`, `500`) y responde con el mismo formato que el resto de la API — ver §3 |

---

## 3. Formato de error

> **v0.25 (`ADR-027-rate-limiting.md`): `429 Too Many Requests`.** Primer código
> nuevo que se suma al formato desde v0.6. Respeta el mismo cuerpo que el resto
> (`{"msg": "..."}`) y añade dos cosas:
>
> - el header **`Retry-After`** (segundos), que es el estándar HTTP y lo que
>   cualquier cliente sabe interpretar;
> - **`retry_after_seconds`** en el body, el mismo valor, porque es lo que los
>   consumidores ya tienen a mano sin leer headers.
>
> Se eligió `429` y no `403`: el pedido no está prohibido, está **de más**. Lo
> devuelven los nueve endpoints de autenticación listados en el changelog de
> v0.25; ninguno lo devuelve en su camino de éxito.


**v0.6 — ya aplicado de forma uniforme a toda la API, no solo observado en un endpoint:**

```json
{ "msg": "<texto del error>" }
```

- Usado para validación fallida (`400`), credenciales inválidas (`401`), recurso no encontrado (`404`), conflicto de unicidad (`409`) — construidos explícitamente por cada route — **y ahora también** para cualquier error no anticipado por ninguna route: `404`/`405` genéricos, cualquier otro `HTTPException` de Werkzeug (p. ej. un body no-JSON en `POST /api/register`/`POST /api/login`, que antes de v0.6 producía HTML en vez de este formato) y `500` (excepción no controlada) — `app/interfaces/error_handlers.py`, `BACKEND_ARCHITECTURE.md` §11.
- No hay campo de código de error machine-readable, ni estructura anidada (`{"error": {"code": ..., "message": ...}}`) — decisión deliberada de v0.6: mantener el contrato existente en vez de introducir uno nuevo sin necesidad demostrada.
- **v0.6 — resuelto.** Ya existe un manejador global de excepciones (`@app.errorhandler`, vía `register_error_handlers()`) registrado en `create_app()` — un `500` o `404` no manejado responde `{"msg": "..."}`, nunca el comportamiento HTML por defecto de Flask. El `500` nunca expone traceback, tipo de excepción, ni datos sensibles (`DATABASE_URL`, `JWT_SECRET_KEY`) — verificado por prueba (`backend/tests/test_error_handlers.py`).

Sigue **`PENDIENTE DE APROBACIÓN`** (§9, degradado de prioridad tras v0.6): si el equipo quiere evolucionar `{"msg": "..."}` hacia un formato con código de error machine-readable — no hay ninguna necesidad actual que lo justifique, este documento no lo propone por iniciativa propia.

---

## 4. Catálogo de endpoints

### 4.1 Implementados

#### `POST /api/register`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — semántica ampliada por `ADR-011-mandatory-email-verification.md`: la cuenta se crea sin verificar y no puede iniciar sesión hasta completar `POST /api/verify-registration-code` (§4.8) |
| Blueprint | `auth_bp` (`backend/app/interfaces/routes/auth_routes.py`) |
| Auth requerida | No (endpoint público) |

**Request body**
```json
{
  "name": "string",
  "username": "string",
  "email": "string",
  "phone": "string",
  "country_code": "string",
  "birth_date": "string (ISO yyyy-mm-dd)",
  "password": "string",
  "confirm_password": "string",
  "terms_accepted": "boolean (opcional; ver abajo)"
}
```

**Response — éxito (201)**
```json
{
  "user": {
    "id": "string (UUID)",
    "username": "string",
    "email": "string",
    "name": "string",
    "phone": "string | null",
    "country_code": "string | null",
    "birth_date": "string (ISO yyyy-mm-dd) | null",
    "followers_count": "integer",
    "following_count": "integer",
    "email_verified": "boolean",
    "profile_completed": "boolean",
    "has_password": "boolean"
  }
}
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; alguno de `name`/`username`/`email`/`phone`/`country_code`/`birth_date`/`password`/`confirm_password` ausente; `email` con formato inválido; `password` ≠ `confirm_password`; `password` con menos de 8 caracteres; `username`/`phone`/`country_code`/`birth_date` con formato inválido; edad menor a **18 años** (`ADR-034-minimum-age-18.md`; el body trae `min_age: 18`) | `{"msg": "..."}` |
| `400` | **`terms_accepted` ausente o distinto de `true`, con `TERMS_ACCEPTANCE_REQUIRED` activado** (`ADR-032` §5). Solo cuenta el booleano `true`: la cadena `"true"` o el número `1` **no** son una aceptación. Solo con la exigencia activada | `{"msg": "...", "terms_required": true}` |
| `409` | Ya existe una cuenta **verificada** con ese email (comparación case-insensitive, `CITEXT`) **o** con ese username | `{"msg": "..."}` |

**Notas de implementación:**
- `password_hash` se genera con `werkzeug.security.generate_password_hash` (scrypt) — nunca se persiste ni se devuelve la contraseña en claro.
- `id` lo genera PostgreSQL (`gen_random_uuid()`), nunca Python (`DATABASE_ARCHITECTURE.md` §5).
- `confirm_password` se valida (debe coincidir con `password`) y **nunca se persiste** — no existe como columna de `users`.
- Formato validado en el backend (`domain/auth/validators.py`, ver `ADR-002` §3): `username` (`^[a-zA-Z0-9_]{3,20}$`), `phone` (7–15 dígitos), `country_code` (`^\+[1-9]\d{0,3}$`), `birth_date` (ISO válida + edad mínima **18 años**, calculada por fecha completa; es la fecha declarada, no una verificación documental, `ADR-034`).
- **v0.7 — resuelto:** `email` (regex básica `^[^\s@]+@[^\s@]+\.[^\s@]+$`, sin verificar dominio real) y `password` (mínimo `MIN_PASSWORD_LENGTH = 8` caracteres, sin exigir mayúscula/número/símbolo) — ambos placeholders de producto explícitos, revisables (mismo criterio que `MIN_AGE_YEARS`).
- **v0.16 — verificación obligatoria de email (`ADR-011-mandatory-email-verification.md`):** `email_verified` nace en `false`; el registro envía de inmediato un código de 6 dígitos por correo (mismo mecanismo que `verify-reset-code`, §4.8) y la cuenta no puede usar `POST /api/login` hasta verificarlo. Registrar de nuevo con un email que existe pero **nunca** se verificó actualiza esa misma fila (incluida la contraseña) y reenvía un código — no produce un `409` ni una fila duplicada; el `409` de email solo ocurre contra una cuenta ya verificada. La prueba definitiva de que la cuenta controla el correo es siempre el código OTP — el formato de `email` se valida, pero un dominio/formato con buena forma nunca se trata como verificación por sí solo.
- **v0.17 (`ADR-012-google-sign-in.md`):** este contrato de `POST /api/register` **no cambia** — sigue exigiendo `phone`/`country_code`/`birth_date`/`password`/`confirm_password` igual que siempre. La relajación a nullable de esas columnas en `users` (§5, `DATABASE_ARCHITECTURE.md`) es exclusiva de cuentas creadas vía `POST /api/auth/google` (§4.9) — el registro tradicional nunca las deja en `NULL` en la práctica.

#### `POST /api/login`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — gana un caso de rechazo nuevo en `ADR-011-mandatory-email-verification.md`: cuenta sin verificar (§Cambios respecto a la versión anterior de este documento) |
| Blueprint | `auth_bp` (`backend/app/interfaces/routes/auth_routes.py`) |
| Auth requerida | No (endpoint público — emite el token) |

**Request body**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response — éxito (200)**
```json
{
  "token": "string (JWT de acceso, 15 min)",
  "refresh_token": "string (JWT de refresh, 30 días, un solo uso -- ver §4.11)",
  "user": {
    "id": "string (UUID)",
    "username": "string",
    "email": "string",
    "name": "string",
    "phone": "string | null",
    "country_code": "string | null",
    "birth_date": "string (ISO yyyy-mm-dd) | null",
    "followers_count": "integer",
    "following_count": "integer",
    "email_verified": "boolean",
    "profile_completed": "boolean",
    "has_password": "boolean"
  }
}
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío, o `email`/`password` ausentes | `{"msg": "..."}` |
| `401` | Credenciales inválidas — email inexistente **o** contraseña incorrecta, mismo mensaje en ambos casos deliberadamente, para no permitir enumerar emails registrados | `{"msg": "..."}` |
| `403` | Email y contraseña correctos, pero la cuenta todavía no completó la verificación obligatoria de email (`ADR-011-mandatory-email-verification.md`) — se distingue deliberadamente de `401` porque la contraseña sí era correcta; el chequeo ocurre **después** de validar la contraseña, nunca antes, para no abrir un canal lateral nuevo. Nunca se emite un JWT en este caso | `{"msg": "Tu correo electrónico todavía no fue verificado.", "email_verified": false}` |

**Cambios respecto a la versión anterior de este documento:**
- La validación ya **no** compara contra una credencial hardcodeada — consulta la tabla `users` real vía `SQLAlchemyUserRepository` (`backend/app/infrastructure/persistence/repositories/user_repository.py`).
- El objeto `user` devuelto ahora incluye también `username`, `phone`, `country_code`, `birth_date` (`ADR-002`).
- **`identity` del JWT cambió de `email` a `user.id` (UUID, como string)** — cualquier endpoint protegido usa `get_jwt_identity()` y recibe un UUID de `users.id`, no un email. Ver `BACKEND_ARCHITECTURE.md` §9.
- ~~El token sigue sin política de expiración explícita~~ — **cerrado en v0.21** (`ADR-017`): access 15 min y refresh 30 días, explícitos en `config.py`.
- **v0.21:** la respuesta gana `refresh_token` (aditivo; `token` y `user` no cambian) — ver §4.11.
- **v0.16:** nuevo caso `403` para cuenta sin verificar (`ADR-011-mandatory-email-verification.md` §Decisión) — `email_verified: false` explícito en el body (no solo en el mensaje) para que el Frontend lo distinga sin parsear texto y redirija a `POST /api/verify-registration-code` (§4.8).

### 4.2 Endpoints protegidos

#### `GET /api/users/me`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (THERS Backend Fase 2.1, `ADR-002` §3) |
| Blueprint | `users_bp` (`backend/app/interfaces/routes/user_routes.py`) |
| Auth requerida | **Sí** — `Bearer <jwt>` en el header `Authorization`. Identidad obtenida exclusivamente de `get_jwt_identity()` (`@jwt_required()`) — nunca de query string, body ni headers personalizados |

**Request:** sin body. Header `Authorization: Bearer <token>` obligatorio.

**Response — éxito (200)**
```json
{
  "user": {
    "id": "string (UUID)",
    "username": "string",
    "email": "string",
    "name": "string",
    "phone": "string | null",
    "country_code": "string | null",
    "birth_date": "string (ISO yyyy-mm-dd) | null",
    "followers_count": "integer",
    "following_count": "integer",
    "email_verified": "boolean",
    "profile_completed": "boolean",
    "has_password": "boolean"
  }
}
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | El `id` del JWT no corresponde a ningún usuario real (p. ej. la cuenta fue eliminada después de emitirse el token) | `{"msg": "..."}` |

**Notas de implementación:**
- Primer endpoint protegido real del backend — fija el patrón que `BACKEND_ARCHITECTURE.md` §9/§14 señalaba como ausente.
- `flask_jwt_extended` distingue por defecto entre `401` (token ausente/expirado) y `422` (token malformado); se homogenizaron los tres casos a `401` con callbacks en `app/extensions.py` (`unauthorized_loader`/`invalid_token_loader`/`expired_token_loader`), para que cualquier endpoint protegido futuro herede el mismo comportamiento sin repetirlo.
- Nunca expone `password`, `password_hash`, `confirm_password`, `token` ni `secret` en la respuesta.
- `followers_count`/`following_count` agregados en v0.12 (`ADR-007-follows-minimal-model.md`, §4.6) — siempre reales para el usuario autenticado. En `POST /api/register`/`POST /api/login` estos mismos campos también viajan, siempre en `0`: una cuenta recién creada no puede tener seguidores/seguidos todavía.
- `email_verified` agregado en v0.14 (`ADR-009-password-reset-and-email-verification.md`, §4.8) — `false` en toda cuenta hasta que se complete `POST /api/verify-email`. A diferencia de `followers_count`/`following_count`, se lee directo de la columna (`users.email_verified`), sin consulta agregada aparte.

#### `PATCH /api/users/me`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (THERS Backend, `ADR-003-profile-update-contract.md`) |
| Blueprint | `users_bp` (`backend/app/interfaces/routes/user_routes.py`), mismo blueprint que `GET /api/users/me` |
| Auth requerida | **Sí** — `Bearer <jwt>` en el header `Authorization`. Identidad obtenida exclusivamente de `get_jwt_identity()` (`@jwt_required()`) — nunca de query string, body ni headers personalizados. El `user_id` del JWT es siempre el sujeto de la operación, no hay forma de editar el perfil de otro usuario |

**Semántica.** Actualización parcial real (PATCH, no un PUT disfrazado): solo los campos presentes en el body se modifican, los omitidos no se tocan. Un único `db.session.commit()` por request — si varios campos vienen en el mismo `PATCH`, se persisten todos o ninguno. Campos no reconocidos en el body se ignoran silenciosamente — nunca se leen ni se pasan al modelo (whitelist explícita en la route, sin `**data`, sin mass assignment).

**Request body** — todos los campos son opcionales, pero debe llegar al menos uno de la whitelist:
```json
{
  "name": "string (opcional)",
  "username": "string (opcional, máx. 1 cambio cada 30 días)",
  "phone": "string (opcional, requiere country_code en el mismo body)",
  "country_code": "string (opcional, requiere phone en el mismo body)",
  "birth_date": "string ISO yyyy-mm-dd (opcional)"
}
```

Ejemplo mínimo válido — cambiar solo el nombre:
```json
{ "name": "Fernando" }
```

**Campos NO editables por este endpoint** (ADR-003 §Campos editables): `id`, `email`, `password`/`password_hash`, `created_at`, `updated_at` — nunca se leen del body, bajo ninguna circunstancia. `bio`/`avatar_url` no existen todavía como columnas (`DATABASE_ARCHITECTURE.md` §4.B) — no forman parte de este contrato.

**Response — éxito (200)** — mismo objeto público que `GET /api/users/me`, `register` y `login`:
```json
{
  "user": {
    "id": "string (UUID)",
    "username": "string",
    "email": "string",
    "name": "string",
    "phone": "string | null",
    "country_code": "string | null",
    "birth_date": "string (ISO yyyy-mm-dd) | null",
    "followers_count": "integer",
    "following_count": "integer",
    "email_verified": "boolean",
    "profile_completed": "boolean",
    "has_password": "boolean"
  }
}
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío o sin ningún campo whitelisted; valor vacío/`null`/formato inválido en `name`/`username`/`phone`/`country_code`/`birth_date`; `phone` sin `country_code` o viceversa; edad resultante < 13 años; `username` cambiado antes de que se cumplan 30 días desde el último cambio (`ADR-003` dejaba el código exacto "a definir en la implementación" entre `400`/`429` — se usa `400` para mantenerse dentro del catálogo de códigos ya documentado en este contrato, sin introducir `429`) | `{"msg": "..."}` |
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró — mismos callbacks homogenizados que `GET /api/users/me` | `{"msg": "..."}` |
| `404` | El `id` del JWT no corresponde a ningún usuario real | `{"msg": "..."}` |
| `409` | Conflicto de unicidad de `username` (constraint `uq_users_username`) — mismo patrón de `IntegrityError` → excepción de dominio que `POST /api/register` ya usa | `{"msg": "..."}` |

**Notas de implementación:**
- Un `username` igual al actual **no** se trata como un cambio real: no actualiza `username_changed_at` ni consume la ventana de 30 días (`ADR-003` §5).
- `phone`/`country_code` se tratan como un único dato lógico — deben enviarse juntos en el mismo body si se quiere modificar cualquiera de los dos.
- Reutiliza los mismos validadores de formato que `POST /api/register` (`domain/auth/validators.py`) — sin reglas nuevas de formato, solo se aplican también aquí.
- Nunca expone `password`, `password_hash`, `confirm_password`, `token` ni `secret` en la respuesta (reutiliza `to_public_user()`, la misma función que `register`/`login`/`me`).
- `username_changed_at` no forma parte de la respuesta pública — es un dato interno que solo sostiene la regla de cooldown (`DATABASE_ARCHITECTURE.md` §5).

---

### 4.3 Contenido

#### `POST /api/posts`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-004-posts-minimal-model.md`) |
| Blueprint | `posts_bp` (`backend/app/interfaces/routes/post_routes.py`) |
| Auth requerida | **Sí** — `Bearer <jwt>` en el header `Authorization`. `author_id` se obtiene exclusivamente de `get_jwt_identity()` — nunca del body |

**Semántica.** Crea un post de **solo texto** — primer endpoint de una entidad social real del producto, deliberadamente mínimo (`ADR-004` §No objetivos): sin mood, imagen, hashtags, ubicación, reacciones ni comentarios en esta versión.

**Request body**
```json
{ "content": "string (1–2000 caracteres tras trim)" }
```

**Response — éxito (201)**
```json
{
  "post": {
    "id": "string (UUID)",
    "author": {
      "id": "string (UUID)",
      "username": "string",
      "name": "string",
      "is_followed_by_me": "boolean"
    },
    "content": "string",
    "created_at": "string (ISO 8601)",
    "edited": "boolean",
    "likes_count": "integer",
    "liked_by_me": "boolean",
    "comments_count": "integer"
  }
}
```
`edited` agregado en v0.22 (`ADR-021-content-editing.md`) — siempre `false` en una publicación recién creada. `likes_count`/`liked_by_me` agregados en v0.10 (`ADR-005-likes-minimal-model.md`, §4.4); `comments_count` agregado en v0.11 (`ADR-006-comments-minimal-model.md`, §4.5) — un post recién creado siempre los devuelve en `0`/`false`, nadie pudo haberle dado like ni comentado todavía. `author.is_followed_by_me` agregado en v0.12 (`ADR-007-follows-minimal-model.md`, §4.6) — en `false` para un post recién creado, porque el autor es siempre uno mismo y nadie se sigue a sí mismo (`ck_follows_no_self_follow`).

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `content` ausente, vacío tras `trim()`, o mayor a 2000 caracteres | `{"msg": "..."}` |
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró — mismos callbacks homogenizados que el resto de endpoints protegidos | `{"msg": "..."}` |

**Notas de implementación:**
- Whitelist explícita: solo `content` se lee del body — nunca `author_id`/`id`/`created_at` (mismo principio anti mass-assignment que `PATCH /api/users/me`, `ADR-003` §Seguridad; verificado por prueba).
- El objeto `author` reutiliza una forma reducida del mismo `to_public_user`-style presenter — nunca expone `email`, `phone`, `password_hash` ni otros campos privados del autor.

#### `GET /api/posts`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-004-posts-minimal-model.md`) |
| Blueprint | `posts_bp`, mismo blueprint que `POST /api/posts` |
| Auth requerida | **Sí** — mismo criterio que el resto del feed hoy: solo alcanzable desde rutas protegidas del Frontend (`ProtectedRoute`, `FRONTEND_ARCHITECTURE.md` §7) |

**Semántica.** Feed **global**: devuelve los posts de **todos** los autores, no solo de quienes el usuario sigue. `follows` ya existe (`ADR-007-follows-minimal-model.md`), pero este endpoint **sigue sin filtrar por seguidos** — personalizar el feed es una decisión de producto separada, deliberadamente fuera de alcance de `ADR-007` (§No objetivos). Sin paginación real: límite fijo de **50** posts más recientes.

**v0.23 — el feed ya no es el mismo para todo el mundo** (`ADR-022-private-accounts.md`, `ADR-024-content-filters-and-privacy-preferences.md`). Se excluyen, **en SQL** (no descartando después del `LIMIT`, que devolvería páginas cortas):
- los posts de cuentas con `is_private = true` que quien pregunta no sigue con un follow **aceptado** — una solicitud pendiente no alcanza;
- los posts cuyo texto contiene alguno de los términos de `GET /api/users/me/muted-keywords` de quien pregunta.

En los dos casos, **el propio post nunca se le oculta a su autor**. La forma de la respuesta no cambia.

**Request:** sin body. Header `Authorization: Bearer <token>` obligatorio.

**Response — éxito (200)**
```json
{ "posts": [ { "id", "author": { "id", "username", "name", "is_followed_by_me" }, "content", "created_at", "edited", "likes_count", "liked_by_me", "comments_count" }, ... ] }
```
Orden: `created_at` descendente (más reciente primero). Lista vacía (`[]`) si no hay posts. `likes_count`/`liked_by_me` (v0.10), `comments_count` (v0.11), `author.is_followed_by_me` (v0.12) y `edited` (v0.22) son extensiones aditivas — no rompen el contrato existente. **Editar una publicación no la mueve de lugar**: el orden depende de `created_at`, que la edición no toca (`ADR-021` §Opciones consideradas).

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |

#### `PATCH /api/posts/<post_id>`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-021-content-editing.md`) |
| Blueprint | `posts_bp`, mismo blueprint que `POST`/`GET`/`DELETE /api/posts` |
| Auth requerida | **Sí**. Solo se puede editar una publicación propia (`author_id == get_jwt_identity()`) |

**Semántica.** Reemplaza el texto de la publicación `post_id`. No hay historial de versiones: la fila se sobrescribe y lo único que queda registrado es **que** hubo una edición (`edited`), nunca cuándo ni qué decía antes (`ADR-021` §No objetivos).

Editar preserva todo lo que la publicación acumuló — el `id` de la fila no cambia, así que sus likes y comentarios siguen colgando de ella, y `created_at` tampoco, así que **no sube** en el feed.

**Request body**
```json
{ "content": "string (1–2000 caracteres tras trim)" }
```
`content` es **obligatorio** — a diferencia de `PATCH /api/users/me` (§4.2), donde el `PATCH` elige entre varios campos opcionales, acá es el único campo editable y un `PATCH` sin él no tiene nada que hacer. Mismo validador y mismo límite que `POST /api/posts`: editar no puede saltarse el límite que crear respeta.

**Response — éxito (200)**
```json
{ "post": { /* misma forma que el objeto de POST /api/posts, con "edited": true */ } }
```
Devuelve la publicación **completa**, con los contadores **reales** de likes y comentarios (no `0`, como en un post recién creado): permite al Frontend reemplazar el objeto en memoria por la respuesta del servidor, sin adivinar el resultado ni volver a pedir el recurso.

**Idempotente en su efecto observable:** repetir el mismo `PATCH` deja el mismo texto y `edited` sigue en `true`. A diferencia de `DELETE`, un segundo `PATCH` sobre una publicación que sigue existiendo es `200`, no `404`.

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `content` ausente, vacío tras `trim()`, o mayor a 2000 caracteres | `{"msg": "..."}` |
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `post_id` no existe, **o** existe pero no le pertenece a quien hace la petición — mismo mensaje/código en ambos casos; incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

**Notas de implementación:**
- Whitelist explícita de **un solo campo**: solo `content` se lee del body. `id`, `author_id`, `created_at` y `edited_at` se ignoran si vienen — mismo principio anti *mass-assignment* que `POST /api/posts` y `PATCH /api/users/me` (verificado por prueba).
- La pertenencia se verifica en el propio `WHERE` del `UPDATE`, no leyendo la fila y comparando después — sin ventana entre comprobar y actuar (`ADR-021` §Seguridad).

#### `DELETE /api/posts/<post_id>`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-019-post-deletion.md`) |
| Blueprint | `posts_bp`, mismo blueprint que `POST`/`GET /api/posts` |
| Auth requerida | **Sí**. Solo se puede borrar una publicación propia (`author_id == get_jwt_identity()`) |

**Semántica.** Borra la publicación `post_id` — *hard delete*, sin placeholder ("publicación eliminada" no existe en esta versión). Deja de existir para todos. Sus likes, comentarios y notificaciones asociadas se borran con ella, por los `ON DELETE CASCADE` ya declarados sobre `posts.id` (`ADR-005`/`ADR-006`/`ADR-008`).

**No es idempotente**, a diferencia de `DELETE /api/posts/<post_id>/like` y `DELETE /api/users/<user_id>/follow`: repetir la llamada sobre una publicación ya borrada devuelve `404` (`ADR-019` §Decisión).

**Request:** sin body. `post_id` va en la URL, como UUID (conversor `uuid` de Flask/Werkzeug).

**Response — éxito (200)**
```json
{ "deleted": true }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `post_id` no existe, **o** existe pero no le pertenece a quien hace la petición — mismo mensaje/código en ambos casos, no se distingue cuál ocurrió; incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

---

### 4.4 Likes

#### `POST /api/posts/<post_id>/like`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-005-likes-minimal-model.md`) |
| Blueprint | `likes_bp` (`backend/app/interfaces/routes/like_routes.py`) |
| Auth requerida | **Sí** — `Bearer <jwt>` en el header `Authorization`. Quién da el like se obtiene exclusivamente de `get_jwt_identity()` — nunca del body |

**Semántica.** Da like al post `post_id` en nombre del usuario autenticado. **Idempotente**: repetir la llamada no falla ni duplica el like (`ADR-005` §Decisión, Opción A) — pensado para que el Frontend no tenga que distinguir "primer like" de "doble tap accidental".

**Request:** sin body. `post_id` va en la URL, como UUID (conversor `uuid` de Flask/Werkzeug).

**Response — éxito (200)**
```json
{ "likes_count": "integer", "liked_by_me": true }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `post_id` no corresponde a ningún post real — incluye cualquier segmento de URL que no sea un UUID válido (el conversor de ruta ya descarta esos casos antes de llegar al handler) | `{"msg": "..."}` |

#### `DELETE /api/posts/<post_id>/like`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-005-likes-minimal-model.md`) |
| Blueprint | `likes_bp`, mismo blueprint que `POST .../like` |
| Auth requerida | **Sí** — mismo criterio que `POST .../like` |

**Semántica.** Quita el like del usuario autenticado sobre el post `post_id`. **Idempotente**: si el usuario no lo había likeado, no falla — devuelve el mismo estado que si acabara de quitarlo.

**Request:** sin body. Mismo formato de `post_id` que `POST .../like`.

**Response — éxito (200)**
```json
{ "likes_count": "integer", "liked_by_me": false }
```

**Response — error:** mismos `401`/`404` que `POST .../like`.

**Notas de implementación (ambos endpoints):**
- No aceptan ningún campo de body — toda la información viene de la URL (`post_id`) y del JWT (`ADR-005` §Seguridad).
- No exponen qué usuarios dieron like a un post — solo el conteo agregado y si el usuario que pregunta ya likeó (`ADR-005` §No objetivos).

---

### 4.5 Comentarios

#### `POST /api/posts/<post_id>/comments`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-006-comments-minimal-model.md`) |
| Blueprint | `comments_bp` (`backend/app/interfaces/routes/comment_routes.py`) |
| Auth requerida | **Sí** — `Bearer <jwt>` en el header `Authorization`. `author_id` se obtiene exclusivamente de `get_jwt_identity()` — nunca del body |

**Semántica.** Comenta el post `post_id` en nombre del usuario autenticado, en texto plano — sin hilos de respuestas (`ADR-006` §No objetivos). Cualquier usuario autenticado puede comentar cualquier post, no solo el autor.

**Request body**
```json
{ "content": "string (1–1000 caracteres tras trim)" }
```
`post_id` va en la URL, como UUID (conversor `uuid` de Flask/Werkzeug).

**Response — éxito (201)**
```json
{
  "comment": {
    "id": "string (UUID)",
    "post_id": "string (UUID)",
    "author": { "id": "string (UUID)", "username": "string", "name": "string" },
    "content": "string",
    "created_at": "string (ISO 8601)",
    "edited": "boolean"
  }
}
```
`edited` agregado en v0.22 (`ADR-021-content-editing.md`) — siempre `false` en un comentario recién creado.

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `content` ausente, vacío tras `trim()`, o mayor a 1000 caracteres | `{"msg": "..."}` |
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `post_id` no corresponde a ningún post real — incluye cualquier segmento de URL que no sea un UUID válido (el conversor de ruta ya descarta esos casos antes de llegar al handler) | `{"msg": "..."}` |

#### `GET /api/posts/<post_id>/comments`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-006-comments-minimal-model.md`) |
| Blueprint | `comments_bp`, mismo blueprint que `POST .../comments` |
| Auth requerida | **Sí** — mismo criterio que el resto del feed hoy |

**Semántica.** Lista los comentarios del post `post_id`, en orden **cronológico ascendente** (más antiguo primero — `ADR-006` §Opciones consideradas, a diferencia de `GET /api/posts` que va al revés). Sin paginación real: límite fijo de **100** comentarios.

**Request:** sin body. Mismo formato de `post_id` que `POST .../comments`.

**Response — éxito (200)**
```json
{ "comments": [ { "id", "post_id", "author": {...}, "content", "created_at", "edited" }, ... ] }
```
Lista vacía (`[]`) si el post no tiene comentarios. `edited` (v0.22) es una extensión aditiva.

**Response — error:** mismos `401`/`404` que `POST .../comments`.

**Notas de implementación (ambos endpoints):**
- Whitelist explícita: solo `content` se lee del body en `POST` — nunca `post_id`/`author_id`/`id` (`post_id` viene de la URL).
- El objeto `author` reutiliza la misma forma reducida que `posts.author` — nunca expone `email`, `phone`, `password_hash` ni otros campos privados.

#### `PATCH /api/comments/<comment_id>`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-021-content-editing.md`) |
| Blueprint | `comments_bp`, mismo blueprint que `POST`/`GET /api/posts/<post_id>/comments` y `DELETE /api/comments/<comment_id>` |
| Auth requerida | **Sí**. Solo se puede editar un comentario propio (`author_id == get_jwt_identity()`) |

**Semántica.** Reemplaza el texto del comentario `comment_id`. Sin historial de versiones. El autor de la publicación **no** puede editar comentarios ajenos en ella — mismo criterio que el borrado (`ADR-020`). `comments_count` de la publicación **no** cambia: editar no suma ni resta. No se genera ninguna notificación nueva — la de "comentó tu publicación" (`ADR-008`) se emitió al crear el comentario, y editarlo no es un evento social nuevo.

**Request body**
```json
{ "content": "string (1–1000 caracteres tras trim)" }
```
Obligatorio, con el mismo validador y el mismo límite (1000, menor que el de posts) que `POST .../comments`.

**Response — éxito (200)**
```json
{ "comment": { /* misma forma que el objeto de POST .../comments, con "edited": true */ } }
```

**Request:** ruta plana (no anida bajo `/posts/<id>`): editar depende de quién escribió el comentario, no de en qué publicación está. Un `post_id` en el body se ignora — editar un comentario no puede moverlo a otra publicación (verificado por prueba).

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `content` ausente, vacío tras `trim()`, o mayor a 1000 caracteres | `{"msg": "..."}` |
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `comment_id` no existe, **o** existe pero no le pertenece a quien hace la petición — mismo mensaje/código en ambos casos; incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

#### `DELETE /api/comments/<comment_id>`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-020-comment-deletion.md`) |
| Blueprint | `comments_bp`, mismo blueprint que `POST`/`GET /api/posts/<post_id>/comments` |
| Auth requerida | **Sí**. Solo se puede borrar un comentario propio (`author_id == get_jwt_identity()`) |

**Semántica.** Borra el comentario `comment_id` — *hard delete*, sin placeholder. Deja de existir para todos y `comments_count` de su publicación baja en uno. **No es idempotente**: repetir la llamada devuelve `404`. El autor de la publicación **no** puede borrar comentarios ajenos con este endpoint.

**Request:** sin body. `comment_id` va en la URL, como UUID. Ruta plana (no anida bajo `/posts/<id>`): borrar depende de quién escribió el comentario, no de en qué publicación está.

**Response — éxito (200)**
```json
{ "deleted": true }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `comment_id` no existe, **o** existe pero no le pertenece a quien hace la petición — mismo mensaje/código en ambos casos; incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

---

### 4.6 Follows

> **v0.23 (`ADR-022-private-accounts.md`).** Un follow deja de ser binario: ahora tiene estado (`follows.status`). Seguir a una cuenta privada crea una **solicitud** (`'pending'`), que su dueño aprueba o rechaza desde §4.11. Los dos endpoints de abajo ganan el campo **aditivo** `follow_status` (`null` | `'pending'` | `'accepted'`); `following` **no cambia de significado** — sigue siendo "relación efectiva", así que una solicitud pendiente es `false` ahí. Un `POST` repetido **no le pisa el estado** a una relación existente: repetir la llamada sobre un follow ya aceptado no lo degrada a pendiente porque la cuenta se haya vuelto privada después. El `DELETE` borra la fila **sea cual sea su estado**, así que el mismo endpoint sirve para dejar de seguir y para cancelar una solicitud sin responder. `followers_count`/`following_count` cuentan **solo** los aceptados: un pendiente no es un seguidor.

#### `POST /api/users/<user_id>/follow`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-007-follows-minimal-model.md`) |
| Blueprint | `follows_bp` (`backend/app/interfaces/routes/follow_routes.py`) |
| Auth requerida | **Sí** — `Bearer <jwt>` en el header `Authorization`. Quién sigue se obtiene exclusivamente de `get_jwt_identity()` — nunca del body |

**Semántica.** Sigue a `user_id` en nombre del usuario autenticado. **Idempotente**: repetir la llamada no falla ni duplica (mismo criterio que `ADR-005` §Decisión, Opción A). Un usuario no puede seguirse a sí mismo — impuesto tanto en la aplicación como en el esquema (`CHECK ck_follows_no_self_follow`).

**Request:** sin body. `user_id` va en la URL, como UUID (conversor `uuid` de Flask/Werkzeug).

**Response — éxito (200)**
```json
{ "following": true }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | `user_id` es el propio usuario autenticado | `{"msg": "..."}` |
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `user_id` no corresponde a ningún usuario real — incluye cualquier segmento de URL que no sea un UUID válido (el conversor de ruta ya descarta esos casos antes de llegar al handler) | `{"msg": "..."}` |

#### `DELETE /api/users/<user_id>/follow`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-007-follows-minimal-model.md`) |
| Blueprint | `follows_bp`, mismo blueprint que `POST .../follow` |
| Auth requerida | **Sí** — mismo criterio que `POST .../follow` |

**Semántica.** Deja de seguir a `user_id`. **Idempotente**: si no lo seguía, no falla. Dejar de seguirse a uno mismo es un no-op inofensivo — la restricción de auto-seguimiento solo aplica para *empezar* a seguir, así que este endpoint no devuelve `400` en ese caso.

**Request:** sin body. Mismo formato de `user_id` que `POST .../follow`.

**Response — éxito (200)**
```json
{ "following": false }
```

**Response — error:** mismos `401`/`404` que `POST .../follow` (sin el `400` de auto-seguimiento).

**Notas de implementación (ambos endpoints):**
- No aceptan ningún campo de body — toda la información viene de la URL (`user_id`) y del JWT (mismo principio que `ADR-005`/`ADR-006`).
- No exponen la lista de seguidores/seguidos de nadie — solo el conteo agregado (`GET`/`PATCH /api/users/me`, §4.2) y si el usuario que pregunta ya sigue a un autor (`author.is_followed_by_me`, §4.3) — `ADR-007` §No objetivos.
- No personalizan `GET /api/posts` — el feed sigue global (§4.3).

---

### 4.7 Notificaciones

#### `GET /api/notifications`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-008-notifications-minimal-model.md`) |
| Blueprint | `notifications_bp` (`backend/app/interfaces/routes/notification_routes.py`) |
| Auth requerida | **Sí** — `Bearer <jwt>` en el header `Authorization`. Solo lista las notificaciones del propio usuario autenticado — no hay `user_id` en la URL de este endpoint, a diferencia de `follows` |

**Semántica.** Lista las notificaciones del usuario autenticado, más recientes primero. Cubre solo tres tipos de evento, los únicos que el backend genera hoy: `like` (alguien le dio like a un post tuyo), `comment` (alguien comentó un post tuyo), `follow` (alguien empezó a seguirte) — nunca sobre tu propio contenido, nunca duplicada por una repetición idempotente de un like/follow ya existente (`ADR-008` §Opciones consideradas). Sin paginación real: límite fijo de **50**.

**Request:** sin body. Header `Authorization: Bearer <token>` obligatorio.

**Response — éxito (200)**
```json
{
  "notifications": [
    {
      "id": "string (UUID)",
      "type": "like | comment | follow",
      "actor": { "id": "string (UUID)", "username": "string", "name": "string" },
      "post_id": "string (UUID) | null",
      "read": "boolean",
      "created_at": "string (ISO 8601)"
    }
  ]
}
```
`post_id` es `null` para `type: "follow"` — ese evento no tiene ningún post de origen. Lista vacía (`[]`) si no hay notificaciones.

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |

#### `PATCH /api/notifications/<notification_id>/read`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-008-notifications-minimal-model.md`) |
| Blueprint | `notifications_bp`, mismo blueprint que `GET /api/notifications` |
| Auth requerida | **Sí** — mismo criterio que `GET /api/notifications`. Solo se puede marcar como leída una notificación propia |

**Semántica.** Marca como leída la notificación `notification_id`. **Idempotente**: si ya estaba leída, no falla — devuelve el mismo estado (mismo criterio que `ADR-005`/`ADR-007`).

**Request:** sin body. `notification_id` va en la URL, como UUID (conversor `uuid` de Flask/Werkzeug).

**Response — éxito (200)**
```json
{ "read": true }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `notification_id` no existe, **o** existe pero pertenece a otro usuario — mismo mensaje/código en ambos casos, no se distingue cuál ocurrió (mismo criterio que `POST /api/login` no distingue email inexistente de password incorrecta); incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

**Notas de implementación (ambos endpoints):**
- Sin endpoint de "marcar todas como leídas" en el backend — cada notificación se marca individualmente (`ADR-008` §No objetivos); el Frontend puede ofrecer esa acción iterando sobre las no leídas.
- Sin endpoint de contador de no leídas — el Frontend ya puede derivarlo contando `read: false` sobre la lista que `GET /api/notifications` devuelve.
- `POST /api/posts/<id>/like`, `POST /api/posts/<id>/comments` y `POST /api/users/<id>/follow` **no cambian su contrato** — generar la notificación correspondiente es un efecto secundario invisible en la respuesta de quien dispara la acción, visible solo para quien la recibe.

---

### 4.8 Recuperación de contraseña y verificación de email

#### `POST /api/forgot-password`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — reescrito en `ADR-010-password-reset-otp-flow.md` (reemplaza el flujo de enlace de `ADR-009-password-reset-and-email-verification.md`) |
| Blueprint | `auth_bp` (`backend/app/interfaces/routes/auth_routes.py`) |
| Auth requerida | No (endpoint público — quien lo llama todavía no tiene sesión) |

**Semántica.** Si `email` corresponde a una cuenta real, genera un código numérico de 6 dígitos (10 minutos de vigencia, un solo uso) y envía un correo mostrándolo. Si no corresponde a ninguna cuenta, no hace nada — en **ambos** casos la respuesta es idéntica (evita enumeración de usuarios). Sujeto a un cooldown de 60 segundos por usuario: un pedido repetido dentro de esa ventana no genera un código ni un correo nuevo, sin cambiar la respuesta. **También es el endpoint de "Reenviar código"** — el Frontend lo llama de nuevo con el mismo email; el código anterior queda invalidado, incluso ante dos reenvíos simultáneos (`ADR-010` §Opciones consideradas, índice único parcial).

**Request body**
```json
{ "email": "string" }
```

**Response — éxito (200), siempre el mismo mensaje**
```json
{ "msg": "Si existe una cuenta asociada a ese correo, enviaremos un código de recuperación." }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío, `email` ausente, o con formato inválido (`domain/auth/validators.is_valid_email`) | `{"msg": "..."}` |

#### `POST /api/verify-reset-code`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-010-password-reset-otp-flow.md`) |
| Blueprint | `auth_bp`, mismo blueprint que `POST /api/forgot-password` |
| Auth requerida | No — la identidad la aporta `email` + el código correcto |

**Semántica.** Verifica el código de 6 dígitos emitido por `POST /api/forgot-password`. Si es correcto, marca la solicitud como verificada y devuelve una **autorización temporal** (10 minutos de vigencia, un solo uso, de propósito específico — nunca un JWT de sesión normal) que `POST /api/reset-password` exige a continuación. Máximo **5 intentos** por solicitud (`domain/auth/token_policy.PASSWORD_RESET_MAX_ATTEMPTS`) — agotarlos bloquea la solicitud sin borrarla, obligando a pedir un código nuevo. Todos los casos de rechazo (email inexistente, sin solicitud activa, código expirado, intentos agotados, código incorrecto) devuelven el **mismo** mensaje y código — no se distinguen, para no habilitar enumeración de usuarios ni un canal lateral que revelara "intentos agotados" solo para cuentas reales.

**Request body**
```json
{ "email": "string", "code": "string (6 dígitos)" }
```

**Response — éxito (200)**
```json
{ "msg": "Código verificado correctamente.", "reset_authorization": "string" }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `email`/`code` ausentes; email sin cuenta asociada; sin solicitud activa; código expirado; intentos agotados; código incorrecto — los seis casos comparten el mismo mensaje | `{"msg": "El código es incorrecto. Inténtalo nuevamente."}` |

#### `POST /api/reset-password`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — reescrito en `ADR-010-password-reset-otp-flow.md` (reemplaza el consumo directo del token de enlace de `ADR-009`) |
| Blueprint | `auth_bp`, mismo blueprint que `POST /api/forgot-password` |
| Auth requerida | No — la identidad la aporta la autorización temporal, no un JWT |

**Semántica.** Aplica una nueva contraseña usando la autorización temporal emitida por `POST /api/verify-reset-code`. La autorización debe existir, provenir de una solicitud verificada, no haber expirado, y no haber sido usada antes. Al aplicarse con éxito, marca la solicitud como usada y envía un correo de confirmación ("contraseña actualizada") — no hace falta invalidar "otras solicitudes pendientes" por separado: solo puede existir una activa por usuario en todo momento (`ADR-010` §Decisión).

**Request body**
```json
{
  "reset_authorization": "string",
  "password": "string",
  "confirm_password": "string"
}
```

**Response — éxito (200)**
```json
{ "msg": "Tu contraseña fue actualizada correctamente." }
```

**Efecto adicional (v0.21, `ADR-017` §7):** además de cambiar la contraseña, **revoca todas las sesiones** (refresh tokens) del usuario — quien tuviera la contraseña vieja pierde el acceso en cuanto su access token actual expire (≤ 15 min).

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `reset_authorization`/`password`/`confirm_password` ausentes; `password` ≠ `confirm_password`; `password` no cumple el formato mínimo (mismo `MIN_PASSWORD_LENGTH` que `POST /api/register`); la autorización no existe, no proviene de una solicitud verificada, ya expiró, o ya fue usada — ninguno de estos casos se distingue en el mensaje | `{"msg": "La autorización para restablecer tu contraseña no es válida o expiró"}` |

#### `POST /api/verify-registration-code`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-011-mandatory-email-verification.md`), reemplaza a `POST /api/verify-email` (`ADR-009`, retirado — ver nota debajo) |
| Blueprint | `auth_bp` (`backend/app/interfaces/routes/auth_routes.py`) |
| Auth requerida | No — quien lo llama todavía no puede iniciar sesión (la cuenta sigue sin verificar) |

**Semántica.** Verifica el código de 6 dígitos que `POST /api/register` (o un reenvío) ya envió por correo. Si es correcto, marca `users.email_verified = true` directamente — a diferencia de la recuperación de contraseña, verificar el código **es** la acción final, no hay un paso sensible posterior que proteger con una autorización intermedia. Máximo **5 intentos** por código (`domain/auth/token_policy.REGISTRATION_MAX_ATTEMPTS`) — agotarlos bloquea el código sin borrarlo, obligando a pedir uno nuevo (`resend-registration-code`). Todos los casos de rechazo (email inexistente, cuenta ya verificada, sin código activo, código expirado, intentos agotados, código incorrecto) devuelven el **mismo** mensaje y código — mismo criterio anti-enumeración que `verify-reset-code` (§4.8).

**Request body**
```json
{ "email": "string", "code": "string (6 dígitos)" }
```

**Response — éxito (200)**
```json
{ "msg": "Tu correo fue verificado correctamente.", "email_verified": true }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `email`/`code` ausentes; email sin cuenta asociada; cuenta ya verificada; sin código activo; código expirado; intentos agotados; código incorrecto — los siete casos comparten el mismo mensaje | `{"msg": "El código es incorrecto. Inténtalo nuevamente."}` |

#### `POST /api/resend-registration-code`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-011-mandatory-email-verification.md`) |
| Blueprint | `auth_bp`, mismo blueprint que `verify-registration-code` |
| Auth requerida | No — mismo criterio que `forgot-password` (§4.8), quien lo llama todavía no puede iniciar sesión |

**Semántica.** "Reenviar código" en la pantalla de verificación de registro. Si `email` corresponde a una cuenta real y todavía sin verificar, invalida el código activo anterior (si lo hay) y envía uno nuevo — sujeto al mismo cooldown de 60 segundos por usuario que `forgot-password` (`domain/auth/token_policy.REGISTRATION_CODE_REQUEST_COOLDOWN_SECONDS`), impuesto en el backend, no solo en el contador del Frontend. Si el email no existe, ya está verificado, o está en cooldown, no hace nada — en **todos** los casos la respuesta es idéntica (mismo criterio anti-enumeración que `forgot-password`).

**Request body**
```json
{ "email": "string" }
```

**Response — éxito (200), siempre el mismo mensaje**
```json
{ "msg": "Si existe una cuenta pendiente de verificación con ese correo, enviaremos un código nuevo." }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío, `email` ausente, o con formato inválido | `{"msg": "..."}` |

> ⚠️ **Retirados en v0.16.** `POST /api/send-verification-email` (protegido) y `POST /api/verify-email` (público, `ADR-009`, flujo de enlace) fueron **eliminados**, no solo deprecados: con `POST /api/login` ya bloqueado para cuentas sin verificar (§4.1), una cuenta sin verificar nunca puede obtener el JWT que el primero exigía — el par quedaba permanentemente inalcanzable, mismo criterio que `ADR-010` ya aplicó al reemplazar el flujo de enlace de recuperación de contraseña.

**Notas de implementación (los seis endpoints de esta sección):**
- Servicio de correo centralizado (`application/email/email_service.py`) detrás de un puerto `EmailSender` (`domain/email/sender.py`) — ningún endpoint ni caso de uso llama a Resend directamente (`ADR-009` §Decisión).
- El código de registro y el de recuperación de contraseña viven en tablas/repositorios completamente separados (`email_verification_tokens`/`password_reset_tokens`) — un código de uno nunca verifica al otro, ni por accidente ni por un valor coincidente (`ADR-011` §Decisión, purpose separation).
- Solo se persiste el hash de cada código (scrypt, no SHA-256 — baja entropía, `ADR-010`/`ADR-011` §Seguridad); ninguno de los dos valores crudos vuelve a aparecer en ningún response, log, ni URL.
- Sin `RESEND_API_KEY` configurada, el backend usa un `EmailSender` nulo que no envía nada de verdad pero no rompe ningún flujo — pensado para desarrollo local sin cuenta de Resend todavía (`ADR-009` §Riesgos). Si el envío real falla (Resend caído, credenciales inválidas), la excepción se propaga a un `500` genérico — la cuenta y el código ya persistidos quedan intactos, la persona puede pedir un código nuevo más tarde (`ADR-011` §Riesgos).

### 4.9 Autenticación con Google (OAuth 2.0 / OpenID Connect)

#### `POST /api/auth/google`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-012-google-sign-in.md`) |
| Blueprint | `auth_bp` (`backend/app/interfaces/routes/auth_routes.py`) |
| Auth requerida | No — es, en sí mismo, el mecanismo de autenticación. Google prueba la identidad, THERS emite su propio JWT a partir de ese resultado |

**Semántica.** Único endpoint para "Continuar con Google" desde Login **y** desde Register (FASE 3 de la tarea origen: es la misma operación, resuelve crear/vincular/loguear según corresponda). Recibe el ID Token (`credential`) que Google Identity Services le entregó al Frontend y lo verifica criptográficamente (firma, `iss`, `aud` contra `GOOGLE_CLIENT_ID`, `exp`) contra las claves públicas reales de Google — nunca confía en un email/nombre que el Frontend le pase por su cuenta. Según el resultado:

- Identidad de Google ya vinculada antes → login directo.
- Sin cuenta de THERS con ese email → cuenta nueva, `email_verified=true` (la garantía de Google reemplaza al OTP para este email), `profile_completed=false` (Google no entrega `phone`/`country_code`/`birth_date`; `username` nace con un valor provisorio que la persona debe reemplazar).
- Cuenta de THERS existente con ese email, ya verificada → se vincula la identidad de Google, la contraseña existente **no se toca** (Google se suma como método adicional).
- Cuenta de THERS existente con ese email, nunca verificada → se **reclama**: se vincula, se marca `email_verified=true`, y se **anula** cualquier contraseña existente (nadie había probado antes ser su dueño real — ver `ADR-012` §Decisión, account linking).
- Google indica `email_verified=false` en el propio ID Token → se rechaza, no se crea ni vincula nada.

**Request body**
```json
{ "credential": "string (ID Token de Google)", "terms_accepted": "boolean (opcional; ver abajo)" }
```

**Response — éxito (200)** — mismo shape que `POST /api/login`
```json
{
  "token": "string (JWT de acceso de THERS)",
  "refresh_token": "string (JWT de refresh -- ver §4.11)",
  "user": {
    "id": "string (UUID)",
    "username": "string",
    "email": "string",
    "name": "string",
    "phone": "string | null",
    "country_code": "string | null",
    "birth_date": "string (ISO yyyy-mm-dd) | null",
    "followers_count": "integer",
    "following_count": "integer",
    "email_verified": "boolean",
    "profile_completed": "boolean",
    "has_password": "boolean"
  }
}
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `credential` ausente; la credencial no pudo verificarse (firma inválida, `aud`/`iss` incorrectos, expirada, o simplemente no es un JWT bien formado — todos con el mismo mensaje, sin distinguir el motivo) | `{"msg": "No pudimos verificar tu cuenta de Google. Intentá de nuevo."}` |
| `400` | La propia Google indica `email_verified=false` para esa cuenta (caso raro) | `{"msg": "Tu cuenta de Google no tiene el correo verificado. THERS no puede usarla."}` |

**Notas de implementación:**
- El JWT emitido es idéntico en forma al de `POST /api/login` (`identity=user["id"]`, mismo `create_access_token`) — ningún endpoint protegido distingue si la sesión empezó por password o por Google.
- `GOOGLE_CLIENT_ID` (backend) y `VITE_GOOGLE_CLIENT_ID` (Frontend) deben ser el mismo valor — es el Client ID de OAuth creado en Google Cloud Console, no es secreto. `GOOGLE_CLIENT_SECRET` **no existe** como variable de este proyecto — este flujo (verificación de ID Token) no lo requiere.
- `PATCH /api/users/me` (§4.2, sin cambios de contrato) es la pantalla "Complete your profile" para una cuenta con `profile_completed=false` — sin endpoint nuevo.
- Ver `ADR-012-google-sign-in.md` para la política completa de account linking y el razonamiento de seguridad detrás de cada caso.

---

### 4.10 Mensajes

#### `POST /api/users/<user_id>/messages`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-013-messages-minimal-model.md`) |
| Blueprint | `messages_bp` (`backend/app/interfaces/routes/message_routes.py`) |
| Auth requerida | **Sí** — `Bearer <jwt>` en el header `Authorization`. `sender_id` sale exclusivamente del JWT, `recipient_id` de la URL — ninguno de los dos se acepta del body |

**Semántica.** Manda un mensaje de texto de la persona autenticada a `user_id`. Nunca idempotente — cada llamada crea una fila nueva (mismo criterio que crear un comentario, `ADR-006`).

**Request body**
```json
{ "content": "string", "client_id": "string (opcional, 1–64: letras, números, - o _)" }
```
`client_id` (v0.34, `ADR-035`) hace el envío **idempotente por remitente**: repetir la petición con el mismo `client_id` devuelve el mensaje ya creado con `200` en vez de duplicarlo (el texto del reintento se ignora). Sin `client_id` se mantiene el comportamiento anterior: cada llamada crea un mensaje (`201`). Las comprobaciones de bloqueo y de quién puede escribir se hacen **siempre**, también en un reintento. El mensaje público incluye `client_id` (`null` si no se envió).

**Response — éxito (201)**
```json
{
  "message": {
    "id": "string (UUID)",
    "sender_id": "string (UUID)",
    "recipient_id": "string (UUID)",
    "content": "string",
    "read": "boolean",
    "created_at": "string (ISO 8601)",
    "edited": "boolean"
  }
}
```
`edited` agregado en v0.22 (`ADR-021-content-editing.md`) — siempre `false` en un mensaje recién mandado.

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío o sin JSON; `content` ausente, vacío tras `trim()`, o mayor a 2000 caracteres; `user_id` es el propio usuario autenticado | `{"msg": "..."}` |
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `user_id` no corresponde a ningún usuario real; incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

#### `GET /api/users/<user_id>/messages`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-013-messages-minimal-model.md`) |
| Blueprint | `messages_bp`, mismo blueprint que `POST` |
| Auth requerida | **Sí** — mismo criterio que `POST`. Solo se puede leer un hilo propio (donde la persona autenticada es remitente o destinatario) |

**Semántica.** Historial de mensajes con `user_id`, ambos sentidos, orden cronológico **ascendente** (mensaje más viejo primero — a diferencia del feed/notificaciones, que van más reciente primero). Sin paginación real: límite fijo de **50** más recientes. **Efecto secundario:** marca como leídos los mensajes que `user_id` le mandó a la persona autenticada (`ADR-013` §Opciones consideradas — no hay un `PATCH .../read` separado).

**Request:** sin body. Header `Authorization: Bearer <token>` obligatorio. Query opcional (`ADR-035-chat-sync.md`, v0.34):

| Parámetro | Efecto |
|---|---|
| `limit` | Entero 1–100 (por defecto 50). Otro valor → `400` |
| `before` | Instante ISO 8601 **con zona horaria** (el `created_at` de un mensaje): los mensajes anteriores o iguales a ese instante (historial hacia atrás) |
| `after` | Igual, pero posteriores o iguales (recuperación tras perder la conexión) |

`before` y `after` no se combinan (`400`). Los cursores son **instantes, no ids**: el borrado de mensajes es duro y un id borrado no sirve de cursor. Son inclusivos, así que el cliente descarta duplicados por `id`.

**Response — éxito (200)**
```json
{ "messages": [ /* misma forma que el objeto de POST */ ], "has_more": false }
```
`has_more` (v0.34, aditivo): quedan más mensajes en la dirección pedida. Lista vacía (`[]`) si nunca hubo mensajes con esa persona.

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `user_id` no corresponde a ningún usuario real; incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

#### `GET /api/conversations`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-013-messages-minimal-model.md`) |
| Blueprint | `messages_bp` |
| Auth requerida | **Sí** — solo lista las conversaciones de la propia persona autenticada, sin `user_id` en la URL (mismo criterio que `GET /api/notifications`) |

**Semántica.** Lista, para cada persona con la que la persona autenticada tiene al menos un mensaje (enviado o recibido), el último mensaje del hilo y cuántos mensajes sin leer le mandó esa persona. Más reciente primero, por fecha del último mensaje.

**Request:** sin body. Header `Authorization: Bearer <token>` obligatorio.

**Response — éxito (200)**
```json
{
  "conversations": [
    {
      "user": { "id": "string (UUID)", "username": "string", "name": "string" },
      "last_message": {
        "content": "string",
        "sender_id": "string (UUID)",
        "created_at": "string (ISO 8601)"
      },
      "unread_count": "integer"
    }
  ]
}
```
Lista vacía (`[]`) si nunca mandó ni recibió ningún mensaje.

`last_message` **no** lleva `edited`: es una vista derivada, no el mensaje. Muestra el texto vigente (ya editado, si lo fue), pero la marca «editado» solo viaja en `GET .../messages`, donde el mensaje va completo (`ADR-021` §Riesgos).

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |

**Notas de implementación (los tres endpoints de arriba):**
- No existe una entidad `conversation`/`conversation_participants` en el esquema — una "conversación" es una vista derivada de los mensajes entre dos usuarios, no una fila propia (`ADR-013` §Opciones consideradas). No hay soporte de conversaciones grupales en esta versión.
- Sin tiempo real (WebSockets/Server-Sent Events) — el Frontend debe volver a pedir `GET /api/conversations`/`GET .../messages` periódicamente (*polling*) para ver mensajes nuevos, mismo criterio que `ADR-008` para notificaciones.
- Sin fotos/archivos adjuntos, sin confirmación de lectura visible para el remitente ("visto") en esta versión.
- **v0.19 — `read` en `GET .../messages` refleja el estado antes de marcar como leído** (`ADR-014-messages-ux-improvements.md`) — permite ubicar un separador de "mensajes no leídos" en el Frontend. Sin cambio de forma en la respuesta.

#### `PATCH /api/messages/<message_id>`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-021-content-editing.md`) |
| Blueprint | `messages_bp`, mismo blueprint que `POST`/`GET .../messages` y `DELETE /api/messages/<message_id>` |
| Auth requerida | **Sí**. Solo se puede editar un mensaje propio (`sender_id == get_jwt_identity()`) — quien lo **recibió** no puede editarlo |

**Semántica.** Reemplaza el texto del mensaje `message_id`, para ambas partes. Sin historial de versiones: quien ya lo había leído verá el texto nuevo con la marca «editado», sin forma de saber qué decía antes (`ADR-021` §Riesgos).

**`read` no cambia:** editar un mensaje que la otra persona ya leyó **no** lo devuelve a no leído, así que el separador de "mensajes no leídos" (v0.19) no se reordena porque alguien corrigió una palabra.

**Request body**
```json
{ "content": "string (1–2000 caracteres tras trim)" }
```
Obligatorio, con el mismo validador y el mismo límite que `POST .../messages`.

**Response — éxito (200)**
```json
{ "message": { /* misma forma que el objeto de POST .../messages, con "edited": true */ } }
```

**Request:** ruta plana (no anida bajo `/users/<id>/messages`): editar depende de quién mandó el mensaje, no de con quién es la conversación. `recipient_id` y `read` en el body se ignoran — editar un mensaje no puede redirigirlo a otra persona ni cambiar si fue leído (verificado por prueba).

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `content` ausente, vacío tras `trim()`, o mayor a 2000 caracteres | `{"msg": "..."}` |
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `message_id` no existe, **o** existe pero lo mandó otra persona — mismo mensaje/código en ambos casos; incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

#### `DELETE /api/messages/<message_id>`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-014-messages-ux-improvements.md`) |
| Blueprint | `messages_bp` |
| Auth requerida | **Sí**. Solo se puede borrar un mensaje propio (`sender_id == get_jwt_identity()`) |

**Semántica.** Borra el mensaje `message_id` — *hard delete*, sin placeholder ("mensaje eliminado" no existe en esta versión). Deja de existir para ambas partes.

**Request:** sin body.

**Response — éxito (200)**
```json
{ "deleted": true }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `message_id` no existe, **o** existe pero no le pertenece a quien hace la petición — mismo mensaje/código en ambos casos, no se distingue cuál ocurrió; incluye cualquier segmento de URL que no sea un UUID válido | `{"msg": "..."}` |

#### `POST /api/users/<user_id>/typing`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-014-messages-ux-improvements.md`) |
| Blueprint | `messages_bp` |
| Auth requerida | **Sí**. `sender_id` sale del JWT, `recipient_id` de la URL |

**Semántica.** Avisa que el usuario autenticado le está escribiendo a `user_id` en este momento. Vive en memoria del proceso del backend — **no** en PostgreSQL, sin migración ni tabla nueva (`ADR-014` §Opciones consideradas). Vigente por 3 segundos desde el último `POST`.

**Request:** sin body.

**Response — éxito (204, sin contenido)**

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |
| `404` | `user_id` no corresponde a ningún usuario real | `{"msg": "..."}` |

#### `GET /api/users/<user_id>/typing`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-014-messages-ux-improvements.md`) |
| Blueprint | `messages_bp` |
| Auth requerida | **Sí** |

**Semántica.** Indica si `user_id` le está escribiendo al usuario autenticado en este momento (dentro de los últimos 3 segundos).

**Request:** sin body.

**Response — éxito (200)**
```json
{ "typing": "boolean" }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Falta el header `Authorization`, el token es inválido/está malformado, o expiró | `{"msg": "..."}` |

**Notas de implementación (`DELETE .../messages`, `POST`/`GET .../typing`):**
- El indicador de "escribiendo" **no sobrevive un reinicio del backend** ni se comparte entre varios procesos/workers — vive en un diccionario del proceso de Flask (`ADR-014` §Riesgos). Aceptable para un servidor de desarrollo único; revisar si el backend pasa a desplegarse con `gunicorn -w N` con `N > 1`.
- Sin "borrado solo para mí", sin placeholder de mensaje eliminado — ambos quedan como decisión de producto futura (`ADR-014` §Decisiones pendientes).

---

### 4.11 Privacidad y solicitudes de seguimiento

> Los cinco endpoints de esta sección implementan la pantalla de Privacidad
> (REF-SET-02): `ADR-022-private-accounts.md`, `ADR-023-mentions.md` y
> `ADR-024-content-filters-and-privacy-preferences.md`. Todos operan **siempre
> sobre el usuario autenticado** — ninguno acepta un id de usuario para
> "actuar en nombre de" nadie.

#### `GET /api/users/me/privacy`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-022`/`ADR-023`/`ADR-024`) |
| Blueprint | `privacy_bp` (`backend/app/interfaces/routes/privacy_routes.py`) |
| Auth requerida | **Sí**. Nadie puede leer la privacidad de otra persona |

**Semántica.** Las siete preferencias de privacidad de la cuenta. Endpoint propio y **no** parte de `GET /api/users/me` (§4.2): ese es el contrato del perfil público y tiene reglas que no aplican acá (el cooldown de 30 días del `username`, el `409` por duplicado).

**Response — éxito (200)**
```json
{
  "privacy": {
    "is_private": "boolean",
    "pending_follow_requests_count": "integer",
    "who_can_mention": "everyone | followers | nobody",
    "who_can_message": "everyone | followers | nobody",
    "hide_offensive_comments": "boolean",
    "show_activity_status": "boolean",
    "last_seen_at": "string (ISO 8601) | null"
  }
}
```
`last_seen_at` **sí** se expone acá aunque `show_activity_status` sea `false`: lo que esa preferencia oculta es que lo vean **los demás** (§4.10, `conversation.user.last_seen_at`).

`muted_keywords` **no** viaja en este objeto: es una colección con su propio ciclo de vida, no una preferencia escalar.

**Response — error:** `401` estándar; `404` si el usuario del token ya no existe.

#### `PATCH /api/users/me/privacy`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo |
| Auth requerida | **Sí** |

**Semántica.** Actualización **parcial**: solo se tocan los campos presentes en el body. Devuelve el objeto `privacy` completo, igual que el `GET`.

**Request body** — whitelist de cinco campos editables, cualquier subconjunto:
```json
{
  "is_private": "boolean",
  "who_can_mention": "everyone | followers | nobody",
  "who_can_message": "everyone | followers | nobody",
  "hide_offensive_comments": "boolean",
  "show_activity_status": "boolean"
}
```
`pending_follow_requests_count` y `last_seen_at` son **derivados, no editables** — no están en la whitelist.

**Volverse privado NO degrada a los seguidores actuales** a solicitudes pendientes: quien ya tenía acceso lo conserva, y el interruptor solo cambia qué pasa con los follows **futuros** (`ADR-022` §Opciones consideradas).

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; ningún campo de la whitelist presente; un booleano que no es `true`/`false` (el string `"false"` se **rechaza**, no se interpreta); una audiencia fuera de los tres valores válidos | `{"msg": "..."}` |
| `401` | Estándar | `{"msg": "..."}` |

**Notas de implementación:**
- Whitelist declarada como dato (dos tuplas), no como una cadena de `if`s: agregar una preferencia es una línea y es imposible que se cuele una columna que no esté ahí (mismo principio anti mass-assignment que `PATCH /api/users/me`, `ADR-003` §Seguridad; verificado por prueba).
- Los booleanos se validan con `isinstance(value, bool)`: aceptar `"false"` por *truthiness* dejaría a alguien creyendo que cerró su cuenta cuando la abrió.

#### `GET /api/follow-requests`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-022`) |
| Blueprint | `follows_bp`, mismo que `POST`/`DELETE /api/users/<id>/follow` |
| Auth requerida | **Sí** |

**Semántica.** Las solicitudes de seguimiento **sin responder** dirigidas al usuario autenticado, más recientes primero, límite fijo de **50**. **No lleva `user_id` en la URL** — mismo criterio que `GET /api/notifications` (§4.7) y `GET /api/conversations` (§4.10): nadie puede listar las solicitudes de otro.

**Response — éxito (200)**
```json
{
  "follow_requests": [
    {
      "user": { "id": "UUID", "username": "string", "name": "string", "is_private": "boolean" },
      "requested_at": "string (ISO 8601)"
    }
  ]
}
```
Lista vacía (`[]`) si no hay ninguna. Que alguien te haya pedido seguirte **no** da acceso a sus datos: el solicitante se expone con la misma forma reducida que `post.author`.

**Response — error:** `401` estándar.

#### `POST /api/follow-requests/<user_id>/accept`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-022`) |
| Auth requerida | **Sí**. Solo se puede responder una solicitud **dirigida a uno mismo** |

**Semántica.** Aprueba la solicitud de `<user_id>` (que es **quien pidió seguir**; quien acepta sale del JWT). La fila de `follows` pasa a `'accepted'` y esa persona empieza a ver el contenido. Notifica `'follow_accepted'` al solicitante — sin eso no tendría forma de saber que ya puede verlo.

**Response — éxito (200)**
```json
{ "accepted": true }
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Estándar | `{"msg": "..."}` |
| `404` | La solicitud no existe, **o** ya se respondió, **o** está dirigida a otra persona — los tres con el mismo mensaje, sin distinguir cuál ocurrió; incluye cualquier segmento que no sea un UUID válido | `{"msg": "..."}` |

**No es idempotente:** aceptar dos veces devuelve `200` y después `404`, porque la fila ya no está en `'pending'`.

#### `DELETE /api/follow-requests/<user_id>`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-022`) |
| Auth requerida | **Sí**, mismas reglas que el `accept` |

**Semántica.** Rechaza la solicitud: **borra** la fila en vez de marcarla como rechazada. Así la persona puede volver a pedirlo más adelante y no queda un registro permanente de un "no" — el efecto es idéntico a que nunca hubiera pedido. **No se notifica el rechazo**: avisarle a alguien que lo rechazaste es información que no aporta y que invita a insistir.

Es `DELETE` y no `POST /reject` porque lo que pasa es que la solicitud deja de existir; aceptar sí es `POST` porque crea una relación nueva.

**Solo toca filas `'pending'`**, así que **nunca puede desaparecer a un seguidor ya aceptado** (verificado por prueba): para eso está `DELETE /api/users/<id>/follow`, que es del otro lado de la relación.

**Response — éxito (200)**
```json
{ "rejected": true }
```

**Response — error:** mismos `401`/`404` que el `accept`.

#### `GET`/`POST`/`DELETE /api/users/me/muted-keywords`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-024`) |
| Blueprint | `privacy_bp` |
| Auth requerida | **Sí**. Los términos son siempre los del usuario autenticado |

**Semántica.** Términos que quien pregunta no quiere ver. Se aplican **en el servidor**, en cada consulta: una publicación o un comentario que contenga alguno de ellos no aparece en `GET /api/posts` ni en `GET /api/posts/<id>/comments`, y `comments_count` lo refleja. **Solo afectan a quien los definió** — el resto de la gente ve ese contenido con normalidad. **El contenido propio nunca se oculta** a su autor.

Coincidencia por **subcadena** e insensible a mayúsculas: filtrar `spoiler` también oculta `spoilers`. Los términos se normalizan (trim + minúsculas) con la misma función que después los busca, para que no se pueda guardar uno que nunca llegue a encontrarse.

**Las tres respuestas devuelven la lista completa**, también el `POST` y el `DELETE`:
```json
{ "muted_keywords": ["spoilers", "resultado"] }
```
La pantalla de Configuración siempre muestra la lista entera, así que devolverla ahorra una segunda petición (mismo criterio que `PATCH /api/posts/<id>`, §4.3).

**`POST`** — body `{"keyword": "string (1–60 caracteres tras trim)"}`. Devuelve **`200`, no `201`**: es idempotente, agregar un término que ya tenías devuelve el mismo estado (mismo criterio que `POST /api/posts/<id>/like`, §4.4).

**`DELETE`** — **el término va en el body**, no en la URL:
```json
{ "keyword": "spoilers" }
```
Es el **único `DELETE` del contrato con body**, y es deliberado: un término puede contener espacios, acentos y `/`, y meterlo en el path obligaría a *percent-encoding* en los dos lados para nada.

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Body vacío; `keyword` ausente, vacío tras `trim()`, o mayor a 60 caracteres | `{"msg": "..."}` |
| `401` | Estándar | `{"msg": "..."}` |
| `404` | (`DELETE`) el usuario no tiene ese término filtrado | `{"msg": "..."}` |
| `409` | (`POST`) se alcanzó el límite de **100** términos. El tope existe porque cada término es un `ILIKE` en las consultas de lectura: una lista sin límite degradaría el feed de quien la tenga | `{"msg": "..."}` |

---

### 4.12 Seguridad: sesiones y verificación en dos pasos

> `ADR-025-session-registry.md` y `ADR-026-two-factor-authentication.md`.
> Todos operan **siempre sobre el usuario autenticado** salvo
> `POST /api/2fa/verify`, que es el único público de la sección (en ese punto
> todavía no hay sesión).
>
> **Nota transversal obligatoria.** Desde v0.24 un JWT solo autentica si su
> `jti` tiene una sesión viva. Eso **no cambia la forma** de ningún endpoint,
> pero sí cuándo responden `401`: cerrar una sesión invalida su token de
> inmediato, y un token emitido sin pasar por `login`/`auth/google`/`2fa/verify`
> no autentica nunca. El `401` de un token revocado lleva un mensaje distinto
> del de uno expirado.

#### `GET`/`PATCH /api/users/me/security`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-025`) |
| Blueprint | `security_bp` (`backend/app/interfaces/routes/security_routes.py`) |
| Auth requerida | **Sí**. Nadie lee ni cambia las preferencias de otra persona |

**Semántica.** Preferencias de seguridad. Endpoint propio y **no** parte de `/users/me/privacy` (§4.11): privacidad es "quién ve qué", seguridad es "quién puede entrar". Hoy transporta una sola preferencia.

**Response — éxito (200)**
```json
{ "security": { "login_alerts_enabled": "boolean" } }
```
`login_alerts_enabled` nace en **`true`**, a diferencia de casi todas las preferencias del proyecto: una alerta de seguridad que hay que descubrir y encender no protege a nadie.

**`PATCH`** acepta solo ese campo. `400` si el body está vacío, si no trae ningún campo de la whitelist, o si el valor no es un booleano real — el string `"false"` se **rechaza**, no se interpreta.

**Cuándo se manda la alerta.** Al iniciar sesión desde un `User-Agent` que esa cuenta **no había usado antes** (incluidas sesiones ya cerradas). No en cada login: eso sería ruido y nadie lo leería. El correo **no lleva enlaces de acción** a propósito — un enlace accionable desde un correo es un vector de *phishing*; dirige a la pantalla de Seguridad. Un fallo de envío nunca impide el login.

#### `GET /api/sessions`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-025`) |
| Auth requerida | **Sí** |

**Semántica.** Sesiones **vivas** del usuario autenticado, más reciente primero, límite fijo de **50**. Las cerradas no se listan (la fila se conserva en el servidor, pero mostrarlas solo acumularía ruido). No lleva `user_id` en la URL — mismo criterio que `GET /api/notifications` y `GET /api/sessions` no puede listar las de otro.

**Response — éxito (200)**
```json
{
  "sessions": [
    {
      "id": "string (UUID)",
      "user_agent": "string | null",
      "ip_address": "string | null",
      "created_at": "string (ISO 8601)",
      "last_used_at": "string (ISO 8601) | null",
      "is_current": "boolean"
    }
  ]
}
```

**El `jti` NUNCA se expone.** Es el identificador que valida cada petición, así que devolverlo convertiría esta lista en una lista de identificadores de token. Para cerrar una sesión se usa su `id`, que no autentica nada.

`user_agent` viaja **crudo, sin parsear**: el servidor no tiene una base de datos de user agents y adivinar produciría etiquetas equivocadas *persistidas*. El resumen ("Chrome en Windows") lo hace el Frontend, y si no reconoce el UA muestra el texto original — más útil que una etiqueta equivocada.

`ip_address` sale de `X-Forwarded-For` cuando existe. Es un header que el cliente puede falsificar, así que **solo se muestra, nunca autoriza**.

`last_used_at` se actualiza con un throttle de 5 minutos, así que es aproximado: "activa hace 1 minuto" puede significar hasta 5.

#### `DELETE /api/sessions/<session_id>`

**Semántica.** Cierra esa sesión; su token deja de valer de inmediato. **Se permite cerrar la propia** — es lo mismo que cerrar sesión, y bloquearlo obligaría a explicar una excepción sin ganar nada.

**Response — éxito (200)**
```json
{ "revoked": true, "was_current": "boolean" }
```
`was_current` le dice al cliente que el token con el que acaba de hacer esta petición ya no sirve para la siguiente, para que redirija a login en vez de dejar la pantalla rota.

**No es idempotente:** cerrar dos veces devuelve `200` y después `404`.

| Código | Causa |
|---|---|
| `401` | Estándar |
| `404` | La sesión no existe, **o** ya estaba cerrada, **o** es de otra persona — los tres con el mismo mensaje; incluye cualquier segmento que no sea un UUID válido |

#### `DELETE /api/sessions`

**Semántica.** Cierra **todas menos la actual**. No lleva id porque la acción es "las demás", no "una concreta". **Nunca cierra la propia:** es la acción que alguien ejecuta justamente cuando sospecha que otro dispositivo tiene acceso — hacerlo salir también sería contraproducente.

```json
{ "revoked_count": "integer" }
```

#### `GET /api/2fa`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — nuevo (`ADR-026`) |
| Auth requerida | **Sí** |

```json
{
  "two_factor": {
    "enabled": "boolean",
    "setup_pending": "boolean",
    "recovery_codes_remaining": "integer"
  }
}
```
`setup_pending` significa "hay un secreto guardado pero sin confirmar": alguien pidió el QR y no completó el alta. Es un estado real y visible a propósito — ver el porqué en `POST /api/2fa/setup`.

#### `POST /api/2fa/setup`

**Semántica.** **Primer paso de dos.** Genera un secreto TOTP y lo guarda **sin activar el 2FA**. Repetirlo genera uno nuevo y descarta el anterior.

```json
{ "two_factor_setup": { "secret": "string (base32)", "provisioning_uri": "otpauth://totp/..." } }
```

**La respuesta lleva el secreto en claro** — hace falta para el QR y para el alta manual. Por eso el endpoint es `POST` y protegido, y por eso ese valor **nunca se registra en un log**.

`409` si el 2FA ya está activo: para cambiar de dispositivo hay que desactivar primero. Regenerar el secreto de un 2FA activo dejaría afuera al dispositivo que funcionaba si el alta nueva no se completa.

#### `POST /api/2fa/confirm`

**Semántica.** **Segundo paso.** Exige un código válido del secreto guardado y recién entonces activa el 2FA. Esta separación es lo que evita que escanear el QR y abandonar deje la cuenta exigiendo un código que la app de la persona no puede generar.

**Request:** `{"code": "string (6 dígitos)"}`

**Response — éxito (200)**
```json
{ "recovery_codes": ["ABCDE-FGHJK", "..."] }
```
Diez códigos. **Es la única vez que existen en claro** — solo se persisten sus hashes scrypt. Cada uno sirve una sola vez. Alfabeto sin caracteres ambiguos (sin `I`/`L`/`O`/`0`/`1`) y con guion cada cinco, para transcribirlos sin errores.

| Código | Causa |
|---|---|
| `400` | Body vacío, `code` ausente, **o** el código no coincide. No `401`: la identidad ya está probada (endpoint protegido), lo que falla es el dato. **El secreto no se borra** — se puede reintentar con el siguiente código sin volver a escanear |
| `409` | No se pidió un secreto antes (`setup`), o el 2FA ya está activo |

#### `POST /api/2fa/verify` — **público**

**Semántica.** **Segundo paso del login.** Único endpoint público de esta sección: en este punto todavía no hay sesión.

**Request:** `{"two_factor_token": "...", "code": "..."}`

`code` acepta **o** un TOTP de 6 dígitos **o** un código de recuperación (que se consume). Se prueba el TOTP primero porque es el caso normal.

**Response — éxito (200)**
```json
{
  "token": "string (JWT de sesión)",
  "refresh_token": "string (JWT de refresh, ver §4.16)",
  "user": { "...": "igual que en POST /api/login" },
  "used_recovery_code": "boolean",
  "recovery_codes_remaining": "integer"
}
```
Desde v0.30 este documento incluye `refresh_token`, que el código ya devolvía (`_issue_session_token`, el mismo camino que login y Google) pero esta respuesta no listaba.
`used_recovery_code` permite avisar "usaste un código de recuperación, te quedan N" en vez de dejarlo pasar inadvertido.

**`401`** si el `two_factor_token` es inválido, expiró, **o no es un token de desafío**, y también si el código no es válido. **Un solo mensaje para todos los casos:** distinguir "ese no era un TOTP pero lo probé como recuperación" revelaría qué espera el servidor y en qué estado está la cuenta.

**Dos propiedades del token de desafío, las dos verificadas por prueba:**
- **No sirve en ningún endpoint protegido.** Es un JWT firmado, pero no tiene fila en `sessions`, así que el mecanismo de v0.24 lo rechaza — sin código extra.
- **Un token de sesión no sirve como desafío.** Se comprueba su claim `purpose`. Sin eso, cualquiera con una sesión válida podría usar este endpoint para emitirse sesiones nuevas salteándose el segundo factor.

Vive **5 minutos**.

> ⚠️ **Sin *rate limiting*** (§9, ítem 8). Un TOTP son 10⁶ combinaciones en una ventana de 30 s: es el endpoint donde esa ausencia sí es explotable.

#### `POST /api/2fa/disable`

**Semántica.** Desactiva el 2FA, **borra el secreto**, **borra los códigos de recuperación** (si no, se podría entrar con un código de recuperación de un 2FA que ya no existe) y **cierra todas las sesiones, incluida la actual** — bajar el nivel de protección de la cuenta es el momento de forzar un login nuevo.

**Pide la CONTRASEÑA, no un código TOTP.** Si exigiera un código, quien perdió el dispositivo quedaría atrapado con el 2FA puesto para siempre. La contraseña es lo que ya protegía la cuenta antes.

Es `POST` y no `DELETE` aunque "apague" algo: además de desactivar, borra y revoca. No es la eliminación de un recurso.

**Request:** `{"password": "string"}` → **Response (200):** `{"enabled": false, "sessions_revoked": true}`

| Código | Causa |
|---|---|
| `401` | La contraseña no es correcta. Mismo mensaje genérico que un login fallido — no revela que una cuenta creada solo con Google no tiene contraseña (`ADR-012`) |
| `409` | El 2FA no está activo |

#### `POST /api/2fa/recovery-codes`

**Semántica.** Genera diez códigos nuevos e **invalida los anteriores en la misma operación**: si no, quedarían dos juegos válidos y la persona no sabría cuál tiene anotado. Pide contraseña por el mismo motivo que `disable`: es una credencial de acceso.

**Request:** `{"password": "string"}` → **Response (200):** `{"recovery_codes": [...]}` (mismos `401`/`409` que `disable`).

---

### 4.13 Exportación de datos (`ADR-028-data-export.md`)

Tres endpoints, todos protegidos (`Authorization: Bearer <token>`). La identidad sale solo del JWT.

#### `POST /api/data-exports`

Genera un ZIP con los datos de la cuenta, en el momento (síncrono). **Request:** sin body.

**Response (201):** `{"export": {...}, "ttl_days": 7}`, con `export` = `{id, file_name, size_bytes, status, created_at, expires_at, downloaded_at, download_count}`.

| Código | Causa |
|---|---|
| `401` | Sin token o token inválido |
| `429` | Ya pidió un archivo hace menos de una hora. Lleva `Retry-After` y `retry_after_seconds` (mismo formato que `ADR-027`) |

#### `GET /api/data-exports`

Historial, más reciente primero (máx. 20). Al listar, el contenido vencido se descarta y esas filas pasan a `status: "expired"`.

**Response (200):** `{"exports": [...], "ttl_days": 7, "cooldown_seconds": 3600}`. `status` es `"ready"` o `"expired"`.

#### `GET /api/data-exports/<export_id>/download`

Descarga el ZIP (`Content-Type: application/zip`, `Content-Disposition: attachment`, `Cache-Control: no-store`) y registra la descarga.

| Código | Causa |
|---|---|
| `401` | Sin token o token inválido |
| `404` | No existe **o es de otra cuenta** — mismo mensaje en ambos casos |
| `410` | El archivo caducó (7 días) |

**Contenido del ZIP:** `LEEME.txt` y un JSON por sección (`profile`, `posts`, `comments`, `likes`, `following`, `followers`, `messages`, `notifications`, `muted_keywords`, `sessions`). Nunca incluye hash de contraseña, secreto TOTP ni `jti` de sesión. **No está cifrado.**

---

### 4.14 Bloqueo y restricción de cuentas (`ADR-029-blocked-and-restricted-accounts.md`)

Colección propia del usuario autenticado, bajo `/users/me/...` (igual que privacidad y seguridad). Todos protegidos; `owner` sale solo del JWT.

| Método y ruta | Descripción |
|---|---|
| `GET /api/users/me/blocks` | Cuentas que bloqueé → `{"blocks": [{"user": {id, name, username}, "created_at"}]}` |
| `POST /api/users/me/blocks` | Bloquea. Body: **`{"user_id": "<uuid>"}` o `{"username": "@alguien"}`** (uno de los dos) → `{"blocked": true, "user_id"}` |
| `DELETE /api/users/me/blocks/<user_id>` | Desbloquea. Idempotente → `{"blocked": false, "user_id"}` |
| `GET /api/users/me/restrictions` | Cuentas que restringí → `{"restrictions": [...]}` (misma forma) |
| `POST /api/users/me/restrictions` | Restringe. Mismo body → `{"restricted": true, "user_id"}` |
| `DELETE /api/users/me/restrictions/<user_id>` | Quita la restricción. Idempotente |

| Código | Causa |
|---|---|
| `400` | Body sin `user_id` ni `username`, `user_id` que no es UUID, o intentar bloquear/restringirse a uno mismo |
| `404` | El usuario no existe |
| `409` | (solo `restrictions`) la cuenta está bloqueada; hay que desbloquearla antes |

**Una cuenta está bloqueada o restringida, nunca ambas:** bloquear a una cuenta restringida la pasa a bloqueada.

**Qué hace un bloqueo en el resto de la API** (simétrico: aplica si bloqueó cualquiera de los dos). Ningún endpoint cambia de forma en su camino de éxito; son respuestas o filtros nuevos:

| Endpoint | Efecto |
|---|---|
| `GET /api/posts` | Los posts de la cuenta bloqueada no aparecen |
| `GET`/`POST /api/posts/<id>/comments`, `POST`/`DELETE /api/posts/<id>/like` | `404` si el autor del post tiene un bloqueo con quien pregunta |
| `GET /api/posts/<id>/comments`, `comments_count` | Los comentarios de la cuenta bloqueada no aparecen **ni cuentan** |
| `POST /api/users/<id>/follow` | Bloquear cancela los follows (aceptados y pendientes) en los dos sentidos. Seguir: `404` si el destino bloqueó a quien pregunta; **`409`** si fue quien pregunta quien bloqueó |
| `POST /api/users/<id>/messages` | Mismo criterio: `404` / `409` |
| `GET /api/users/<id>/messages` | `404` con un bloqueo en cualquier sentido (los mensajes no se borran) |
| `GET /api/conversations` | Las conversaciones con una cuenta bloqueada no se listan ni suman al no leído |
| `GET /api/notifications` | Se omiten las de cuentas bloqueadas |
| Menciones (`POST`/`PATCH /api/posts`, `/api/comments`) | Un `@usuario` con bloqueo no se resuelve como mención ni notifica |

**Restricción:** los comentarios de la cuenta restringida **en publicaciones de quien la restringió** quedan ocultos de `GET /api/posts/<id>/comments` y de `comments_count` para todos, **salvo** su autor y el dueño de la publicación. No cambia nada más.

**Por qué `404` y no `403` al bloqueado:** el bloqueo no debe revelarse. A quien bloqueó sí se le dice (`409`).

---

### 4.15 Preferencias de contenido y feed (`ADR-030-content-preferences.md`)

Las **palabras ocultas** (`/api/users/me/muted-keywords`, §4.11) ya existían y no cambian.

#### Contenido sensible

- **`POST /api/posts`** acepta un campo opcional **`is_sensitive`** (booleano; por defecto `false`). Lo que el **autor declara**: no es una clasificación del servidor. Un valor que no sea `true`/`false` real (p. ej. el texto `"false"`) → `400`.
- Todo post (`POST`/`GET /api/posts`, `PATCH /api/posts/<id>`) incluye **`is_sensitive`** en la respuesta.
- **`PATCH /api/users/me/privacy`** acepta **`hide_sensitive_content`** (booleano) junto a los demás campos de §4.11, y `GET /api/users/me/privacy` lo devuelve. Con `true`, `GET /api/posts` **omite** los posts con `is_sensitive` de otras personas. Los propios nunca se omiten.
- No se puede cambiar `is_sensitive` de un post ya creado.

#### Temas silenciados

Un tema es un hashtag; se reconoce dentro del texto del post. Silenciar `viajes` oculta `#viajes` (etiqueta completa, sin distinguir mayúsculas), **no** `#viajes2`.

| Método y ruta | Descripción |
|---|---|
| `GET /api/users/me/muted-topics` | → `{"muted_topics": ["viajes", ...]}` (más reciente primero) |
| `POST /api/users/me/muted-topics` | Body `{"topic": "#Viajes"}`. Se normaliza (sin `#`, minúsculas). Idempotente (`200`). Devuelve la lista completa |
| `DELETE /api/users/me/muted-topics` | Body `{"topic": "viajes"}` (en el body, igual que `muted-keywords`). Devuelve la lista completa |

| Código | Causa |
|---|---|
| `400` | Tema vacío, de más de 50 caracteres, o con algo que no sea letra, número o `_` |
| `404` | (solo `DELETE`) ese tema no estaba silenciado |
| `409` | (solo `POST`) ya tiene 50 temas |

Los posts con un tema silenciado se omiten de `GET /api/posts`; los propios nunca.

#### `GET /api/users/suggestions`

Hasta 5 cuentas reales que la persona **todavía no sigue** (ni le pidió seguir), sin la propia y **sin cuentas con un bloqueo en ningún sentido** (§4.14). Orden: más seguidores aceptados primero.

**Response (200):** `{"suggestions": [{"id", "name", "username", "is_private"}]}`. Forma reducida: nunca email ni teléfono.

---

### 4.16 Sesión (refresh token)

Política completa y razonamiento: `ADR-017-jwt-session-policy.md`. El **access token** (15 min) autoriza todos los endpoints protegidos, sin cambios. El **refresh token** (30 días) solo sirve para estos dos endpoints y es de **un solo uso**: cada renovación lo consume y entrega uno nuevo.

#### `POST /api/refresh`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** (v0.21) |
| Blueprint | `auth_bp` |
| Auth requerida | **Sí, con el refresh token** (`Authorization: Bearer <refresh_token>`). Un access token aquí da `401` |

**Request body:** ninguno.

**Response — éxito (200)**
```json
{
  "token": "string (JWT de acceso nuevo)",
  "refresh_token": "string (JWT de refresh nuevo; el anterior queda consumido)"
}
```

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `401` | Sin header, token inválido o expirado, **no es un refresh token**, nunca registrado, revocado, o **ya consumido** (reuso: además revoca toda la sesión) — mismo mensaje en todos los casos | `{"msg": "..."}` |

**Reglas para el cliente (`ADR-017` §4.4):** una sola renovación en vuelo (el resto de peticiones espera); ante `401` en esta llamada, cerrar sesión y volver al login sin reintentos; un error de **red** al renovar no es un `401` y no debe cerrar la sesión. Guardar siempre el refresh nuevo antes de usar el par. Si la respuesta se pierde por la red, el refresh anterior ya está consumido (riesgo aceptado en la v1, `ADR-017` §7).

#### `POST /api/logout`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** (v0.21) |
| Blueprint | `auth_bp` |
| Auth requerida | **Sí, con el refresh token** |

**Request body:** ninguno. Revoca toda la sesión (cadena de renovaciones) a la que pertenece el refresh presentado; **otras sesiones del mismo usuario no se tocan**. Idempotente.

**Response — éxito (200):** `{"msg": "Sesión cerrada"}`

| Código | Causa | Body |
|---|---|---|
| `401` | Sin header, token inválido o expirado, o es un access token | `{"msg": "..."}` |

**Limitación conocida:** el **access token ya emitido sigue siendo válido hasta expirar** (≤ 15 min); no hay lista de revocación de access tokens. El cliente debe descartarlo localmente.

---

### 4.17 Imágenes de perfil (`ADR-015`)

Documentado en v0.20 de forma retroactiva (ver el changelog). Todo el contenido de esta sección se verificó contra el código y las pruebas del backend.

#### `POST /api/users/me/avatar` y `POST /api/users/me/cover`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** |
| Blueprint | `users_bp` |
| Auth requerida | Sí (access token) |

**Request:** `multipart/form-data` con un campo **`file`** que contiene la imagen. Formatos aceptados: JPEG, PNG o WebP. Tamaño máximo **5 MB** y 40 millones de píxeles. El backend **vuelve a codificar** la imagen (se descartan los metadatos EXIF) y guarda una versión WebP.

**Response — éxito (200)**
```json
{ "user": { "...": "objeto user completo (§5), con avatar_url o cover_url ya actualizado" } }
```

| Código | Causa | Body |
|---|---|---|
| `400` | No se envió `file`, o no es una imagen JPEG/PNG/WebP válida | `{"msg": "..."}` |
| `401` | Sin token, token inválido o expirado | `{"msg": "..."}` |
| `404` | El usuario del token ya no existe | `{"msg": "..."}` |
| `413` | La imagen supera 5 MB | `{"msg": "..."}` |

#### `DELETE /api/users/me/avatar` y `DELETE /api/users/me/cover`

Mismo blueprint y autenticación. Sin body. Quita la imagen y devuelve `200` con `{"user": {...}}` (con la URL en `null`). `401` y `404` como arriba.

#### `GET /api/media/<ruta>`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** — solo con `STORAGE_BACKEND=local` |
| Auth requerida | **No** (las imágenes son públicas) |

Sirve las imágenes guardadas en disco. Responde con `Cache-Control: public, max-age=31536000, immutable` y `X-Content-Type-Options: nosniff`. Con `STORAGE_BACKEND=s3` esta ruta **no se registra**: las imágenes las sirve directamente el proveedor desde su URL pública. El almacenamiento local no sirve en un host con disco efímero (`ADR-018`).

#### `PATCH /api/users/me` — campos nuevos

Además de los de §4.2, acepta `bio` (≤ 160), `location` (≤ 60) y `website` (≤ 100, debe ser una URL válida). Una cadena vacía **borra** el valor (queda `null`). Superar el límite o una URL inválida da `400`.

---

---

### 4.18 Reportes y aceptación de términos (`ADR-032`, fase 1)

> **Estado: PROPUESTO.** Implementado en una rama sin mergear, **pendiente de la ratificación de `ADR-032`**. Documentado el mismo día que el código (`HB-001` §15.1). Las rutas de moderación (cola, resolver, suspender) **no existen todavía**: son de la fase 2.

#### `POST /api/reports`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** (rama, sin mergear) |
| Blueprint | `reports_bp` |
| Auth requerida | Sí (access token) |

**Request body**
```json
{
  "target_type": "post | comment | message | user",
  "target_id": "string (UUID)",
  "reason": "spam | harassment | hate | sexual | violence | self_harm | illegal | impersonation | other | child_safety",
  "details": "string, opcional, hasta 500 caracteres"
}
```
`reporter_id`, `reported_user_id`, `status`, **`priority`** y cualquier otro campo del cuerpo **se ignoran**: quien reporta sale solo del JWT y la prioridad la calcula el servidor.

**Motivo `child_safety` (v0.32).** «Explotación o abuso de menores». Está disponible para **los cuatro** `target_type` (`post`, `comment`, `message`, `user`) con sus mismas guardias de visibilidad: no se puede reportar con él lo que no se puede ver. Siempre produce `priority: "critical"`. Los demás motivos producen `priority: "normal"`. Un valor de `reason` que no esté en la lista (incluidas variantes como `CHILD_SAFETY` o `child-safety`) responde `400`.

**Escalada.** Como (`reporter_id`, `target_type`, `target_id`) es único, si esa persona ya había reportado el objetivo con un motivo menos urgente y ahora lo reporta como `child_safety`, **no se crea otro**: se eleva el existente (motivo, prioridad y, si se envió, el detalle) y se reabre si estaba `dismissed`. Responde `200` con `already_reported: true` y `priority: "critical"`. Un reporte posterior **menos** urgente nunca baja la prioridad.

**Límite de uso.** `child_safety` cuenta contra su propio límite (`REPORT_CHILD_SAFETY`, 30 por hora y por persona), distinto del de los demás motivos (`REPORT_CREATE`, 10 por hora), para que haber hecho reportes comunes no impida denunciar una explotación de menores.

**Qué se puede reportar.** Solo lo que quien reporta **puede ver**, con las mismas guardias que protegen la lectura (cuentas privadas de `ADR-022`, bloqueos de `ADR-029`):

| `target_type` | Regla |
|---|---|
| `post` | Visible para quien reporta |
| `comment` | El post es visible **y** su autor no está bloqueado en ningún sentido |
| `message` | **Solo quien lo recibió**, y sin bloqueo entre ambos. El remitente y los terceros reciben `404` |
| `user` | La cuenta existe y no hay bloqueo entre ambos |

No se puede reportar lo propio (`400`). La visibilidad se comprueba **antes** que "es mío", para que ese `400` no sirva para confirmar que algo existe.

**Response — éxito**
```json
{
  "report": {
    "id": "string (UUID)",
    "target_type": "string",
    "target_id": "string (UUID)",
    "reason": "string",
    "status": "open",
    "priority": "normal | critical",
    "created_at": "string (ISO 8601)",
    "already_reported": "boolean"
  }
}
```
- `201` si el reporte es nuevo; **`200` con `already_reported: true`** si esa persona ya había reportado lo mismo. Es idempotente, también ante dos peticiones simultáneas (índice único), y la segunda **no** cambia el motivo del primero.
- La respuesta **nunca** incluye quién reportó, a quién se reportó ni el texto copiado: la persona reportada no debe poder enterarse de quién fue.

**Response — error**

| Código | Causa | Body |
|---|---|---|
| `400` | Cuerpo ausente o no es un objeto; `target_type`, `target_id` o `reason` inválidos; `details` no es texto o supera 500 caracteres; se intenta reportar lo propio | `{"msg": "..."}` |
| `401` | Sin token, token inválido o expirado | `{"msg": "..."}` |
| `404` | El objetivo no existe **o quien reporta no puede verlo**: un único mensaje para los dos casos (`"No encontramos lo que quieres reportar"`) | `{"msg": "..."}` |
| `429` | Más de **10 reportes por hora** por persona (`ADR-027`, regla `REPORT_CREATE`) | `{"msg": "...", "retry_after_seconds": N}` + header `Retry-After` |

**Qué se guarda.** Una copia del texto reportado (`content_snapshot`, hasta 2000 caracteres: el texto del post, comentario o mensaje; para una cuenta, solo los campos de texto **públicos** del perfil, sin correo, teléfono ni fecha de nacimiento). Existe para que quien modere vea *qué se dijo* aunque el contenido se borre o se edite. Se vacía al resolver el reporte (fase 2).

#### `POST /api/users/me/terms-acceptance`

| Campo | Valor |
|---|---|
| Estado | **IMPLEMENTADO** (rama, sin mergear) |
| Blueprint | `terms_bp` |
| Auth requerida | Sí |

Para las cuentas que **ya existían** y no aceptaron nada al registrarse: se les pide aceptar los términos vigentes antes de crear contenido. Las cuentas nuevas aceptan en el propio registro.

**Request body:** `{"version": "string"}`, la versión que el cliente mostró.

**Response — éxito (200):** `{"user": { ... objeto user (§5), con `terms_accepted: true` }}`. Idempotente.

| Código | Causa | Body |
|---|---|---|
| `400` | Cuerpo ausente o no es un objeto | `{"msg": "..."}` |
| `401` | Sin token, token inválido o expirado | `{"msg": "..."}` |
| `409` | `version` **no es la vigente** (o falta, o no es texto): el cliente mostró términos que ya no rigen | `{"msg": "...", "current_version": "string"}` |

#### `terms_accepted` en el registro y en Google

- **Opcional por defecto.** Si viene `true`, se guardan `terms_accepted_at` y `terms_version` **después** de crear la cuenta. Solo cuenta el booleano `true`.
- **Con `TERMS_ACCEPTANCE_REQUIRED` activado** (variable de entorno, **apagada por defecto**), `POST /api/register` responde `400` con `terms_required: true` si falta, y `POST /api/auth/google` hace lo mismo **solo cuando la cuenta de Google es nueva**. Iniciar sesión con una cuenta de Google que ya existe no la necesita. Se activa cuando el Frontend y la app móvil ya envíen la casilla (`ADR-032` fases 3 y 4); activarla antes dejaría sin poder registrarse a quien use un cliente que todavía no la envía.
- **Versión vigente:** variable `TERMS_VERSION` (una fecha de publicación; **placeholder** hasta que el equipo publique los términos definitivos). Cambiarla hace que `terms_accepted` vuelva a `false` en todas las cuentas y a todo el mundo se le vuelva a pedir aceptar.

---

## 5. Modelo de datos expuesto por la API

Este documento no define el modelo de datos (eso es `DATABASE_ARCHITECTURE.md`) pero sí documenta **qué forma tiene el dato tal como cruza la frontera HTTP**, que puede no coincidir 1:1 con el modelo de persistencia:

| Objeto | Campos expuestos hoy | Fuente |
|---|---|---|
| `user` (en response de register, login, `POST /api/auth/google`, `GET /api/users/me` y `PATCH /api/users/me`) | `id`, `username`, `email`, `name`, `phone` (nullable desde v0.17), `country_code` (nullable desde v0.17), `birth_date` (nullable desde v0.17), `followers_count`, `following_count`, `email_verified`, `profile_completed` (v0.17), `has_password` (v0.17), `is_private` (v0.23) | `ADR-002-user-profile-fields.md` + `ADR-007-follows-minimal-model.md` (`followers_count`/`following_count`, v0.12) + `ADR-009-password-reset-and-email-verification.md` (`email_verified`, v0.14) + `ADR-012-google-sign-in.md` (`profile_completed`/`has_password`, `phone`/`country_code`/`birth_date` nullable, v0.17); coincide con `users` en `DATABASE_ARCHITECTURE.md` §5, sin exponer `password_hash` (correcto — `has_password` es un booleano derivado, nunca el hash en sí). `username_changed_at` (`ADR-003-profile-update-contract.md`) existe en `users` pero **nunca** cruza la frontera HTTP — es un dato interno de soporte para el cooldown de `username`, no un campo del contrato |
| `post` (en response de `POST`/`GET`/`PATCH /api/posts`) | `id`, `author` (`id`/`username`/`name`/`is_followed_by_me`/`follow_status`/`is_private`, forma reducida de `user`), `content`, `created_at`, `edited`, `mentions`, `likes_count`, `liked_by_me`, `comments_count` | `ADR-004-posts-minimal-model.md` + `ADR-005-likes-minimal-model.md` (`likes_count`/`liked_by_me`, v0.10) + `ADR-006-comments-minimal-model.md` (`comments_count`, v0.11) + `ADR-007-follows-minimal-model.md` (`author.is_followed_by_me`, v0.12) + `ADR-021-content-editing.md` (`edited`, v0.22); coincide con `posts` en `DATABASE_ARCHITECTURE.md` §5. `edited` se deriva de `edited_at` (internamente un timestamp nullable, NULL = nunca editado) — se expone como booleano, nunca como el timestamp crudo, mismo criterio que `notification.read`/`message.read`. `updated_at` sigue **sin** exponerse: existe en `posts` pero no es la señal de edición (`ADR-021` §Opciones consideradas, opción B descartada). **v0.23:** `mentions` (`ADR-023-mentions.md`) lista solo las menciones que el servidor autorizó — un `@username` inexistente o cuyo dueño no las acepta **no** aparece acá y no debe enlazarse; `author.follow_status` (`ADR-022`) expone el tercer estado que `is_followed_by_me` no puede (`'pending'`), y `author.is_private` le dice al Frontend que seguir a esa persona manda una solicitud |
| `like` — no se expone como objeto propio; solo el resumen agregado (`likes_count`/`liked_by_me`) embebido en `post` | — | `ADR-005-likes-minimal-model.md` §No objetivos: no se lista quién dio like a un post |
| `comment` (en response de `POST`/`GET /api/posts/<id>/comments` y `PATCH /api/comments/<id>`) | `id`, `post_id`, `author` (misma forma reducida que en `post`), `content`, `created_at`, `edited`, `mentions` | `ADR-006-comments-minimal-model.md` + `ADR-021-content-editing.md` (`edited`, v0.22); coincide con `comments` en `DATABASE_ARCHITECTURE.md` §5. `edited` se deriva de `edited_at` — mismo criterio que en `post`. `updated_at` sigue sin exponerse, mismo motivo |
| `follow` — no se expone como objeto propio; solo `{"following": bool}` en `POST`/`DELETE .../follow`, y el resumen agregado (`followers_count`/`following_count` en `user`, `is_followed_by_me` en `post.author`) | — | `ADR-007-follows-minimal-model.md` §No objetivos: no se lista quién sigue a quién |
| `notification` (en response de `GET /api/notifications`) | `id`, `type` (`like`/`comment`/`follow`/`follow_request`/`follow_accepted`/`mention` — los tres últimos desde v0.23, `ADR-022`/`ADR-023`), `actor` (misma forma reducida que en `post`/`comment`), `post_id` (nullable), `read` | `ADR-008-notifications-minimal-model.md`; coincide con `notifications` en `DATABASE_ARCHITECTURE.md` §5. `read` se deriva de `read_at` (internamente un timestamp) — se expone como booleano, nunca como el timestamp crudo, mismo criterio que `username_changed_at` nunca cruza la frontera HTTP |
| `password_reset_token` (OTP) — no se expone como objeto propio; el código viaja una única vez por correo, la autorización temporal viaja una única vez en `reset_authorization` (respuesta de `verify-reset-code`) | — | `ADR-010-password-reset-otp-flow.md` §Seguridad: solo se persisten `code_hash` (scrypt) y `reset_authorization_hash` (SHA-256), ninguno de los dos valores crudos vuelve a aparecer en ningún response |
| `email_verification_token` (OTP de registro) — no se expone como objeto propio; el código viaja una única vez por correo, nunca en un response JSON | — | `ADR-011-mandatory-email-verification.md` §Seguridad (reemplaza el token de enlace de `ADR-009`): solo se persiste `code_hash` (scrypt), el valor crudo nunca cruza la frontera HTTP; estructuralmente separado de `password_reset_token` (tabla y repositorio propios) — un código nunca verifica el propósito del otro |
| `user_identity` — no se expone como objeto propio; el `credential` (ID Token) que la origina viaja una única vez, en el body de `POST /api/auth/google` (nunca en la respuesta) | — | `ADR-012-google-sign-in.md`: solo se persisten `provider`/`provider_subject` (el claim `sub`, nunca el email como identificador); ningún endpoint lista las identidades vinculadas de un usuario todavía |
| `message` (en response de `POST`/`GET /api/users/<id>/messages` y `PATCH /api/messages/<id>`) | `id`, `sender_id`, `recipient_id`, `content`, `read`, `created_at`, `edited` | `ADR-013-messages-minimal-model.md` + `ADR-021-content-editing.md` (`edited`, v0.22); coincide con `messages` en `DATABASE_ARCHITECTURE.md` §5. `read` se deriva de `read_at` y `edited` de `edited_at` (ambos timestamps internos) — ninguno de los dos cruza la frontera HTTP como timestamp, mismo criterio que `notification.read`. `messages` sigue sin `updated_at`: sus dos escrituras posibles (marcar leído, editar) ya tienen cada una su columna |
| `conversation` (en response de `GET /api/conversations`) — no es una entidad propia, es una vista derivada de `messages` agrupada por "la otra persona" | `user` (misma forma reducida que `actor`/`author`, más `last_seen_at` desde v0.23), `last_message` (`content`/`sender_id`/`created_at`), `unread_count` | `ADR-013-messages-minimal-model.md` §Opciones consideradas: sin tabla `conversations`/`conversation_participants` en esta versión. `last_message` **no** lleva `edited` (v0.22): muestra el texto vigente pero la marca solo viaja en el mensaje completo (`ADR-021` §Riesgos) |

**Perfil ampliado (v0.20, `ADR-015`):** además de los campos de la fila `user` de arriba, el objeto `user` expone `bio` (≤ 160 caracteres), `location` (≤ 60), `website` (≤ 100, URL válida), `avatar_url` y `cover_url` — los cuatro primeros `null` mientras no se definan, y las dos URL son absolutas (resueltas con `MEDIA_PUBLIC_BASE_URL`) o `null`. La forma reducida de autor (`author`, `actor`, `user` de `conversation`) incluye `avatar_url`. Las rutas que los gestionan están en §4.12.

**`terms_accepted` (v0.31, `ADR-032` §5):** booleano en el objeto `user`. `true` solo si la persona aceptó la **versión vigente** de los términos: las cuentas anteriores y las que aceptaron una versión vieja dan `false`, y el cliente les pide aceptar antes de crear contenido (§4.18).

---

## 6. Autenticación y autorización

- **Mecanismo:** JWT emitido por `flask_jwt_extended` — `identity` es el `id` (UUID, como string) de `users`, no el email (ver `BACKEND_ARCHITECTURE.md` §9). Desde v0.21 cada login entrega además un **refresh token** rotativo (§4.11, `ADR-017`): access 15 min, refresh 30 días, ambos explícitos en `config.py` y sobreescribibles por entorno.
- **Convención de envío:** header `Authorization: Bearer <token>` — verificada contra código real desde v0.3 (`GET /api/users/me`, §4.2).
- **Almacenamiento en el Frontend:** `localStorage` (`useAuth.js`) — decisión ya registrada como `PENDIENTE DE APROBACIÓN` en `FRONTEND_ARCHITECTURE.md` §16, no se repite la discusión aquí.
- **Autorización (roles/permisos):** no existe ningún concepto en el sistema — no se documenta lo que no existe.

---

## 7. Errores de red y disponibilidad (responsabilidad del Frontend)

- El Frontend hoy maneja fallos de la llamada de login con `try/catch` + `alert()` (`Login.jsx`) — sin distinguir error de red, timeout, o error de servidor. Documentado en `FRONTEND_ARCHITECTURE.md` §12, no se repite aquí como contrato porque no es parte del contrato HTTP en sí, sino de cómo el Frontend reacciona a él.
- Este documento no impone un estándar de manejo de errores en el cliente — esa es responsabilidad de `FRONTEND_ARCHITECTURE.md`.

---

## 8. Qué NO cambia con este documento

- No se ratifica un formato de error nuevo — el actual (`{"msg": "..."}`) ya se aplica de forma uniforme a toda la API desde v0.6 (§3), sin agregar campos nuevos (código machine-readable) que nadie necesita hoy.
- No se adopta OpenAPI/Swagger en esta versión.
- No se define el contrato de ningún endpoint futuro más allá de `/register` y `/login` (ya implementados) — se señala su ausencia, no se inventa su forma.

---

## 9. PENDIENTES DE APROBACIÓN

Decisiones que este documento **no toma** porque no están respaldadas por código ni por documentación oficial ratificada. Cada una debe resolverse como ADR (`HB-001` §11–12) antes de implementarse:

1. ~~Formato estándar de error para toda la API~~ — **avanzado en v0.6** (heredado de `BACKEND_ARCHITECTURE.md` §20, ítem 5): `{"msg": "..."}` ya es el formato aplicado uniformemente, incluidos los casos antes no cubiertos (`404`/`405`/`500` genéricos, §3). Sigue pendiente únicamente si el equipo quiere agregar un código de error machine-readable — no decidido, no necesario hoy.
2. ~~Contrato de `POST /api/register`~~ — **resuelto e implementado**, incluidos los campos de perfil (§4.1, `ADR-002`). ~~Longitud mínima de contraseña y validación de formato de email~~ — **resuelto en v0.7** (§4.1: `is_valid_email`/`is_valid_password`, `domain/auth/validators.py`) — la unicidad de email/username ya estaba resuelta, la impone el esquema vía `CITEXT UNIQUE`/`uq_users_username`.
3. **Convención de verbos HTTP** para operaciones futuras (colecciones, borrado). Parcialmente resuelto: `PATCH` es ya el verbo real usado para actualización parcial (`PATCH /api/users/me`, §4.2, `ADR-003`; y para editar contenido propio en `PATCH /api/posts/<id>`/`/api/comments/<id>`/`/api/messages/<id>`, v0.22, `ADR-021`) y `DELETE` sobre el recurso plano lo es para borrar una entidad propia (`DELETE /api/messages/<id>` §4.10 v0.19, `DELETE /api/posts/<id>` §4.3 v0.20, `DELETE /api/comments/<id>` §4.5 v0.21). El par **`PATCH` + ruta plana + `404` indistinguible** para "editar/borrar lo propio" ya se repite en seis endpoints, pero sigue sin estar ratificado formalmente como convención del proyecto.
4. **Versionado de API** (`/api/v1` u otro mecanismo) — o la decisión explícita de no versionar todavía.
5. **Paginación** — formato (offset/limit, cursor) para cuando exista el primer endpoint de colección (p. ej. feed).
6. ~~Convención de endpoints protegidos~~ — **resuelto: primer caso real implementado** (`GET /api/users/me`, §4.2, `ADR-002`), incluida la homogenización de errores JWT a `401` (`app/extensions.py`).
7. **Especificación formal (OpenAPI/Swagger)** y su ubicación — evaluar cuando el catálogo de endpoints crezca lo suficiente para justificar el costo de mantenerla (`HB-001` §15.1 menciona esta opción sin decidirla, igual que `BACKEND_ARCHITECTURE.md` §14).
8. ~~***Rate limiting*** de los endpoints de autenticación~~ — **RESUELTO en v0.25** (`ADR-027-rate-limiting.md`). Los diez endpoints que verifican una credencial, mandan un correo o crean una cuenta limitan intentos y devuelven `429` con `Retry-After` (§3). El caso que lo volvió urgente era `POST /api/2fa/verify` (10⁶ combinaciones en 30 s); queda en 5 intentos por 15 minutos.
   **Nota de proceso, registrada a propósito:** entre `ADR-019` y `ADR-026`, seis ADR afirmaron que este pendiente "ya estaba registrado en §9 de este documento" **cuando no lo estaba** — la afirmación se propagó de ADR en ADR sin verificarse contra el documento. v0.24 la corrigió añadiendo el ítem; v0.25 lo resuelve. Se deja escrito para que el patrón (citar un documento sin abrirlo) quede visible.
   **Sigue pendiente**, como ADR propio: (a) los endpoints de **producto** (feed, posts, comentarios, mensajes, likes) no tienen límite — ahí el riesgo es abuso/DoS, no adivinar una credencial, y una escritura en base por petición del feed sería un coste desproporcionado; (b) un *rate limit* en la capa anterior (proxy/WAF/CDN) y confiar en `X-Forwarded-For` solo cuando lo inyecta un proxy conocido — las dos cosas son DevOps, sin documentación oficial (`CLAUDE.md` §15).

---

## 10. Evolución de este documento

Cada endpoint nuevo se documenta aquí **el mismo día de su PR** (`HB-001` §15.1, regla ya vigente, sin excepción). Este documento crece por adición de secciones en §4, sin reestructurarse — mismo principio de escalabilidad por adición que `REPOSITORY_STRUCTURE.md` §2 y `DATABASE_ARCHITECTURE.md` §3 ya aplican en sus respectivos dominios.

Si el catálogo de endpoints crece lo suficiente para que un Markdown plano deje de ser manejable, migrar a OpenAPI/Swagger es una decisión de impacto medio (§9, ítem 7) — no una consecuencia automática de este documento.

---

## Fuentes consultadas

- `CLAUDE.md` (raíz) — índice de reglas operativas y jerarquía de fuentes.
- `docs/architecture/BACKEND_ARCHITECTURE.md` — fuente directa del estado real del único endpoint implementado (§5, §6, §9, §11, §14).
- `docs/architecture/DATABASE_ARCHITECTURE.md` — modelo de datos disponible para exponer (§4.A, §5).
- `docs/architecture/FRONTEND_ARCHITECTURE.md` — consumidor del contrato (§9, §10, §12, §16).
- `docs/architecture/organization/01_Manual_Organizacion/Source/HB-001-manual-organizacion.md.md` — §15.1 (documentar endpoints el mismo día del PR), §11–12 (proceso de ADR).
- `docs/architecture/ADR-002-user-profile-fields.md` — decisión que ratifica `username`/`phone`/`country_code`/`birth_date` en `users` y `GET /api/users/me`.
- `docs/architecture/ADR-003-profile-update-contract.md` — decisión que ratifica el contrato de `PATCH /api/users/me` (§4.2): campos editables, unicidad, cooldown de `username`, semántica PATCH, errores.
- Código fuente: `backend/app/interfaces/routes/auth_routes.py`, `backend/app/interfaces/routes/user_routes.py`, `backend/app/application/auth/*.py`, `backend/app/domain/auth/*.py`, `backend/app/extensions.py`, `backend/app/__init__.py`; `Frontend/src/features/auth/pages/Register.jsx`, `Frontend/src/features/auth/lib/validators.js`.

---

## Cierre

Este documento **no modifica** el backend ni el Frontend: define el contrato de API que ambos deben respetar hacia adelante, separando explícitamente **lo implementado** (§4.1), **lo esperado pero ausente** (§4.2) y **lo pendiente de aprobación** (§9). Cualquier cambio a este contrato sigue el proceso de decisiones de impacto medio/alto de `HB-001` §11–12 (ADR), no el criterio individual de quien implementa. A partir de su ratificación, Backend y Frontend deben implementar contra este documento — no negociar el contrato de forma ad-hoc en cada feature.

---

## 4.19 Eliminación de cuenta (`ADR-031-account-deletion.md`) — v0.33

Dos pasos, **públicos** (sin JWT): la identidad la aporta el control del correo y, si la cuenta tiene 2FA, el segundo factor.

#### `POST /api/account-deletion/request`

Body `{ "email": "..." }`. Responde **siempre `200`** con el mismo mensaje, exista o no la cuenta (sin enumeración de correos). Si existe, envía un código de 6 dígitos (scrypt, vigencia 10 min, 5 intentos, enfriamiento de 60 s, un solo código activo por cuenta). Límite por IP (`ACCOUNT_DELETION_REQUEST`: 5 / 15 min). `400` si el correo falta o no es válido; `429` con `Retry-After`.

#### `POST /api/account-deletion/confirm`

Body `{ "email", "code", "confirm_email", "confirmation": "DELETE", "two_factor_code"? }`. `confirm_email` debe coincidir con el de la cuenta (sin distinguir mayúsculas) y `confirmation` ser **exactamente** `DELETE`.

| Código | Causa |
|---|---|
| `200` | Cuenta eliminada (`{"msg": "Tu cuenta fue eliminada."}`) |
| `400` | Cuenta inexistente, sin solicitud, código vencido, intentos agotados o incorrecto (**un solo mensaje** para todos los casos) |
| `400` + `confirmation_error: true` | Correo o palabra mal escritos. **Solo con el código ya verificado**; no consume el código |
| `400` | Segundo factor inválido (no `401`: un cliente con sesión intentaría renovarla) |
| `403` + `two_factor_required: true` | La cuenta tiene 2FA y falta `two_factor_code`. Solo con el código verificado; no lo consume |
| `429` | `ACCOUNT_DELETION_CONFIRM`: 5 fallos / 15 min por cuenta y por IP |

**Qué se elimina** (una transacción): la fila de `users` y, por `ON DELETE CASCADE`, publicaciones, comentarios, me gusta, seguidos, notificaciones, **mensajes enviados y recibidos (las dos bandejas)**, tokens, sesiones, identidades de Google, menciones, filtros, exportaciones y códigos. Después se borran del almacenamiento el avatar y la portada. Los access y refresh tokens dejan de valer **de inmediato**. Quien hablaba con esa cuenta recibe `404 "Usuario no encontrado"` al pedir ese hilo. **Quedan fuera** y deben declararse en la política de privacidad: las copias de seguridad del proveedor y los registros del servidor. Se envía un correo de confirmación sin guardar copia.

**Reportes:** `reports.reporter_id`, `reported_user_id` y `resolved_by` son `ON DELETE SET NULL` (`ADR-032`): un reporte sobrevive a la eliminación de las cuentas involucradas.

---

## 4.20 Compuerta de perfil completo (`ADR-034-minimum-age-18.md`)

`POST /api/posts`, `POST /api/posts/<id>/comments`, `POST /api/posts/<id>/like`, `POST /api/users/<id>/follow` y `POST /api/users/<id>/messages` responden `403` con `{"msg": "...", "profile_incomplete": true}` si la cuenta tiene `profile_completed=false` (una cuenta nueva de Google aún sin fecha de nacimiento). Leer no se bloquea. `POST /api/register` y `PATCH /api/users/me` rechazan con `400` y `min_age: 18` una fecha de nacimiento que no cumpla la edad mínima.

---

## 4.21 Fallos del proveedor de correo (`ADR-036-email-provider-failures.md`, aceptado con cambios)

**Cambio propuesto sobre `ADR-011`; no se fusiona sin aprobación del equipo.** Si el proveedor de correo falla:

- `POST /api/register` responde `201` con `"email_sent": false` (campo aditivo; `true` si el correo salió). La cuenta existe y se pide otro código con `POST /api/resend-registration-code`. Antes respondía `500` después de crear la cuenta.
- `POST /api/forgot-password` y `POST /api/resend-registration-code` responden **siempre** el mismo `200` genérico, exista o no la cuenta (antes, un `500` solo para las cuentas existentes revelaba qué correos están registrados).
- `POST /api/reset-password` responde `200` aunque falle solo el aviso de «contraseña cambiada» posterior (la contraseña ya cambió).

El fallo se registra con el tipo de correo, la clase del error y el código del proveedor; **nunca** el código de 6 dígitos, el destinatario ni el mensaje del proveedor.

---

## 4.22 Moderación de la plataforma (`ADR-032-content-reports-and-moderation.md`, fase 2) — v0.35

Rutas **solo para moderadores** (`users.is_moderator`, que se concede **únicamente por línea de comandos**, nunca por la API). Quien no lo es recibe `404 {"msg": "Recurso no encontrado"}`, idéntico al de una URL inexistente; sin token, `401`. El rol se vuelve a comprobar contra la base en cada petición y una cuenta moderadora suspendida pierde el acceso. No confundir con los filtros personales (`/api/users/me/muted-*`, `ADR-024`).

#### `GET /api/moderation/reports`

Query opcional: `status` (`open` por defecto, `reviewing`, `actioned`, `dismissed`), `limit` (1–100, por defecto 50) y `offset` (≥ 0). Orden: **lo crítico primero** (`ADR-038`) y, dentro de cada prioridad, del más antiguo al más nuevo. `400` si algún valor no es válido.

```json
{
  "reports": [
    {
      "id": "uuid",
      "target_type": "post | comment | message | user",
      "target_id": "uuid",
      "reason": "string",
      "priority": "normal | critical",
      "status": "open",
      "details": "string | null",
      "content_snapshot": "string | null",
      "reports_on_target": 2,
      "reported_user": { "id": "uuid", "username": "string", "name": "string", "suspended": false, "is_moderator": false },
      "created_at": "ISO 8601",
      "resolved_at": "ISO 8601 | null",
      "resolution_note": "string | null"
    }
  ],
  "has_more": false
}
```

**Nunca** incluye quién reportó (`reporter_id`) ni el correo de la cuenta reportada. `content_snapshot` es la copia del texto reportado y **solo existe mientras el reporte está abierto** (`ADR-032` §4). `reported_user` es `null` si la cuenta ya no existe. `reports_on_target` cuenta los reportes sobre el mismo objetivo.

#### `POST /api/moderation/reports/<id>/resolve`

Body `{ "action": "dismiss | remove_content | suspend_user", "note"?: "string (≤ 500)", "reason"?: "string (≤ 500)" }`. `note` es **interna** (queda en `resolution_note`). `reason` solo vale con `suspend_user` y es lo que **ve la persona suspendida**; sin él se usa un texto estándar. La nota interna nunca se le muestra. `moderator_id` sale del JWT; cualquier otro campo del cuerpo se ignora.

| Acción | Efecto |
|---|---|
| `dismiss` | Cierra el reporte como `dismissed`. No toca el contenido |
| `remove_content` | Borra el post, comentario o mensaje con las rutas de borrado existentes, cierra el reporte como `actioned` y cierra también los **demás reportes abiertos sobre el mismo objetivo**. Sobre un reporte de **cuenta** responde `400` |
| `suspend_user` | Fija `suspended_at` y el motivo, **revoca todas las sesiones y los refresh tokens de inmediato** y cierra el reporte como `actioned`. Idempotente: si ya estaba suspendida se conserva la suspensión original. No se puede suspender a una cuenta moderadora desde el panel (`400`) ni a una cuenta que ya no existe (`400`) |

Toda resolución deja `resolved_by`, `resolved_at` y `resolution_note`, y **vacía `content_snapshot`**.

| Código | Causa |
|---|---|
| `200` | `{"report": {"id", "status", "action"}}` |
| `400` | Acción, nota o motivo no válidos; acción no aplicable al tipo de reporte |
| `403` | Quien modera es la cuenta reportada (no puede resolver un reporte sobre sí misma) |
| `404` | Reporte inexistente o `id` mal formado |
| `409` | El reporte ya estaba resuelto |

#### Cuenta suspendida

`POST /api/login`, `POST /api/auth/google` y `POST /api/2fa/verify` responden **`403`** una vez probada la identidad:

```json
{ "msg": "Tu cuenta está suspendida.", "suspended": true, "suspension_reason": "string" }
```

Con una contraseña incorrecta sigue siendo `401`: la suspensión no sirve para averiguar qué cuentas lo están sin conocer sus credenciales. Los tokens ya emitidos dejan de valer al instante. El objeto `user` propio incluye además `is_moderator` (boolean), solo para que el cliente decida si muestra la entrada a la página de moderación; no concede nada.

#### Línea de comandos (no es API)

`flask set-moderator <correo> [--revoke]` concede o retira el rol (avisa si la cuenta no tiene 2FA) y `flask unsuspend-user <correo>` levanta una suspensión.

## 4.23 THERS Places — catálogo de lugares (`ADR-040-thers-places.md`, fase 1)

Lectura **pública**: no exige `Authorization` (ADR-040 D4). Todas las rutas comparten el límite de uso `places_read`
(120 peticiones por minuto y por IP, `ADR-027`); al superarlo responden `429` con `Retry-After`. Solo se devuelven lugares
`is_active` con `verification_status = "verified"`, de una categoría activa. Los errores usan `{"msg": "..."}`.

No se exponen `rating`, `reviews_count` ni `is_open`: no existen reseñas ni horarios todavía. `is_saved` existe desde la v0.37.
`cover_image_url` es siempre `null` hasta que haya fotos de lugares.

### `GET /api/places/categories`

`200` → `{"categories": [{"id": "uuid", "slug": "cafes", "name": "Cafés"}, ...]}`, ordenadas por `sort_order`.
Iniciales: `restaurantes`, `cafes`, `supermercados`, `farmacias`, `gasolineras`, `hospitales`, `universidades`,
`centros-comerciales`, `parques`, `entretenimiento`, `hoteles`, `otros`.

### `GET /api/places`

| Query | Obligatorio | Regla |
|---|---|---|
| `category` | no | `slug` de una categoría existente |
| `limit` | no | entero 1–50 (predeterminado 20) |
| `offset` | no | entero 0–10000 (predeterminado 0) |

`200` → `{"places": [<resumen>]}`, ordenado por nombre e id. **Sin `distance_meters`**: no hay punto de origen.
`400` → `{"msg": "limit no puede superar 50"}` (o `offset`, o `"Categoría inválida"`).

### `GET /api/places/nearby`

| Query | Obligatorio | Regla |
|---|---|---|
| `lat` | sí | número finito entre -90 y 90 |
| `lng` | sí | número finito entre -180 y 180 |
| `radius` | no | metros, mayor que 0 y hasta 50000 (predeterminado 5000) |
| `category` | no | `slug` de una categoría existente |
| `limit` | no | entero 1–50 (predeterminado 20) |

`200` → `{"places": [<resumen con distance_meters>]}`, del más cercano al más lejano. `distance_meters` es un entero.
`400` → `{"msg": "lat debe estar entre -90 y 90"}` y equivalentes (`lat es obligatorio`, `radius no puede superar 50000`, ...).

**Privacidad:** la ubicación consultada **no se guarda**. Pero `lat`/`lng` viajan en la URL y pueden quedar en los registros
de acceso del proxy o de una herramienta de errores (`ADR-040` §4.4, R5): el cliente debe redondear a ~3 decimales (~110 m)
antes de enviarlas.

### `GET /api/places/<id>`

`200` → `{"place": <detalle>}`. `404` → `{"msg": "Lugar no encontrado"}`, **idéntico** si el id no existe, el lugar no es
público o está inactivo (no revela que existe). Un `<id>` que no es UUID también da `404`.

### Objetos

Resumen (lista y `nearby`):

```json
{
  "id": "291dc513-e8b5-4a7b-bf9d-8b9a85fc3389",
  "name": "Café Aurora",
  "slug": "seed-cafe-aurora",
  "category": {"id": "…", "slug": "cafes", "name": "Cafés"},
  "latitude": 13.69745,
  "longitude": -89.2182,
  "verification_status": "verified",
  "address": "Colonia Escalón, San Salvador",
  "cover_image_url": null,
  "is_saved": false,
  "distance_meters": 500
}
```

Detalle: el resumen más `description`, `municipality`, `department`, `phone`, `website`, `source`
(`thers_field | business | community | osm | official`), `coordinate_source`
(`gps | map_selected | geocoded | imported`) y `last_verified_at` (ISO 8601 o `null`). Nunca incluye `is_active`, la
geometría cruda ni los ids de quien creó o verificó el lugar.

## 4.24 THERS Places — búsqueda, guardados, reportes y moderación (`ADR-040`, fase 2)

### Búsqueda y `is_saved` (públicas)

`GET /api/places/search?q=&category=&lat=&lng=&limit=` — texto en el **nombre**, sin importar mayúsculas ni tildes
(`nandu` encuentra «Ñandú»; `%` y `_` se tratan como texto, no como comodines). `q` obligatorio, 2–80 caracteres.
`lat`/`lng` opcionales pero **juntos**; con ellos cada resultado lleva `distance_meters`. Orden: parecido del texto, luego
cercanía. Mismas reglas de `category` y `limit` que `nearby`. `400` con `{"msg": ...}`.

Con `Authorization: Bearer <token>`, `GET /api/places`, `/nearby`, `/search` y `/<id>` marcan `is_saved: true` en los lugares que
la persona guardó. Sin token, o con uno inválido o vencido, la respuesta es la misma pero con `is_saved: false` (nunca `401`).

### Con sesión (`401` sin token válido; límites por cuenta, `ADR-027`)

| Ruta | Descripción |
|---|---|
| `GET /api/places/saved?limit=&offset=` | Tus guardados que siguen siendo públicos, el más reciente primero. `{"places": [...]}` con `is_saved: true` |
| `POST /api/places/<id>/save` | `200 {"saved": true}`. **Idempotente**: guardar dos veces no duplica. `404` si el lugar no existe o no es público. Límite 60/min |
| `DELETE /api/places/<id>/save` | `200 {"saved": false}`. **Idempotente**. Funciona aunque el lugar ya no sea público; `404` solo si no existe |
| `POST /api/places/<id>/report` | Cuerpo `{"reason": "...", "details": "..."}`. `201 {"report": {id, place_id, reason, status, created_at}}`; `200` con el mismo reporte si ya tenías uno **abierto** igual. `400` si el motivo es inválido o `other` sin `details`; `404` si el lugar no es público. Límite 10/hora |

Motivos (`reason`): `wrong_location`, `wrong_hours`, `wrong_phone`, `closed`, `duplicate`, `wrong_name`, `inappropriate`, `other`.
`details`: hasta 500 caracteres. `reporter_id` y `status` del cuerpo se ignoran: la identidad sale solo del token.

### Moderación (`/api/moderation/places/*`; solo `is_moderator`, el resto recibe `404`)

| Ruta | Descripción |
|---|---|
| `GET /summary` | `{"summary": {"places_by_status": {...}, "places_inactive": n, "open_reports": n}}` |
| `GET /reports?status=open&limit=&offset=` | Cola (los más antiguos primero). `status`: `open` (predeterminado), `reviewing`, `resolved`, `dismissed`. `{"reports": [...], "has_more": bool}`. **No muestra quién reportó** |
| `POST /reports/<id>/resolve` | `{"status": "resolved" \| "dismissed", "note": "..."}`. `404` si no existe; `409` si ya estaba cerrado |
| `GET /?status=&q=&limit=&offset=` | Todos los lugares, en cualquier estado |
| `POST /` | Crea un lugar. Obligatorios: `name`, `category` (slug), `latitude`, `longitude`. Opcionales: `description`, `address`, `municipality`, `department`, `phone`, `website` (http/https), `source` (predeterminado `thers_field`), `coordinate_source` (predeterminado `map_selected`). Nace `pending` y **no público**. `201 {"place": ...}` |
| `GET /<id>` | Detalle de moderación (con `is_active`, ids de quien creó y verificó, fechas) |
| `PATCH /<id>` | Edición parcial de los campos anteriores; si cambian las coordenadas deben venir `latitude` y `longitude` juntas. **No cambia el estado** |
| `PATCH /<id>/status` | `{"verification_status": "...", "is_active": bool}` (al menos uno). Al pasar a `verified` registra quién y cuándo |

Validación en el servidor: longitudes máximas, sin caracteres de control, `phone` con formato telefónico, `website` solo `http(s)://`,
coordenadas en rango. **PostGIS corrige en silencio las coordenadas fuera de rango**, por eso toda escritura las valida antes.
Cada creación, edición, cambio de estado y resolución de reporte queda en `admin_audit_log` (en la misma transacción), sin secretos.
