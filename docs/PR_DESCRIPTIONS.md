# Textos de los Pull Requests — 2026-10-02

> Archivo de trabajo, no es documentación oficial. Las cifras (292 y 319 pruebas, versiones del contrato)
> valen para el estado del 2026-10-02: reverificarlas si las ramas cambian.
>
> **Orden de merge:** 1 → 2 → 3 → 6. Los PR 4 y 5 son independientes y van contra `develop`.
> **Bases apiladas:** cada PR se abre contra la rama anterior para que su diff sea solo el suyo. Al mergear
> el anterior (y borrar su rama), GitHub reajusta el siguiente a `develop`.
> **Revisión:** `HB-001` exige 1 aprobación de otra persona; el autor no se autoaprueba.
> **Issue:** `HB-001` pide vincular un Issue (`Closes #N`). Completar o borrar `Closes #…`.

---

## PR 1 · `feature/profile-media` → base `develop`

**Título:** `feat: add profile bio and image uploads (ADR-015)`

```md
## Qué hace
Añade bio, ubicación, sitio web, avatar y portada al perfil de usuario (`ADR-015`).

**Backend**
- Migración `a5c8e2d71f34`: 5 columnas nuevas en `users`, todas nulas. `avatar_path`/`cover_path` guardan la clave del objeto, no una URL.
- `POST`/`DELETE /api/users/me/avatar` y `/cover` (multipart, JPEG/PNG/WebP hasta 5 MB, recodificado a WebP, se descartan los metadatos EXIF). `PATCH /api/users/me` acepta `bio`, `location` y `website`.
- Almacenamiento intercambiable: `STORAGE_BACKEND=local` (`GET /api/media/<ruta>`) o `s3` (Supabase Storage, Cloudflare R2 o S3).
- `avatar_url` aparece en el autor de posts, comentarios, mensajes y notificaciones.
- Dependencias nuevas: `Pillow`, `boto3`.

**Frontend:** página de perfil, modal de edición con subida de imágenes y avatar en toda la interfaz. Se eliminan `ProfileHeader` y `ProfileTopBar`.

**Docs:** `ADR-015`. `API_CONTRACT` v0.20 documenta de forma **retroactiva** estas rutas y campos, que estaban implementados sin figurar en el contrato (`HB-001` §15.1). `DATABASE_ARCHITECTURE` lista las columnas nuevas.

## Cómo se verificó
- Backend: 292 pruebas pasan, aisladas en esta rama.
- CI de GitHub (`THERS CI`) en verde.

## Para el revisor
- Procesamiento de imágenes: límite de 5 MB y de 40 millones de píxeles; ruta `GET /api/media` (`send_from_directory`).
- `STORAGE_BACKEND=local` es solo para desarrollo: en un host con disco efímero hay que usar `s3`.
- Variables nuevas, ya documentadas en `backend/.env.example`.

## Checklist
- [ ] Sin `.env` ni credenciales · [ ] Sin `console.log`/`print` olvidados · [ ] Contrato actualizado

Closes #…
```

---

## PR 2 · `feature/refresh-tokens` → base `feature/profile-media`

**Título:** `feat(backend): add rotating refresh tokens (ADR-017)`

```md
## Qué hace
Implementa `ADR-017`: access token de 15 min + refresh token de 30 días, rotativo, con revocación.

- Tabla `refresh_tokens` (migración `b7d41e9a3c52`). Se guarda el SHA-256 del `jti`, nunca el token. Un índice único parcial garantiza un solo token activo por familia.
- `POST /api/refresh` y `POST /api/logout`, autenticados con el refresh token. La rotación es atómica (`SELECT … FOR UPDATE`). **Reusar un token ya consumido revoca toda la familia.**
- `login` y `auth/google` devuelven además `refresh_token` (cambio aditivo). `POST /api/reset-password` revoca todas las sesiones del usuario.
- Vidas explícitas en `config.py` y sobreescribibles por entorno.
- `Cache-Control: no-store` en respuestas a peticiones autenticadas (la caché de React Native guardaba el JSON de `/users/me`).
- Docs: `API_CONTRACT` v0.21, `DATABASE_ARCHITECTURE` v0.18, `DATABASE_ERD` v0.14, `BACKEND_ARCHITECTURE` §20 ítem 9.

## Cómo se verificó
- 27 pruebas nuevas, incluida una carrera real de dos hilos contra PostgreSQL. Suite completa: **319 pasan**, aisladas en esta rama.
- CI de GitHub en verde.
- Probado en un teléfono real junto con el PR del móvil (renovación, logout y arranque sin red).

## Para el revisor
- `rotate()` en `refresh_token_repository.py` (transacción y bloqueo) y el `401` homogéneo en `extensions.py`.
- **Riesgo aceptado:** si la respuesta de refresh se pierde por la red, el cliente reintenta con un token ya consumido y se corta la sesión (`ADR-017` §7).
- Un access token ya emitido sigue valiendo hasta 15 min tras el logout.
- No hay limpieza de filas expiradas (anotado en `DATABASE_ARCHITECTURE`).

## Despliegue
Ejecutar `flask db upgrade`. En producción, `JWT_ACCESS_TOKEN_EXPIRES_SECONDS` debe estar vacía.

## Depende de
`feature/profile-media`: la migración encadena con `a5c8e2d71f34`. No se puede mergear antes.

Closes #…
```

---

## PR 3 · `feature/mobile-android-app` → base `feature/refresh-tokens`

**Título:** `feat(mobile): add Android app with session refresh (ADR-016, ADR-017)`

```md
## Qué hace
Añade la cuarta app del monorepo: React Native + Expo SDK 57 + TypeScript (`ADR-016`), con login, perfil propio y logout contra la API real.

**Sesión (`ADR-017`):** access y refresh en SecureStore; el usuario nunca se guarda en disco. Una sola renovación en vuelo; ante un `401` renueva y reintenta una vez. Un fallo de red o un `5xx` nunca cierra la sesión. Un arranque sin red muestra «Sin conexión» con Reintentar. El logout revoca la sesión en el servidor.

**Docs:** `docs/mobile/` (entorno, validación, preparación, hoja de ruta), `ADR-016` y la sección de `mobile/` en `REPOSITORY_STRUCTURE`.

## Cómo se verificó
- `tsc --noEmit` sin errores y `expo-doctor` 21/21. CI de GitHub en verde.
- **En un teléfono real (moto z3)**, con evidencia del servidor: build nativa, instalación, login, SecureStore, persistencia, logout, fallo de red, `401`, caso `403` de correo sin verificar, renovación automática, logout contra el servidor y arranque en frío sin red. Detalle en `docs/mobile/VALIDATION.md` §1.3.
- Se corrigió un bug hallado en esa prueba: `/users/me` devuelve `{"user": …}` y la app guardaba el envoltorio.

## No incluido / sin probar
- **No probado en el Samsung A16 5G**; solo en el moto z3.
- No hay build de release ni AAB. Fuera de alcance: registro, recuperación, Google, feed, mensajes y llamadas.

## Notas
- `mobile/.env` está ignorado; solo se versiona `.env.example`. `EXPO_PUBLIC_API_URL` queda embebida en el bundle: nunca poner secretos.
- `mobile/android/` se genera y está ignorado. En Windows la build necesita una ruta corta (`ANDROID_SETUP.md` §9).
- Expo reescribe el `include` de `tsconfig.json` al arrancar.

## Para el revisor
`src/shared/lib/api.ts` (renovación única en vuelo) y `session.ts`.

## Depende de
`feature/refresh-tokens` (`/api/refresh` y `/api/logout`).

Closes #…
```

---

## PR 4 · `docs/hosting-and-launch-plan` → base `develop`

**Título:** `docs: propose hosting ADR-018 and add launch checklist`

```md
## Qué hace
Solo documentación.
- `ADR-018` (**estado: PROPUESTO**): propuesta de hosting, dominio y entornos, con precios verificados el 2026-10-02 y las condiciones técnicas de las que depende (pooler de Supabase con `psycopg` 3, disco efímero, memoria, CORS, secretos).
- `docs/LAUNCH_CHECKLIST.md`: qué falta para publicar en la web, en Google Play y para SEO.

## Hallazgos que conviene decidir
- **No existe borrado de cuenta ni reportar/bloquear** en el backend. Google Play los exige a una app social. Hace falta un ADR propio.
- El correo con Resend solo llega al dueño de su cuenta hasta verificar un dominio.

## Qué pedimos al equipo
Revisión de **los cuatro** y una decisión explícita sobre `ADR-018` (`HB-001` §11–12). Los precios cambian: reverificar al contratar.

Closes #…
```

---

## PR 5 · `chore/frontend-react-hooks-lint` → base `develop`

**Título:** `chore(frontend): register the react-hooks lint plugin`

```md
## Qué hace
El código ya traía comentarios `eslint-disable` de reglas de `react-hooks`, pero el plugin no estaba registrado, así que eslint fallaba con «Definition for rule not found» en vez de evaluar la regla.

Registra `eslint-plugin-react-hooks` (`^7.1.1`): `rules-of-hooks` como error y `exhaustive-deps` como aviso.

## Cómo se verificó
`npm run lint` termina con **0 errores** y 3 avisos de `exhaustive-deps` que antes estaban ocultos: `AppShell.jsx`, `GoogleSignInButton.jsx` y `AuthContext.jsx`. No se corrigieron: cambiar dependencias de un `useEffect` altera cuándo se ejecuta. El build sigue funcionando.

## Alcance
Sin cambios de comportamiento: `eslint.config.js`, `package.json` y `package-lock.json`.

Closes #…
```

---

## PR 6 · `docs/claude-md-and-android-prompt` → base `feature/mobile-android-app`

**Título:** `docs: update CLAUDE.md and add the Android master prompt`

```md
## Qué hace
Solo documentación.
- `CLAUDE.md`: la app `mobile/` (§3.2b), los refresh tokens (`ADR-017`) ya implementados y verificados en un teléfono real, el `ADR-018` propuesto y el checklist de publicación, y las cifras vigentes (34 rutas, 319 pruebas, `API_CONTRACT` v0.21, `head` de migraciones `b7d41e9a3c52`).
- `THERS_PROMPT_CLAUDE_ANDROID.md`: la especificación de Android que citan el código y los docs de `mobile/`.

## Nota
Describe el estado de las ramas anteriores. Mergear después de ellas.

Closes #…
```

---
---

# Segunda tanda — 2026-10-02 (tras el PR #62 de Diego)

> Los cinco son independientes entre sí y van contra `develop`. Cada uno necesita 1 aprobación de otra
> persona. Completar o borrar `Closes #…`.

---

## PR 7 · `feature/mobile-two-factor-login` → base `develop`

**Título:** `feat(mobile): support the second factor at login (ADR-026)`

```md
## Qué hace
Con 2FA activada, `POST /api/login` responde `200` con `two_factor_required` y **sin token**. La app esperaba un token en todo `200`, así que una cuenta con 2FA no podía iniciar sesión desde el teléfono.

- Tipos: `LoginResponse` es una sesión o un `TwoFactorChallenge`, con guarda de tipo.
- `AuthContext`: `login` devuelve `authenticated` o `two_factor`; un desafío **no guarda nada en SecureStore** y el token queda **solo en memoria** dentro del contexto (nunca en parámetros de ruta ni en disco, igual que la web). Nuevos `verifyTwoFactor` y `cancelTwoFactor`.
- Pantalla nueva `/two-factor`: un campo para el TOTP de 6 dígitos o un código de recuperación (se envía tal cual: el servidor normaliza). Muestra el tiempo de espera ante `429` (`ADR-027`) y avisa si se usó un código de recuperación y cuántos quedan.
- **Fuera de alcance:** configurar o desactivar la 2FA, regenerar códigos y ver sesiones activas siguen siendo solo de la web.

## Cómo se verificó
`tsc` sin errores y `expo-doctor` 21/21. **En un teléfono real**, con una cuenta de prueba dedicada: pantalla de dos pasos con SecureStore vacío, código incorrecto, TOTP correcto, código de recuperación (10 → 9 en la BD), logout que revoca la fila de `sessions`, y `429` tras 5 códigos incorrectos. Detalle en `docs/mobile/VALIDATION.md` §1.3.

## Para el revisor
- `AuthContext.tsx`: que el token de desafío no salga del contexto.
- **Efecto al desplegar `ADR-025`:** toda sesión anterior se invalida una vez; la app lo gestiona limpiando la sesión y mostrando el login (verificado).

Closes #…
```

## PR 8 · `docs/sync-claude-md-and-contract` → base `develop`

**Título:** `docs: sync CLAUDE.md with develop after PR #62 and fix the 2FA verify contract`

```md
## Qué hace
Solo documentación.
- `CLAUDE.md` describía el repositorio antes del PR #62. Se actualizan las cifras, todas re-medidas el 2026-10-02: 71 reglas en `app.url_map` (70 combinaciones método+ruta, todas documentadas), 592 pruebas, contrato v0.30, `DATABASE_ARCHITECTURE` 0.22, `head` de migraciones `f8c2d6a4b190`, y las entidades que trajo el PR #62.
- `API_CONTRACT` v0.30: `POST /api/2fa/verify` ya devolvía `refresh_token` pero el contrato no lo listaba; un cliente que implemente el segundo factor no sabría que debe guardarlo. Sin cambio de código.

Closes #…
```

## PR 9 · `fix/frontend-remove-retired-verification-call` → base `develop`

**Título:** `fix(frontend): remove the call to the retired send-verification-email route`

```md
## Qué hace
La fila «Verificar correo» de Configuración llamaba a `POST /api/send-verification-email`, ruta que `ADR-011` retiró. El botón solo podía dar `404`, y solo se mostraba con el correo sin verificar, algo que una sesión abierta ya no tiene.

La fila sigue mostrando el estado real de `email_verified`, pero ya no ofrece una acción que apunta a una ruta inexistente. Se elimina el import `getStoredToken`, que quedó sin uso.

## Cómo se verificó
`npm run lint`: 0 errores y los mismos 3 avisos de antes. `npm run build` correcto. Un barrido de todas las llamadas de la web contra las rutas del servidor ya no encuentra ninguna sin ruta.

## Nota
Residuo anterior al PR #62 (el shell de Configuración del 2026-09-18), hallado al cruzar las llamadas de la web con el servidor.

Closes #…
```

## PR 10 · `docs/adr-031-account-deletion` → base `develop`

**Título:** `docs: propose ADR-031 account deletion`

```md
## Qué hace
Solo documentación: una **propuesta** (`ADR-031`, estado PROPUESTO). No cambia código.

Google Play exige a toda app con registro de cuentas una vía **dentro de la app** y un **recurso web** para eliminar la cuenta y sus datos. Hoy no existe ninguna ruta.

**Verificado en `develop`:** las 22 claves foráneas a `users` son `ON DELETE CASCADE` (la base ya arrastra los datos dependientes), pero el **avatar y la portada** del almacenamiento de objetos no se borran solos, `rate_limit_buckets` no tiene clave foránea, y los mensajes se borrarían **en los dos lados**.

**Propuesta:** flujo público en dos pasos (código de 6 dígitos al correo + el segundo factor si hay 2FA), borrado inmediato y definitivo en una transacción, página pública `/eliminar-cuenta` para Play Console, botón en la app móvil que la abre, y una prueba que **falla si una tabla nueva referencia a `users` sin `CASCADE`**.

## Qué pedimos al equipo
Revisión y una decisión sobre cinco puntos abiertos, cada uno con recomendación: borrado inmediato o con período de gracia, qué pasa con los mensajes enviados (**consultar a asesoría legal**), reservar el `@usuario`, declarar las copias de seguridad en la política de privacidad, y si se retiene algo por normativa.

Closes #…
```

## PR 11 · `docs/adr-032-content-reports` → base `develop`

**Título:** `docs: propose ADR-032 content reports and moderation, update launch checklist`

```md
## Qué hace
Solo documentación: una **propuesta** (`ADR-032`, estado PROPUESTO). No cambia código.

Play exige a las apps con contenido de usuarios poder **reportar y bloquear** usuarios y contenido, **aceptar los términos antes de crear contenido** y **actuar a tiempo** sobre lo reportado. Bloquear ya existe (`ADR-029`); reportar, moderar y registrar la aceptación no.

**Verificado en `develop`:** no hay ruta ni tabla de reportes, no existe ningún rol de moderador, y `Register.jsx` enlaza a `/terms` pero **el backend no guarda la aceptación**.

**Propuesta:** tabla `reports`, `POST /api/reports` limitado a lo que quien reporta puede ver, una bandera mínima `is_moderator` asignable solo por línea de comandos, rutas de moderación ocultas a quien no es moderador, copia del texto solo mientras el reporte está abierto, y `terms_accepted_at`/`terms_version`. **Sin ocultar contenido automáticamente** por volumen de reportes (se usa para hostigar).

`docs/LAUNCH_CHECKLIST.md`: el bloqueo está hecho; las filas de borrado, reportes y moderación apuntan a `ADR-031` y `ADR-032`.

## Qué pedimos al equipo
**Quién modera y con qué plazo.** Sin alguien que atienda la cola, el requisito de Play no se cumple aunque el código exista. También los términos con la definición de contenido censurable y el procedimiento para contenido ilegal grave, **ambos con asesoría legal**.

Closes #…
```

## PR 12 · `feature/frontend-seo-foundation` → base `develop`

**Título:** `feat(frontend): SEO foundation (robots, sitemap, per-route meta, 404)`

```md
## Qué hace
Deja la web lista para buscadores **antes** de publicarla, sin dependencias nuevas. Detalle y decisiones abiertas en `ADR-033` (PROPUESTO).

- **Tabla única de rutas indexables** (`src/shared/seo/seoRoutes.js`), `noindex` por defecto: solo `/`, `/information`, `/help`, las 8 categorías y los 19 artículos `available`. Las páginas "estamos construyendo" y toda la app tras el login quedan fuera.
- **`RouteSeo`**: `title`, `description`, `robots` y `canonical` por ruta. El canonical **no** es estático en `index.html` (compartiría la home con todas las rutas).
- **Ruta `*`** con `noindex`.
- **Plugin de Vite propio** (`vite-seo-files.js`) que genera `robots.txt` y `sitemap.xml`. Sin `VITE_SITE_URL` bloquea todo y no genera sitemap, así que staging/previews no se indexan por accidente.
- `index.html`: `lang="es"` (era `en`), `description`, `theme-color`, Open Graph base.

## Cómo se verificó
- `npm run lint`: 0 errores (3 advertencias previas).
- Build sin `VITE_SITE_URL`: `Disallow: /`, sin sitemap.
- Build con `VITE_SITE_URL=https://thers.example/`: `sitemap.xml` válido con 30 URLs (ninguna `in-progress`) y `robots.txt` con `Sitemap:`.
- Resolución de rutas probada con Node (`/help/` = `/help`; `/terms`, `/feed` e inventadas → noindex).

## Qué pedimos al equipo
- Ratificar `ADR-033`; en especial **prerender** (§4): sin él, el SEO real queda limitado porque las etiquetas se ponen en el navegador.
- Definir `VITE_SITE_URL` en producción cuando exista el dominio (`ADR-018`).
- Un asset de marca para `og:image` (no se inventó uno).

Closes #…
```

## PR 13 (BORRADOR) · `feature/backend-terms-and-reports` → base `docs/adr-032-content-reports`

**Título:** `feat(backend): terms acceptance and content reports (ADR-032 phase 1)`

```md
> **No fusionar antes de ratificar ADR-032.** Abrir como *Draft*. Va apilado sobre `docs/adr-032-content-reports`; cuando ese PR se fusione, cambiar la base a `develop`.

## Qué hace
- `users.terms_accepted_at` / `terms_version`. El registro y el alta con Google guardan la aceptación (solo con `true` real). Exigirla es opcional (`TERMS_ACCEPTANCE_REQUIRED`, apagado por defecto hasta que web y móvil envíen la casilla).
- `POST /api/users/me/terms-acceptance`: solo acepta la versión vigente (si no, 409 con `current_version`).
- Tabla `reports` y `POST /api/reports`: solo se reporta lo que quien reporta puede ver; idempotente por reportante+objetivo; limitado a 10/hora; la respuesta nunca incluye reportante, persona reportada ni el texto copiado.
- Migración `a8d2f5c1b937`. Contrato v0.31, `DATABASE_ARCHITECTURE` v0.23.

## Cómo se verificó
Suite completa contra PostgreSQL real: **683 passed** (592 existentes + 91 nuevas). Una mutación en la guardia de visibilidad hizo fallar las pruebas.

## Ojo al fusionar
- El contrato queda en v0.31 y `docs/sync-claude-md-and-contract` lo deja en v0.30: habrá un conflicto trivial de número de versión.
- `app/domain/moderation` es de ADR-024 (filtros personales): la fase 2 no debe usar ese nombre.
- Tras fusionar, correr `flask db upgrade` en dev y en la base de pruebas.

Closes #…
```

## PR 14 · `docs/adr-031-032-018-decisions` → base `develop`

**Título:** `docs: record team decisions on ADR-018, 031, 032 and 033`

```md
## Qué hace
Solo documentación. Registra las decisiones que el equipo tomó el 2026-10-02 y cambia el estado de los ADR de `PROPUESTO` a `ACEPTADO`.

- **ADR-031:** eliminación en varios pasos (código por correo, escribir el correo y `DELETE`, última advertencia), suspensión voluntaria como alternativa, y los mensajes ya recibidos se conservan con el remitente como «Usuario no encontrado».
- **ADR-032:** moderan Fernando y Cristopher; escalera revisión → advertencia → suspensión; 48 h para apelar por correo de soporte.
- **ADR-018:** Cloudflare, Supabase, Render y Resend; la mensajería sigue sin definir.
- **ADR-033:** aceptado; prerender como dirección.

## Qué revisar
Que cada sección «Decisiones del equipo» diga lo que el equipo decidió. Los puntos que **faltan por definir** están marcados dentro de cada una.

Closes #…
```
