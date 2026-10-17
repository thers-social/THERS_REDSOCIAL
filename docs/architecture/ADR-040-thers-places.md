# ADR-040 — THERS Places: arquitectura del módulo de descubrimiento local

| Campo | Valor |
|---|---|
| Documento | `docs/architecture/ADR-040-thers-places.md` |
| Fecha | 2026-10-08 |
| Estado | **PROPUESTO** — redactado por encargo del propietario del proyecto; pendiente de la revisión del equipo (`HB-001` §11–12). **Sin commit. No se ha escrito código.** |
| Relacionado | `ADR-018` (hosting), `ADR-015` (media), `ADR-016` (móvil), `ADR-027` (límites de uso), `ADR-028` (exportación), `ADR-031` (eliminación de cuenta), `ADR-032` (reportes y moderación), `ADR-034` (mayores de 18), `ADR-037` (retención), `ADR-038` (seguridad infantil) |

> **Numeración.** Este documento se redactó como `ADR-039`, el siguiente número libre en `develop` el 2026-10-08. Mientras tanto el equipo usó `ADR-039` para *imágenes en publicaciones y mensajes* (PR #90), así que este pasa a ser **`ADR-040`**, el número que pedía el encargo original. El PR #90 trae además una migración (`a9b4c7e2d815`) con el mismo padre que la primera de este ADR: se resuelve con una migración de fusión (ver §15).

## 1. Contexto y problema

THERS es una red social con backend Flask (arquitectura hexagonal), web React/Vite y app Expo. No tiene ningún concepto de **lugar**: ni tabla, ni geografía, ni mapa. Se quiere un subsistema de descubrimiento local integrado con lo social (guardar, compartir, planear, más adelante negocios y reservas), no un clon de Google Maps.

Este ADR fija la arquitectura y el alcance. **Solo la Fase 1 está planificada con detalle.** Las fases 2–16 son dirección, no compromiso.

## 2. Objetivos y no objetivos

**Objetivos de la Fase 1:** catálogo propio de lugares con geografía real (PostGIS), categorías, búsqueda cercana por distancia con índice espacial, ficha de detalle, datos semilla y pruebas.

**No objetivos de la Fase 1:** guardados, reportes, panel admin, mapas en web o móvil, reseñas, fotos, horarios, `is_open`, `rating`, importación OSM, reservas, cotizaciones, recomendaciones, Pulse, analítica. Nada de eso se inventa en producción: los campos que dependen de ellos **no se exponen** (no `rating`, no `reviews_count`, no `is_open` falsos).

## 3. Hallazgos de la auditoría (verificados en el repositorio, 2026-10-08)

| Área | Hallazgo | Consecuencia |
|---|---|---|
| Arquitectura | `domain/` → `application/` → `infrastructure/persistence/` → `interfaces/routes/`; un `*_bp` por área registrado con `url_prefix="/api"` en `app/__init__.py`. Dominios con `repositories.py` abstractos y `kinds.py` con constantes (sin `ENUM` de PostgreSQL) | Places sigue el mismo patrón: `domain/places/`, `application/places/`, repositorio SQLAlchemy, `place_routes.py` |
| Errores | Siempre `{"msg": "..."}` (`interfaces/error_handlers.py`) | Se mantiene `msg`. Nada de `error`/`message` |
| Roles | **No existe «admin».** Existe `users.is_moderator` (solo por CLI `flask set-moderator`), decorador `@moderator_required` y rutas bajo `/api/moderation/*`. Quien no es moderador recibe **404** idéntico a una URL inexistente | El encargo propone `/api/admin/places` y pruebas «usuario normal → rechazado». Aquí el rechazo es **404, no 403**. Ver decisión D3 |
| Reportes | `reports.target_type` ∈ {post, comment, message, user}, motivos cerrados (`domain/reports/kinds.py`), `POST /api/reports` | Los motivos de lugar («horario incorrecto», «negocio cerrado») no encajan. Tabla propia `place_reports`; no se toca ADR-032 |
| Mensajes | `messages.content` es `Text`; **no existe `message_type`** (ADR-013/035) | La tarjeta de lugar en el chat (Fase 4) exige una columna nueva y una enmienda al ADR de mensajes. **Fuera de la Fase 1** |
| Almacenamiento | Interfaz `domain/media/storage.py`, implementaciones local y S3 (boto3) por `STORAGE_BACKEND`; **un solo bucket público** (`MEDIA_PUBLIC_BASE_URL`) | Sirve para fotos de lugares. **No hay soporte de bucket privado ni URLs firmadas**: los documentos de reclamo (Fase 6) lo necesitan primero |
| Hosting | Supabase PostgreSQL 16 en staging (`ADR-018`, `STAGING_DEPLOY_GUIDE.md`); Storage compatible con S3 | PostGIS debe poder activarse en Supabase (ver riesgo R2) |
| Base de datos local | `docker-compose.yml` usa **`postgres:16-alpine`: no trae PostGIS**. `docker/postgres-init/` solo crea `thers_test` | Hay que cambiar la imagen y/o instalar la extensión en `thers_dev` y `thers_test`. Ver R1 |
| PostGIS en el repo | Cero referencias (`postgis`, `geoalchemy`, `geography`) en código y docs | Todo es nuevo |
| Dependencias | Sin `geoalchemy2` ni `shapely`. `geoalchemy2` 0.20.0 existe; Python del proyecto es **3.14.3** | Compatibilidad de 3.14 con `geoalchemy2` **sin verificar** (R3). Se prefiere SQL explícito con `ST_*` para limitar dependencias |
| Pruebas | pytest contra PostgreSQL **real** (`thers_test`, ya migrada con Alembic); `_clean_tables` hace `TRUNCATE` con una **lista explícita de tablas** | Las tablas nuevas deben agregarse a esa lista; `thers_test` necesita PostGIS |
| Migraciones | 34 archivos; `head` actual `f8c2d6a4b190` (verificar con `flask db heads` al empezar: el `head` puede haber avanzado) | Una migración nueva, aditiva, encadenada al `head` real |
| Postman | `docs/api/postman/THERS.postman_collection.json`: carpetas `01_AUTH`, `02_USERS`, `03_AUTH_GOOGLE` | **`03_PLACES` del encargo ya está ocupada.** Se usarán `04_PLACES` y `05_PLACES_ADMIN` |
| Contrato | `API_CONTRACT.md` v0.35; regla `HB-001` §15.1: documentar el endpoint el mismo día | Cada endpoint de Places se documenta en el mismo PR |
| Web | React 19, Vite 8, Tailwind v3, react-router 7, **sin librería de mapas**; CSP en `_headers` en modo *report-only* con `connect-src` acotado a `*.thersweb.com` | MapLibre GL JS necesitará abrir `connect-src`/`img-src`/`worker-src` hacia el proveedor de tiles (Fase 3) |
| Móvil | Expo 57.0.26, RN 0.86.3, React 19.2.3, build de desarrollo nativa (no Expo Go), `app.json` con plugins `expo-router`, `expo-secure-store`, `expo-font` | `@maplibre/maplibre-react-native` 11.5.0 declara peers `expo >=54`, `react-native >=80`, `react >=19.1`: **compatible en papel**, sin probar. Ver R4 |
| Reportes de seguridad infantil | `ADR-038`, motivo `child_safety` | Las fotos y reseñas de lugares (Fase 4) heredan esa obligación |
| Privacidad de datos | `ADR-028` (exportación), `ADR-031` (eliminación), `ADR-037` (retención) | `saved_places`, `place_reports` y todo dato por usuario deben entrar en la exportación y en la eliminación de cuenta (Fase 2) |

## 4. Decisión de arquitectura

### 4.1 Capas
Mismo patrón que el resto del backend. Sin lógica en rutas; sin SQLAlchemy en `domain/`.

```
domain/places/           kinds.py (constantes), exceptions.py, repositories.py (abstracto), validators.py
application/places/      list_categories, list_places, get_place, nearby_places, presenter
infrastructure/persistence/repositories/place_repository.py   (consultas ST_* explícitas)
interfaces/routes/place_routes.py                             (place_bp, url_prefix="/api")
```

### 4.2 Modelo de la Fase 1
Identificadores `UUID` con `gen_random_uuid()` y `created_at/updated_at` con zona horaria, como `messages`.

**`place_categories`**: `id`, `slug` (único), `name`, `sort_order`, `is_active`.

**`places`**: `id`, `name`, `slug` (único), `description`, `category_id` (FK), `location geography(Point,4326) NOT NULL`, `address`, `municipality`, `department`, `phone`, `website`, `verification_status`, `source`, `coordinate_source`, `is_active`, `created_by_user_id` (FK nullable, `ON DELETE SET NULL`), `verified_by_user_id` (FK nullable), `last_verified_at`, `created_at`, `updated_at`.

- Índice **GiST** sobre `location`; índices sobre `category_id` y `(is_active, verification_status)`.
- `CHECK` de valores permitidos para `verification_status`, `source` y `coordinate_source` (mismo criterio que `reports.priority`): constantes en `domain/places/kinds.py`, **sin `ENUM` de PostgreSQL**, para no exigir migración al añadir un valor.
- Valores: estado `pending | verified | needs_review | rejected | inactive`; fuente `thers_field | business | community | osm | official`; coordenadas `gps | map_selected | geocoded | imported`. (Minúsculas, como `self_harm`; el encargo las escribe en mayúsculas — convención de la casa gana.)
- `last_verified_at` y `verified_by_user_id` quedan en el modelo, pero **no hay forma de fijarlos hasta la Fase 2** (admin).

**Diferido a su fase (no se crea en la Fase 1):** `place_tags`/`place_tag_assignments` (el encargo los lista en el «mínimo»; se difieren: no hay UI ni caso de uso que los consuma en la Fase 1 — ver D5), `saved_places`, `place_reports`, `place_photos`, `place_changes`, `admin_audit_log`, todo lo de reseñas, planes, reclamos, reservas y cotizaciones.

### 4.3 API de la Fase 1 (solo lectura)
```
GET /api/places/categories
GET /api/places?category=&limit=&offset=
GET /api/places/nearby?lat=&lng=&radius=&category=&limit=
GET /api/places/{id}
```
- `search` (`GET /api/places/search`) **queda para la Fase 2**: exige decidir `pg_trgm`/`unaccent` y tildes/ñ (D6).
- Validación en el servidor: `lat ∈ [-90,90]`, `lng ∈ [-180,180]`, ambos obligatorios; `radius` por defecto **5000 m**, máximo **50000 m**, mayor que 0; `category` debe existir; `limit` acotado. Cualquier fallo → `400` con `{"msg": "..."}`.
- Solo `is_active = true` y estado `verified` salen en las listas públicas (D4). Un lugar inactivo o inexistente en el detalle → **404 idéntico**.
- `nearby` usa `ST_DWithin(location, ST_MakePoint(:lng,:lat)::geography, :radius)` y ordena por `ST_Distance` (o el operador KNN `<->` sobre el mismo índice). **Nunca** se itera en Python.
- Respuesta de lista (campos reales solamente):
```json
{
  "id": "uuid", "name": "Café Aurora", "slug": "cafe-aurora",
  "category": {"id": "uuid", "slug": "cafes", "name": "Cafés"},
  "latitude": 13.692941, "longitude": -89.218191,
  "distance_meters": 820,
  "verification_status": "verified",
  "address": "…", "cover_image_url": null
}
```
  Sin `rating`, `reviews_count`, `is_open`, `is_saved` hasta que el backend los respalde.
- Límites de uso por `ADR-027` para las lecturas (valor por decidir, D7).

### 4.4 Privacidad de la ubicación
- La ubicación del usuario **no se guarda**: `lat/lng` de `nearby` se usan para la consulta y se descartan. Sin tabla de historial.
- **Riesgo propio de este diseño:** `lat/lng` viajan en la *query string* de un `GET`, y las query strings acaban en los registros de acceso de Render/proxy y en Sentry. Mitigación obligatoria antes de la Fase 3: (a) no registrar la query string de `/api/places/nearby` en ningún log propio; (b) confirmar que Sentry y el proxy no la capturan, o (c) redondear a ~3 decimales (~110 m) en cliente antes de enviar. Ver D2.
- Si el usuario rechaza el GPS, la app sigue funcionando con zona/búsqueda manual (Fase 3).

### 4.5 Fuentes y OpenStreetMap
Cada lugar conserva `source` y `coordinate_source`. **La Fase 1 no importa datos OSM.** Si se hace después: la licencia ODbL exige atribución y obliga a compartir bajo la misma licencia las bases de datos derivadas que se redistribuyan; mezclar sin separar procedencia contaminaría el catálogo propio. Se importaría a un esquema/tabla separada con `source = 'osm'` y trazabilidad por identificador OSM. No se copia nada de Google Maps.

### 4.6 Mapas (abstracción de proveedor)
MapLibre en móvil y web; el proveedor de tiles/geocodificación/rutas se configura por entorno (`MAP_STYLE_URL`, `MAP_API_KEY` o equivalentes) y **nunca está fijo en el código**. El backend de la Fase 1 no sirve tiles. Los servidores públicos de OSM no permiten uso de producción: hace falta un proveedor con clave (Stadia, MapTiler, Geoapify u otro) — **no se elige aquí** (D1). Una clave en el cliente móvil queda embebida en el bundle (mismo aviso que `EXPO_PUBLIC_API_URL`): debe ser una clave restringida por aplicación/dominio, nunca un secreto.

## 5. Plan detallado de la Fase 1

**Orden de trabajo (cada paso con su verificación):**
1. **Entorno PostGIS.** Cambiar la imagen de `docker-compose.yml` a una con PostGIS 16, añadir `CREATE EXTENSION IF NOT EXISTS postgis` a `docker/postgres-init/` para `thers_dev` y `thers_test`, y documentarlo en `LOCAL_DEV_SETUP.md`. **Comprobar `SELECT postgis_full_version()` antes de seguir.** Si el volumen existente es de `postgres:16-alpine`, ver R1.
2. **Migración Alembic** única y aditiva: `CREATE EXTENSION IF NOT EXISTS postgis`, `place_categories`, `places`, índices, `CHECK`s. Encadenada al `head` real. Probar `upgrade` y `downgrade` (el `downgrade` borra tablas, **no** la extensión).
3. **Dominio y aplicación:** `kinds.py`, validadores de `lat/lng/radius`, casos de uso, presentador.
4. **Repositorio** con SQL `ST_*` explícito y la ruta `place_routes.py`; registrar el `place_bp`.
5. **Semilla** `backend/scripts/seed_places.py`, idempotente, sin datos de Google: ~15 lugares con distancias conocidas (A≈500 m, B≈2 km, C≈10 km), tildes/ñ, nombre largo, campos opcionales ausentes, verificado/pendiente/inactivo; modo `--bulk 1000` para rendimiento.
6. **Pruebas** en `backend/tests/places/` (modelo, servicio, API, nearby). Añadir las tablas nuevas a la lista de `TRUNCATE` de `conftest.py`.
7. **Postman:** carpeta `04_PLACES` con pruebas de código, estructura y arreglos.
8. **Documentación** el mismo día: `API_CONTRACT.md` (§4, versión nueva), `DATABASE_ARCHITECTURE.md`, `.env.example` si aparece una variable.
9. **`EXPLAIN ANALYZE`** sobre 1000 lugares; documentar consulta, plan e índice usado.
10. **Regresión completa** (`python -m pytest`, hoy ~592 pruebas, ~12 min) y auditoría de seguridad antes de cerrar la fase.

**Archivos que se crearían:** `ADR-040` (este), `domain/places/*`, `application/places/*`, `place_repository.py`, `place_routes.py`, una migración, `scripts/seed_places.py`, `tests/places/*`, carpeta Postman.
**Archivos que se modificarían:** `app/__init__.py` (registro del blueprint), `infrastructure/persistence/models.py` (modelos), `docker-compose.yml`, `docker/postgres-init/*`, `tests/conftest.py`, `requirements.txt` (solo si se adopta `geoalchemy2`), `API_CONTRACT.md`, `DATABASE_ARCHITECTURE.md`, `LOCAL_DEV_SETUP.md`, la colección Postman.
**Archivos que NO se tocan en la Fase 1:** auth, mensajes, reportes, moderación, frontend web, móvil.

### Pruebas obligatorias de `nearby`
Válido; `lat`/`lng` ausentes; `lat`/`lng` fuera de rango y no numéricos; `radius` negativo, cero, mayor al máximo y no numérico; categoría inexistente; sin resultados; orden por distancia; lugar inactivo excluido; lugar pendiente excluido; **A y B devueltos y C no** con `radius=3000`, con `dist(A) < dist(B)`; tildes y ñ en nombres; sin JWT (según D4).

## 6. Fases posteriores (dirección, no compromiso)

| Fase | Contenido | Dependencia dura |
|---|---|---|
| 2 | Guardados (`UNIQUE(user_id, place_id)`), reportes de datos, cola de revisión, edición y cambio de estado, `admin_audit_log`, búsqueda | Decisión D3 (rol). Inclusión en exportación/eliminación (ADR-028/031) |
| 3 | MapLibre móvil y web, pines, tarjetas, estados de UI | Proveedor de tiles (D1), R3/R4, ADR-016 actualizado |
| 4 | Reseñas, fotos, publicaciones y reels asociados, compartir por chat | `message_type` en `messages` (enmienda a ADR-013/035); moderación de fotos (ADR-038) |
| 5 | Planes con amigos | 4 |
| 6–7 | Reclamos de negocio (fase 6, hecha: §22) y panel de negocio (fase 7, hecha: §23) | **Bucket privado + URLs firmadas** (no existen); rol de gestor distinto de `is_moderator` |
| 8–12 | Reservas (fase 8, hecha: §24), calendario (fase 9, hecha: §25), cotizador (fase 10, hecha: §26), aceptar cotización y PDF (fase 11, hecha: §27); avisos de Places (fase 12, hecha: §28) | 6–7 y disponibilidad; restricciones/transacciones contra doble reserva; total siempre calculado en backend |
| 13 | Rutas (hecha: §29) y navegación en vivo en la app (§30) | Proveedor de routing abstraído |
| 14–16 | Recomendaciones explicables, Pulse (fase 15, hecha: §32), analítica (parte 1 de la 16, la del negocio con datos que ya existen: §31; parte 2, visitas anónimas: §33) | Actividad real suficiente; Pulse solo agregada, nunca presencia exacta |

Se respeta la regla del encargo: no se construyen cotizaciones sin propiedad de negocio, reservas ni disponibilidad, ni recomendaciones sin actividad.

## 7. Seguridad

- Toda validación en el servidor; `lat/lng/radius/limit` acotados; parámetros siempre ligados (nunca SQL concatenado).
- Detalle de lugar inactivo o inexistente: 404 idéntico (mismo criterio que ADR-019/020/032).
- Sin secretos ni tokens en logs; sin query string de `nearby` en logs (§4.4).
- Admin (Fase 2): ver D3; cada acción crítica auditada.
- Payloads grandes y URLs: límites de longitud y esquema `http(s)` en `website`.

## 8. Riesgos

| # | Riesgo | Mitigación / acción |
|---|---|---|
| R1 | Cambiar de imagen reutilizando el **mismo volumen**. Con una imagen Debian (`postgis/postgis:16-3.5`) habría riesgo de *collation* (musl frente a glibc) sobre los índices de texto; con la variante **alpine** (`postgis/postgis:16-3.5-alpine`, existe — verificada) no | Usar la variante alpine de la misma versión mayor (16). Aun así, probar primero sobre una copia del volumen o con `pg_dump` previo |
| R2 | PostGIS en Supabase: se activa con `CREATE EXTENSION`, pero normalmente en el esquema `extensions`, lo que afecta a la resolución del tipo `geography` según el `search_path`. Además el pooler en modo transacción ya es un riesgo conocido (`ADR-018`) | Probar en el proyecto de staging **antes** de fusionar. Calificar el tipo o fijar el `search_path` en la migración |
| R3 | `geoalchemy2` 0.20.0 con Python 3.14.3 no verificado | **Resuelto por descarte (fase 1):** no se adopta `geoalchemy2`. Tipo `Geography` mínimo propio en `models.py` y SQL `ST_*` explícito en el repositorio. Cero dependencias nuevas |
| R4 | MapLibre RN 11.5.0 es nativo con *codegen*: en esta máquina Windows, con la unidad `subst`, ya falló el *codegen* de `react-native-gesture-handler` y `react-native-safe-area-context` con «different roots». Es muy probable que ocurra igual | Resolver el problema de rutas del entorno de compilación **antes** de la Fase 3 (ver «Otros problemas detectados») |
| R5 | `lat/lng` en la URL acaban en logs de terceros | §4.4 |
| R6 | Un catálogo con comercios reales atrae datos personales (teléfonos de particulares) | Solo datos publicados por el negocio o de fuentes oficiales; canal de corrección/baja |
| R7 | Cobertura inicial pobre: sin lugares sembrados la función se ve vacía | Plan de siembra de campo (`thers_field`); la semilla de pruebas **no** va a producción |

## 9. Decisiones

Resueltas por el propietario (2026-10-08):

| # | Decisión | Resultado |
|---|---|---|
| D1 | Proveedor de tiles/geocodificación | **Se espera a la Fase 3.** La Fase 1 no lo necesita |
| D3 | Rol de administración | **Se reutiliza `is_moderator` y `@moderator_required`.** Las rutas de administración de lugares irán bajo `/api/moderation/places/*` (no `/api/admin/*`) y quien no sea moderador recibe **404**, no 403. Las pruebas de la Fase 2 se escriben con ese criterio. Un rol aparte solo si aparece una necesidad real de separar permisos |
| D4 | Lectura del catálogo | **Pública** (listas y detalle, sin JWT). JWT solo donde haya estado de usuario. Pendiente de verificar en la Fase 2 que `jwt_required(optional=True)` convive con el registro de sesiones (`ADR-025`) para el futuro `is_saved` |
| D5 | Etiquetas | **Diferidas.** `place_tags` y `place_tag_assignments` no se crean en la Fase 1 |

Pendientes o por fijar al implementar:

| # | Decisión | Recomendación |
|---|---|---|
| D2 | Cómo proteger `lat/lng` en logs | Redondeo en cliente + no registrar la query string (antes de la Fase 3) |
| D6 | Búsqueda de texto | `pg_trgm` + `unaccent` (ambas ya disponibles en el Postgres local), en la Fase 2 |
| D7 | Límites de uso de las lecturas (ADR-027) | Un tope generoso por IP/usuario; fijar al implementar |
| D8 | Cambio de imagen de Postgres en `docker-compose.yml` | **Pendiente de confirmación.** Usar `postgis/postgis:16-3.5-alpine` (verificada 2026-10-08): misma base alpine y misma versión mayor 16 que la actual, lo que elimina el riesgo de *collation* (R1). Impacto en el equipo: una descarga de imagen y recrear el contenedor; los datos del volumen se conservan |

## 10. Otros problemas detectados (no son de Places, pero lo condicionan)

1. **PR del lockfile (`fix/mobile-lockfile-sync`) sin fusionar.** Con el lock corregido, un `npm ci` instala `react-native-gesture-handler`/`reanimated`/`worklets` y la compilación con `subst` falla. Cualquier dependencia nativa nueva (MapLibre) empeora esto. Conviene resolverlo antes de la Fase 3.
2. **Compilación Android en Windows frágil:** depende de `subst`, de reescribir `autolinking.json` a mano y de tener memoria libre; el sistema ya mató dos compilaciones por falta de RAM.
3. **Árbol de trabajo con archivos sin seguimiento** ajenos (`THERS_CLAUDE_MASTER.docx`, PDFs, `error.jpeg`) que no deben entrar en ningún commit.
4. **`API_CONTRACT.md` v0.35 y `CLAUDE.md` §5** están desfasados en detalles (p. ej. el recuento de rutas); Places debe actualizar el contrato sin copiar listas que envejecen.
5. **Moderación web:** existe un feature `moderation` en el Frontend (PR #83); revisar su patrón antes de diseñar el panel de Places.

## 11. Criterios de aceptación de la Fase 1

- `SELECT postgis_full_version()` funciona en `thers_dev`, `thers_test` y (probado) en el Supabase de staging.
- `flask db upgrade` y `flask db downgrade` limpios; el índice GiST existe.
- Los 4 endpoints responden con el contrato anterior; todos los errores usan `msg`.
- `nearby` con `radius=3000` devuelve A y B (en ese orden), no C, y excluye inactivos y pendientes.
- `EXPLAIN ANALYZE` con 1000 lugares usa el índice espacial (documentado).
- Suite completa en verde (regresión); sin pruebas existentes modificadas para «hacerlas pasar».
- `API_CONTRACT.md` y `DATABASE_ARCHITECTURE.md` actualizados en el mismo PR.
- Informe de cierre de fase: cambios, pruebas, JSON reales, seguridad, regresión, pendientes y siguiente fase.

## 12. Resultados de la Fase 1 (implementada 2026-10-08, sin commit)

**Hecho:** imagen `postgis/postgis:16-3.5-alpine` (D8 confirmada); migración `a7c3e9d1b504` (`upgrade`/`downgrade`/`upgrade` probados; el `downgrade` conserva PostGIS); modelos `PlaceCategory` y `Place`; dominio, casos de uso, repositorio y `place_routes.py`; límite de uso `places_read` (120/min por IP); `scripts/seed_places.py`; 4 endpoints de lectura pública; pruebas en `backend/tests/places/`; `API_CONTRACT.md` v0.36, `DATABASE_ARCHITECTURE.md` v0.28 y `LOCAL_DEV_SETUP.md`.

**Cambios respecto al plan:**
- Paginación del listado por `limit`/`offset` (no `cursor`): más simple y suficiente para un catálogo ordenado por nombre. Tope de `offset` 10000.
- Sin dependencia de `geoalchemy2` (R3 resuelto por descarte).
- Las 12 categorías iniciales se siembran **en la migración**, no en el seed: sin ellas ningún entorno funciona.
- `thers_test` estaba un paso por detrás (le faltaba `e5b8c3a7d912`); al migrarla quedó al día.

**Hallazgo — PostGIS corrige en silencio las coordenadas fuera de rango.** `geography` guarda una latitud 95 como 85 y una longitud 190 como -170, sin error ni restricción posible. La validación tiene que estar en la aplicación y **toda ruta de escritura de la fase 2 debe reutilizar `validators.parse_coordinates`**. Hay una prueba que documenta el comportamiento.

**Rendimiento (`EXPLAIN ANALYZE`, 1016 lugares, radio 3 km, `LIMIT 20`):** `Bitmap Index Scan on ix_places_location` con `Index Cond: location && _st_expand(...)`: el índice devuelve 23 candidatos de 1016 filas; `ST_DWithin` descarta 5 y quedan 18. Ejecución ~17 ms (planificación 12 ms, primera ejecución en frío). El `ORDER BY location <-> punto` se resuelve con una ordenación en memoria de 18 filas (27 kB), no con el índice KNN: con pocos candidatos es lo correcto. **Cuello de botella previsible:** con radios grandes y mucha densidad el conjunto filtrado crece y esa ordenación pasa a pesar; no se optimiza antes de tener datos reales (`LIMIT` y `radius` ya están acotados).

**Regresión completa (2026-10-08):** 1045 pruebas, 1044 pasaron y 1 falló: `test_account_deletion.py::test_every_foreign_key_to_users_cascades`. Es la guardia de `ADR-031` §4 (toda FK hacia `users` debe ser `CASCADE`, salvo excepciones documentadas). `places.created_by_user_id` y `verified_by_user_id` son `SET NULL` a propósito, así que se registró `places` como excepción documentada junto a `reports` (único cambio a una prueba existente, con su justificación en el código). Tras el cambio, las 39 pruebas de ese archivo pasan; la suite completa no se repitió entera.

**Detectado, sin resolver:**
- `rate_limit_guard.enforce` hace una escritura en `rate_limit_buckets` por **cada lectura** pública. Es aceptable a 120/min, pero convierte una lectura en una escritura; si Places se vuelve un endpoint caliente, conviene un límite en la capa del proxy.
- El límite por IP usa `X-Forwarded-For`, falsificable (ADR-027 §Riesgos): frena scripts torpes, no a un atacante decidido.
- `CLAUDE.md` §5 dice que la migración `head` es `f8c2d6a4b190`; el real era `e5b8c3a7d912` y ahora es `a7c3e9d1b504`.
- Sin verificar todavía: PostGIS en el Supabase de staging (R2) y el cambio de imagen en las máquinas del resto del equipo.

## 13. Resultados de la Fase 2 (implementada 2026-10-08, sin commit)

**Hecho:** migración `b8d4f1a6c295` (`saved_places`, `place_reports`, `admin_audit_log`, `pg_trgm`, `unaccent`, la función inmutable `thers_unaccent` y el índice GIN `ix_places_name_search`; `upgrade`/`downgrade`/`upgrade` probados en `thers_dev` y `thers_test`); búsqueda por nombre sin importar mayúsculas ni tildes; guardados idempotentes y `is_saved`; reporte de datos incorrectos; moderación bajo `/api/moderation/places/*` (D3: se reutiliza `is_moderator`, el resto recibe 404); auditoría en la misma transacción; guardados y reportes incluidos en la exportación de datos (ADR-028). Contrato en `API_CONTRACT.md` v0.37 §4.24; modelo en `DATABASE_ARCHITECTURE.md` v0.29 §5.19; Postman `04_PLACES` (16 peticiones) y `05_PLACES_ADMIN` (10).

**Decisiones tomadas al implementar:**
- **Identidad opcional (D4).** `optional_user_id()` trata un token ausente, vencido, revocado o inválido como anónimo, no como error: en un catálogo público, un token vencido en la app no debe impedir ver lugares. Las rutas que sí exigen sesión siguen respondiendo 401.
- **`is_saved` rompe la letra del contrato de la fase 1** (que lo excluía a propósito): ahora está siempre presente, `false` para anónimos. Se actualizaron una prueba y el Postman de la fase 1.
- **Guardar y reportar no pasan por la compuerta de perfil completo (ADR-034):** esa compuerta es para acciones que crean contenido o interactúan con otras personas; guardar es privado.
- **Reportes idempotentes por motivo:** índice único parcial `(reporter_id, place_id, reason) WHERE status IN ('open','reviewing')`. Primer reporte 201, repetido 200 con el mismo id; tras cerrarlo se puede volver a reportar.
- **La cola de moderación no muestra quién reportó** (solo el lugar, el motivo y el detalle).
- **Un lugar creado por moderación nace `pending`** y no público; `verified` exige la ruta de estado, que registra quién y cuándo. La edición no puede cambiar el estado (cada cosa queda auditada aparte).
- **Excepciones nuevas a la guardia de ADR-031** (`SET NULL` en vez de `CASCADE`): `place_reports` y `admin_audit_log`. El reporte y el registro de auditoría deben sobrevivir a la cuenta de quien los generó; la referencia a la persona queda en NULL.
- **Sin interfaz:** la administración es solo API. El panel de Places en la web y la pantalla de reportar/guardar en móvil son de la fase 3.

**Rendimiento (`EXPLAIN ANALYZE`, 20 016 lugares):**
- Búsqueda por nombre: `Bitmap Index Scan on ix_places_name_search`, **3,7 ms**.
- `nearby` radio 3 km: **22 ms**. Radio 50 km con todo el catálogo dentro: **182 ms**. El plan une con las 12 categorías en bucle anidado y repite trabajo. Una variante (filtrar y limitar primero, unir categorías después) bajó el peor caso a **113 ms** pero añade complejidad; **no se aplicó** (sin datos reales sería optimizar antes de tiempo). Camino de mejora documentado: subconsulta con `LIMIT` antes del `JOIN` y/o acotar el radio máximo.

**Seguridad revisada:** acceso a moderación con usuario normal (404 idéntico), sin token (401), moderador suspendido (404) y cambios no autorizados (no se aplican ni se auditan); cuerpos que no son objetos JSON; campos internos falsificados (`verification_status`, `reporter_id`, `created_by_user_id`…) ignorados; inyección SQL y comodines de `LIKE` en la búsqueda; coordenadas fuera de rango, `website` con esquemas peligrosos (`javascript:`, `ftp:`), longitudes y caracteres de control; límites de uso por cuenta; auditoría sin secretos; supervivencia de reportes y auditoría al borrar cuentas.

**Pendiente / detectado:**
- **PostGIS, `pg_trgm` y `unaccent` en el Supabase de staging (R2) siguen sin probarse.** `thers_unaccent` es una función propia: en Supabase las extensiones viven en el esquema `extensions`, lo que puede exigir calificar `unaccent` en la función.
- `admin_audit_log` no tiene ruta de lectura (solo se escribe): consultarla requiere SQL directo. Falta decidir si hace falta un visor y con qué retención (ADR-037).
- La búsqueda solo mira el **nombre** (no dirección, municipio ni etiquetas).
- Los reportes críticos (`inappropriate`) no tienen prioridad ni aviso al equipo: se atienden por orden de llegada.
- Etiquetas (`place_tags`), fotos, cambios (`place_changes`) y reseñas siguen sin existir (fases siguientes).

**Regresión completa de la fase 2 (2026-10-08):** 1216 pruebas, 1213 pasaron y 3 fallaron. Las tres eran pruebas unitarias de la fase 1 (`test_place_service.py`) cuyo repositorio falso no conocía el parámetro `user_id` ni el campo `is_saved` que esta fase añadió al contrato; no era un defecto del código. Se actualizó el repositorio falso y las 35 pruebas de ese archivo pasan. No se repitió la suite entera tras ese cambio (solo el archivo afectado). La guardia de ADR-031 (claves foráneas hacia `users`) pasó con las excepciones documentadas.

## 14. Resultados de la Fase 3 — web (implementada 2026-10-08, sin commit)

**Hecho (solo web):** `Frontend/src/features/places/` (página, mapa MapLibre con pines como capa GeoJSON, tarjetas de resultado, filtro por categoría, búsqueda, ficha con guardar y reportar, estados `loading/offline/error/empty/success`, aviso de ubicación denegada); rutas `/places` y `/places/:placeId`; «Lugares» en la barra lateral; textos es/en; `VITE_MAP_STYLE_URL`; `Frontend/tests/places.test.mjs`. Detalle en `FRONTEND_ARCHITECTURE.md` §28.

**Hallazgos de la verificación en un Chrome real** (los habría perdido cualquier prueba sin navegador):
1. **MapLibre 6 no carga su Web Worker empaquetado con Vite** («Worker failed to load»): el mapa se dibuja vacío. Solucionado con un plugin de Vite (`vite-maplibre-worker.js`) que lo sirve desde una ruta fija.
2. **`import maplibregl from "maplibre-gl"` falla en el build** (la v6 no tiene export por defecto). Se importa como espacio de nombres.
3. **La ficha se rompía** (`Cannot read properties of null`) en el render en que cambia el id del lugar: el estado todavía describía «sin lugar». Ahora el estado es derivado y nunca se pinta con un lugar nulo ni de otro id.
4. **`public/_headers` bloqueaba la geolocalización** en producción (`geolocation=()`). Ahora `geolocation=(self)`.
5. Mi primer acceso en la navegación fue a un componente que ya no se usa (`NavRail.jsx`); se movió a `thers/navigation.js`.

**Pendiente / decisiones:**
- **D1 (proveedor de tiles) sigue abierta.** El estilo de demostración no tiene calles; sirve para ver pines y comportamiento, no para producción. Antes de publicar: elegir proveedor, definir `VITE_MAP_STYLE_URL` y añadir su dominio al CSP.
- **«Ubicación» (`/radar`) y «Lugares» se solapan.** `/radar` es un marcador de posición anterior, bloqueado «por falta de proveedor de mapas y de endpoints de lugares»; ahora existen. Fusionarlos (o retirar `/radar`) es una decisión de producto. Se dejó «Lugares» como destino aparte para no borrar nada.
- La web **no tiene** barra inferior móvil para Lugares (la bottom-nav tiene 5 huecos fijos); en pantallas pequeñas se llega por el menú lateral.
- **Móvil (MapLibre en la app Expo): NO implementado.** Requiere un módulo nativo (`@maplibre/maplibre-react-native` 11.5.0) y una build nativa nueva. Además `mobile/package-lock.json` en `develop` está desincronizado (PR `fix/mobile-lockfile-sync` sin fusionar) y la compilación Android en Windows con `subst` falla en los módulos con *codegen* («different roots»). Ver §10.
- Sin ejecutar: el mapa en pantallas táctiles/pequeñas (se probó a 1400×900), modo claro, y el estado `offline` real (se cubre la lógica, no el evento del navegador).
- Peso: el chunk de Places es ~290 KB comprimido; solo lo descarga quien abre la página.

**D1 resuelta para desarrollo (2026-10-08): MapTiler.** `VITE_MAP_STYLE_URL` apunta a un estilo de MapTiler (`.../style.json?key=...`, **con `/style.json` al final**: sin él devuelve una página web, no el estilo). La clave se restringe por origen (`localhost`, `thersweb.com`, `*.thersweb.com`). Verificado en un Chrome real: desde un origen permitido el estilo y los 16 tiles dan HTTP 200; desde uno no permitido (`127.0.0.1`) MapTiler responde 403, es decir, la restricción funciona. `https://api.maptiler.com` está en el `connect-src` del CSP. **El plan gratuito de MapTiler es solo no comercial (con excepción de I+D): antes de publicar hace falta un plan de pago** (Flex, 25 USD/mes según su página a 2026-10-08) o cambiar de proveedor. La app móvil no envía cabecera `Origin`, así que necesitará una clave aparte (fase móvil). La atribución «© MapTiler © OpenStreetMap contributors» la dibuja el propio mapa y cumple la ODbL.

## 15. Integración con `develop` (2026-10-08)

Antes de abrir el PR, `develop` había avanzado con el PR #89 (lockfile del móvil) y el PR #90 (imágenes en publicaciones y mensajes, `ADR-039`). Consecuencias, ya resueltas en la rama:

- **Numeración:** este ADR pasó de `ADR-039` a **`ADR-040`** (82 referencias en 47 archivos, ninguna del PR #90 se tocó).
- **Dos cabezas de Alembic:** `a9b4c7e2d815` (imágenes) y `a7c3e9d1b504` → `b8d4f1a6c295` (Places) compartían padre `e5b8c3a7d912`. Se unieron con la migración de fusión `65a6decd96ab` (no toca el esquema), el mismo mecanismo que `f8c2d6a4b190`. **Cabeza única actual: `65a6decd96ab`.** Una base que ya tenía las migraciones de Places aplica primero la de imágenes y luego la de fusión.
- **Un conflicto de texto** en `backend/tests/conftest.py` (lista de tablas que se vacían entre pruebas): se combinaron `media_attachments` y las tablas de Places. `policy.py` y `models.py` se fusionaron sin intervención.
- **Móvil:** el PR #89 ya está en `develop`, así que el bloqueo del `package-lock.json` desapareció. Sigue pendiente la compilación nativa Android (§10) y la clave de MapTiler propia del móvil (§14).

## 16. Fase 3 — móvil (código escrito 2026-10-08, sin verificar en un teléfono, sin commit)

**Hecho (rama `feature/places-mobile`, apilada sobre `feature/places-phase1`):**
- Dependencias nativas con las versiones que Expo fija para el SDK 57: `@maplibre/maplibre-react-native` 11.5.0 (BSD-3) y `expo-location` ~57.0.20. Plugins en `app.json`; el de ubicación con un texto de permiso que explica que solo se usa al pulsar el botón y que no se guarda.
- `mobile/src/features/places/`: `types`, `api` (todas las llamadas autenticadas; coordenadas redondeadas a 3 decimales antes de salir), `coordinates` y `viewState` (puros, probados), `mapConfig` (`EXPO_PUBLIC_MAP_STYLE_URL`), `useGeolocation` (una lectura, precisión equilibrada, sin seguimiento ni almacenamiento), `usePlaces`, `usePlaceDetail`, `PlacesMap`, `PlaceCard`, `CategoryChips`, `ReportPlaceModal`.
- Pantallas `app/places/index.tsx` (mapa arriba, lista abajo, búsqueda, filtro, «Buscar en esta zona», botón de ubicación) y `app/places/[id].tsx` (ficha con guardar y reportar). Entrada desde «Explorar» con una tarjeta «Lugares cerca de ti». Dos iconos nuevos (`pin`, `locate`).
- Estados `loading / offline / error / empty / success`; en el móvil «sin red» sale de `ApiError.isNetworkError` (no hay `navigator.onLine`). La ubicación denegada es un aviso, no rompe la lista.

**Verificado:** `tsc --noEmit` sin errores; `npm test` 57 pruebas (la nueva incluye la **paridad de motivos de reporte y del radio máximo con `backend/.../kinds.py`**); `expo-doctor` 20/21 (el mismo desajuste de 4 parches de Expo que ya existía; `maplibre` y `expo-location` no aparecen); `expo export --platform android` genera el bundle (1528 módulos, 3,4 MB).

**NO verificado — requiere una build nativa en un teléfono:** que el mapa dibuje, que los toques sobre los pines funcionen, el permiso de ubicación real y el rendimiento. MapLibre es un módulo nativo: **no funciona en Expo Go**. Las pruebas sobre el código fuente no sustituyen esa comprobación.

**Riesgos conocidos antes de compilar:**
1. **Clave propia para el móvil.** La app nativa no envía `Origin`; la clave de la web (restringida por dominio) daría 403. Hay que crear otra clave en el proveedor y ponerla en `mobile/.env` (`EXPO_PUBLIC_MAP_STYLE_URL`, ver `mobile/.env.example`). Si el estilo no carga, la pantalla muestra «No pudimos mostrar el mapa» y la lista sigue funcionando.
2. **Compilación Android en Windows.** Con la unidad `subst` falla el *codegen* de los módulos nativos («different roots»); el lock de `develop` ya instala `react-native-gesture-handler`, `reanimated` y `worklets`, que lo provocan. Plan: compilar desde una **copia en una ruta corta real** (sin `subst`), no editar nada del repositorio. Necesita memoria libre (la compilación anterior fue detenida por el sistema con ~1 GB libres).
3. **Cambio nativo:** hay que regenerar `android/` (`expo prebuild`); el directorio no se versiona.
4. **Atribución:** el mapa conserva el botón de atribución de MapLibre (requisito de la ODbL de OpenStreetMap); la prueba falla si se oculta.
5. **El plan gratuito de MapTiler es solo no comercial** (D1): publicar exige un plan de pago o cambiar de proveedor.

### 16.1 Verificación en un teléfono real (Moto Z3, Android, 2026-10-08)

Build de desarrollo compilada **desde una copia en una ruta corta (`C:\th`), sin `subst`**: `BUILD SUCCESSFUL` en 6 min 42 s con Gradle limitado a 1,5 GB, solo `arm64-v8a` y 2 trabajos. La copia no incluyó `react-native-gesture-handler`, `reanimated` ni `worklets` (opcionales, sin uso, muy pesados); el lock de `develop` sí los instala, pero con la ruta corta ya no hace falta el parche del *codegen*. Se instaló, abrió y cargó el JavaScript desde Metro (1640 módulos).

**Comprobado en pantalla (capturas por `adb`):** inicio de sesión; la tarjeta «Lugares cerca de ti» en «Explorar»; el mapa de MapTiler con calles reales, los pines, el botón de atribución y el logo de MapLibre; la lista con distancias y «Verificado»; la ficha del lugar; **guardar** (la base de datos pasó de 0 a 1 y volvió a 0 al quitarlo); el modal de **reporte** con sus 8 motivos y «Enviar» desactivado hasta elegir uno (no se envió ninguno); y la **búsqueda sin tildes** (`nandu` deja un solo pin y una sola tarjeta, «Ñandú»).

**Hallazgos:** (1) el botón flotante con un engranaje que aparece en todas las pantallas **no es de THERS**: es el del cliente de desarrollo de Expo y desaparece en una build de producción; en esta pantalla tapa en parte el botón de ubicación. (2) La ficha usaba el icono de un enlace para el teléfono; se añadió el icono `phone`. (3) MapTiler registra avisos del estilo en la consola nativa («layer … doesn't support property»): son propiedades del estilo más nuevas que la librería, sin efecto visible. (4) **La clave de MapTiler del plan gratuito solo admite una clave:** se reutiliza la de la web añadiendo `?` a sus orígenes permitidos (la app nativa no envía `Origin`); se comprobó que sin origen y desde `localhost` responde 200, y desde un origen no permitido 403.

**No comprobado:** el permiso y la lectura real de la **ubicación** (es una decisión de privacidad de la persona; no se concedió por ella), el filtro por categoría en el teléfono, el estado «sin conexión» y el comportamiento con muchos lugares.

## 17. Fase 4a — reseñas (2026-10-08)

**Alcance de esta subfase.** Solo reseñas de texto con calificación. Fotos (4b), compartir por chat (4c) y publicaciones asociadas (4d) quedan para
después: cada una toca algo ya ratificado (`media_attachments`, `messages`) y se decide aparte.

**Decisiones (las confirmó la persona propietaria; la segunda es la recomendada).** Las reseñas se hacen en una rama aparte
(`feature/places-reviews`) apilada sobre la móvil. **Cualquier persona con sesión puede reseñar un lugar público**; no se exige haberlo guardado,
porque esa exigencia no verificaría que fue al sitio y solo cerraría la puerta a gente real.

**Modelo.** Una reseña por persona y lugar (`UNIQUE`); escribir otra vez **actualiza**. Calificación entera 1–5; texto opcional de hasta 1000.
El promedio y el conteo se calculan **en el servidor** a partir de las reseñas visibles; sin reseñas son `null` y 0 (el ADR ya prohibía inventar `rating`).

**Seguridad y privacidad.** Identidad solo del JWT; lista blanca de campos; límite de 20 escrituras/hora por cuenta; autor expuesto únicamente
con `id`, `username`, `name` y `avatar_url`; bloqueos respetados en ambos sentidos; moderación por `is_moderator` (404 al resto) con ocultar/restaurar
auditado, sin borrar evidencia. Exportación y borrado de cuenta incluidos.

**Reporte de reseñas (4a.2).** Las reseñas se reportan por la ruta que ya existe, `POST /api/reports`, con `target_type = "review"`
(`ADR-032`). `target_type` es texto validado en la aplicación, sin restricción en la base, así que **no hizo falta migración**; la enmienda
al ADR-032 se reduce a un valor nuevo en la lista. Reglas: solo se reporta una reseña **visible** (no oculta por moderación, de un lugar público,
de una cuenta no bloqueada en ningún sentido) y nunca la propia; es idempotente; `child_safety` produce prioridad crítica como en el resto
(`ADR-038`). La cola de moderación la muestra con una copia del texto y «Retirar contenido» **borra la reseña** (el promedio se recalcula solo).
Quien reporta no se revela a la persona reportada. Web y móvil tienen el botón «Reportar» en cada reseña ajena. Sigue sin haber detección
automática de reseñas falsas ni de spam más allá del límite de uso (20 escrituras por hora y cuenta).

**Verificación.** 32 pruebas nuevas en `tests/places/test_place_reviews.py` contra PostgreSQL real (escribir, actualizar, validación con 11 entradas
inválidas, lugar inexistente/no público, identidad no falsificable, borrar, listado público y paginación, sin datos privados del autor, promedio,
bloqueos, ocultar/restaurar con auditoría, 404 a no moderadores, límite, borrado de cuenta y exportación). La web y el móvil muestran y escriben reseñas (compilan y pasan sus pruebas; sin verificar en navegador ni teléfono).

**Verificación de 4a.2.** 13 pruebas nuevas en `tests/places/test_review_reports.py` (reportar, idempotencia, no reportar la propia, id inexistente o mal formado, reseña oculta, lugar no público, autor bloqueado, sin sesión y motivo inválido, prioridad crítica, cola de moderación, retirar contenido y descartar) más las 149 de reportes, moderación y reseñas ejecutadas juntas contra PostgreSQL real. No se probó en un navegador ni en el teléfono.

## 18. Fase 4b — fotos en reseñas (2026-10-08)

**Alcance.** Hasta 3 fotos por reseña, subidas por su autor; se ven en la web y en el móvil. Subir fotos desde el móvil **no está hecho**: la app no tiene selector de imágenes (`expo-image-picker`) y añadirlo es una dependencia nativa que exige recompilar; se decide aparte.

**Decisiones.** (1) Se reutiliza `media_attachments` en lugar de una tabla nueva: se añade un tercer padre y el CHECK pasa a «exactamente uno». (2) La subida es un **endpoint aparte** (`POST .../review/images`) y no parte de `PUT .../review`: así la reseña de texto sigue siendo JSON, y subir o quitar fotos no puede borrar ni reescribir el texto. Exige tener la reseña escrita. (3) Se reutiliza la tubería de imágenes de posts y mensajes (`ADR-039`): decodificar por contenido, quitar EXIF/GPS, WebP, nombre aleatorio.

**Seguridad.** Un archivo inválido cancela toda la petición (no se guarda nada a medias); el límite de 3 se comprueba **con la reseña bloqueada** (`SELECT … FOR UPDATE`), así dos subidas simultáneas no lo superan; si algo falla tras guardar los archivos, se limpian. Solo el autor sube o quita; una foto ajena da 404. La moderación puede ocultar la reseña (y con ella las fotos) o retirarla (borra fila y archivos). Al retirar una reseña reportada **sí** se borran los archivos, a diferencia de posts y mensajes, cuyo retiro por moderación deja el archivo huérfano (limitación previa, no tocada aquí).

**Pendiente / riesgo.** No hay análisis automático del contenido de las fotos (desnudez, violencia, abuso infantil): la defensa son los reportes (`child_safety` con prioridad crítica, `ADR-038`) y la moderación humana. Es un riesgo que **debe valorarse antes de abrir las fotos al público**. Las fotos no se incluyen en la exportación de datos (`ADR-028`) más que como parte de lo ya borrable con la cuenta: revisar si debe sumarse.

**Verificación.** 19 pruebas (22 casos) nuevas en `tests/places/test_review_photos.py` contra PostgreSQL real y almacenamiento local (subir, listar, límite de 3 sin archivos huérfanos, 4 a la vez, sin reseña, sin sesión, lugar no público, 4 tipos de archivo inválido, un archivo malo cancela todo, EXIF quitado y WebP, quitar, ajena = 404, borrar reseña, retiro por moderación, ocultar, claves de la cuenta, límite de uso). Web: lint, build y 28 pruebas; móvil: typecheck y 25 pruebas. Sin verificar en navegador ni en teléfono.

## 19. Fase 4c — compartir un lugar por chat (2026-10-08)

**Alcance.** Una persona puede mandar un lugar del catálogo a otra en un mensaje directo; el hilo muestra una tarjeta (nombre, categoría, municipio) que abre la ficha. Web: botón «Compartir» en la ficha y tarjeta en el chat. Móvil: tarjeta en el chat (el envío desde la ficha queda para cuando se pruebe en teléfono).

**Enmienda a ADR-013 / ADR-035.** El plan decía `message_type`. Se cambió por una **columna `messages.place_id` nula** (FK `ON DELETE SET NULL`): un enum de tipos habría que mantenerlo para un solo caso y obligaría a decidir qué hacer con cada tipo futuro; la presencia de `place_id` basta. El contrato del mensaje solo **gana** el campo `place` (aditivo), el envío acepta `place_id` y la idempotencia por `client_id` (ADR-035) no cambia: un reintento devuelve el mensaje original sin tocarle el lugar.

**Reglas.** (1) Solo se comparten lugares **públicos**; uno inexistente o no público da `404`. (2) Las comprobaciones de bloqueo y de `who_can_message` van **antes** y no se saltan, así que un envío rechazado nunca revela si el lugar existe. (3) La tarjeta nunca lleva coordenadas, teléfono ni estado de verificación. (4) Si el lugar deja de ser público tras compartirse, quien lee ve `{id, available:false}` (ni nombre ni ubicación: pudo retirarse por moderación); si se borra del catálogo, el mensaje se conserva y `place` es `null`. (5) El hilo resuelve todas las tarjetas con **una** consulta, no una por mensaje. (6) No se añadió límite de uso propio: cuenta como un mensaje más.

**Pendiente.** Compartir fuera del chat (enlace público, publicaciones) no está hecho. Los mensajes con lugar no se incluyen en la exportación de datos más allá de lo que ya exporta `messages`.

**Verificación.** 18 pruebas nuevas en `tests/places/test_place_share.py` contra PostgreSQL real (compartir con y sin texto, mensaje normal sin lugar, tarjeta en ambos lados, campos exactos de la tarjeta, lugar inexistente/pendiente/inactivo, `place_id` mal formado con 4 entradas, privacidad y bloqueo, uno mismo, idempotencia, lugar que deja de ser público, lugar borrado, lista de conversaciones, edición, una sola consulta para 5 tarjetas).

## 20. Fase 4d — publicaciones asociadas a un lugar (2026-10-08)

**Alcance.** Una publicación puede llevar un lugar (`posts.place_id`). El feed y la ficha del lugar muestran una tarjeta; la ficha lista las publicaciones de ese lugar y permite publicar en él (texto; las fotos se suben desde el flujo normal de publicar). **Reels:** el backend no tiene ninguna entidad de video/reel todavía (la entrada «Videos» de la web no tiene datos reales), así que no hay nada a lo que asociar un lugar; queda para cuando exista esa entidad.

**Decisiones.** (1) Columna nula con `ON DELETE SET NULL`, igual que en mensajes: borrar un lugar no borra publicaciones de nadie. (2) La tarjeta es **la misma** que la del chat (4c); su SQL y su presentador se extrajeron a un módulo común para que ambas no diverjan. (3) `GET /api/places/<id>/posts` **reutiliza** `list_recent` con un filtro por lugar en lugar de duplicar la consulta, de modo que cuentas privadas, bloqueos, contenido sensible, palabras y temas silenciados se aplican igual por construcción y el lugar no abre una vía lateral. (4) Las tarjetas de una página se resuelven con **una** consulta. (5) El lugar se valida **antes** de guardar archivos: una publicación rechazada no deja imágenes huérfanas.

**Defecto encontrado al verificar.** La respuesta de `PATCH /api/posts/<id>` no resolvía la tarjeta y habría mostrado un lugar válido como «no disponible»; se corrigió y tiene prueba.

**Pendiente / riesgo.** Un lugar permite publicar a cualquiera con sesión: es una nueva superficie de spam y de reputación para los negocios. La defensa es la actual (reportes y moderación de publicaciones, ADR-032); no hay límite específico por lugar ni detección de publicaciones coordinadas. No se puede cambiar el lugar de una publicación ya creada.

**Verificación.** 20 pruebas nuevas en `tests/places/test_place_posts.py` contra PostgreSQL real (publicar con y sin lugar, lugar inexistente/pendiente/inactivo sin publicar nada, `place_id` mal formado con 4 entradas, tarjeta en el feed, listado por lugar, sin sesión, orden, cuentas privadas, bloqueos en ambos sentidos, sensibles y silenciados, lugar que deja de ser público, lugar borrado, publicación con foto, rechazo sin archivos huérfanos, una consulta por página, edición).


## 21. Fase 5 — planes con amistades (2026-10-08)

**Alcance.** Un plan es una salida a un lugar público en una fecha, con personas invitadas que responden «voy» o «no voy». Backend, web y móvil. No hay chat de grupo, pagos, reservas ni ubicación en vivo.

**Decisiones.** (1) **«Amistad» = seguimiento mutuo aceptado y sin bloqueo.** No existe un concepto de amistad en el producto; se eligió el seguimiento
mutuo (y no «alguien a quien sigo») para que nadie pueda llenar de invitaciones a un desconocido. Se comprueba al invitar, no después: dejar de seguirse
no expulsa de un plan ya creado. Inexistente, no amistad o bloqueada dan el mismo error (no revela cuál). (2) **Privacidad por membresía:** el plan solo lo ve
quien es integrante; el resto recibe 404. (3) Quien lo crea es integrante `going` y no puede «no ir»: cancela. Cancelar **conserva** la fila para que las
personas invitadas vean que ya no va. (4) Quien rechazó **no se reinvita** (evita insistencia). (5) Tope de 20 integrantes, comprobado bajo bloqueo de fila
para que invitaciones simultáneas no lo superen. (6) Un plan cancelado o ya pasado es de solo lectura (409). (7) La tarjeta del lugar es la misma de 4c/4d
(no se duplica el SQL); si el lugar deja de ser público, el plan muestra «no disponible» sin nombre ni ubicación. (8) Bloqueos: los integrantes bloqueados
con quien consulta no aparecen y los planes de quien bloqueaste no se listan.

**Seguridad.** Identidad solo del JWT; lista blanca de campos; consultas con parámetros ligados; 30 escrituras/hora por cuenta; `CHECK` en los dos estados;
`ON DELETE CASCADE` desde usuarios y lugares (borrado de cuenta, `ADR-031`); exportación (`ADR-028`) sin datos de otras personas.

**Pendiente / riesgo.** (a) **Las invitaciones no generan notificación ni mensaje**: la persona invitada las ve al abrir `GET /api/plans`. Notificar exige
un tipo nuevo en `notifications` (hoy solo enlaza a un post) y se decide aparte. (b) Web y móvil muestran, crean, responden y cancelan planes **desde la ficha de cada lugar**; no hay todavía una pantalla propia con todos tus planes, y el móvil pide fecha y hora como texto (`AAAA-MM-DD`, `HH:MM`) porque un selector nativo exigiría otra build. (c) Una invitación
es un vector de acoso entre amistades; la defensa es la actual (bloqueo, salirse del plan), sin reporte de planes ni moderación todavía.
(d) No hay recordatorios ni zona horaria del lugar: `starts_at` se guarda en UTC.

**Nuevo endpoint auxiliar.** `GET /api/users/me/friends` lista las amistades (la misma definición), porque el producto no tenía ninguna forma de listar a quién se sigue ni quién sigue.

**Verificación.** 51 pruebas en `tests/places/test_place_plans.py` contra PostgreSQL real (crear con y sin invitados, solo amistades, bloqueos, 17 entradas inválidas
sin guardar nada, lugar no público, identidad no falsificable, privacidad por membresía, listado próximos/pasados, lugar que deja de ser público,
responder, editar, cancelar, plan pasado, permisos de quien lo creó, reinvitar, tope de integrantes, salirse/sacar, límite de uso, exportación y borrado de cuenta).

## 22. Fase 6 — reclamos de negocio (2026-10-08)

**Alcance.** Una persona con sesión reclama un lugar público como suyo adjuntando un documento; la moderación (`is_moderator`) lo aprueba o lo rechaza. Aprobar crea un
**gestor** del lugar (`place_managers`), un rol distinto de moderador. **Este es el requisito de la Fase 6**: el panel de negocio (edición, respuestas) es la Fase 7 y NO existe todavía.
Backend y web. **La app móvil no envía reclamos**: exigiría un selector de archivos nativo (no está instalado) y por tanto una build nueva.

**Las dos dependencias duras de §6, resueltas.**
(a) **Almacenamiento privado con URLs firmadas.** Puerto nuevo `PrivateDocumentStorage` (`domain/media/private_storage.py`). Local: directorio **aparte** de `UPLOAD_DIR`
(que se sirve público) y un token firmado (`itsdangerous`, sal propia) de 5 min en `/api/private-documents/<token>`. S3: bucket distinto (`S3_PRIVATE_BUCKET`) y URL prefirmada. Sin
`S3_PRIVATE_BUCKET`, los reclamos responden `503`: **nunca** se guarda un documento en el bucket público.
(b) **Rol de gestor distinto de `is_moderator`.** Tabla `place_managers` por lugar; ser gestor no da ninguna capacidad de moderación.

**Decisiones.**
(a) Documento obligatorio: imagen (se re-codifica a WebP, lado mayor 2400, sin EXIF) o PDF (cabecera `%PDF-`, sin `/JavaScript`, `/JS`, `/Launch`, `/OpenAction`, `/AA` ni `/EmbeddedFile`). ≤ 5 MB.
(b) **Minimización:** el documento se borra al aprobar, rechazar o retirar, y con la cuenta. La auditoría guarda quién resolvió, no el archivo.
(c) Solo lugares públicos sin gestor; un reclamo pendiente por persona y lugar (índice único parcial) y máximo 3 pendientes por persona; 5 envíos/día (`CLAIM_WRITE`).
(d) Aprobar rechaza automáticamente los demás pendientes del lugar (motivo fijo). Rechazar exige nota, que ve quien reclamó. Tras rechazar o retirar se puede reclamar de nuevo.
(e) Mirar el documento es una acción auditada (`POST .../document-url`, no un `GET` con efectos).

**Pendiente / riesgos.** (1) No hay verificación automática: la decisión es humana y un documento puede ser falso. (2) Varias personas gestoras por lugar solo existen por carrera entre
aprobaciones; no hay UI para invitar equipo ni para quitar al gestor (hoy solo por SQL). (3) No hay notificación al resolver el reclamo: quien reclama lo ve al abrir el lugar.
(4) No hay pantalla web de revisión para moderación: se usa la API. (5) El token local no es de un solo uso: vale 5 min para quien lo tenga.

**Verificación.** 34 pruebas en `tests/places/test_place_claims.py` contra PostgreSQL real (documento privado y re-codificado, PDF peligroso, campos inválidos, límites, 404 a no moderadores,
URL firmada auditada, token falsificado/vencido, aprobación con gestor y borrado del documento, rechazo automático de los demás, exportación y borrado de cuenta, 503 sin almacenamiento).

## 23. Fase 7 — panel de negocio (2026-10-08)

**Alcance.** Quien gestiona un lugar (fase 6) puede ver cifras, corregir los datos de contacto de su ficha y responder públicamente a las reseñas. Backend y web (en la ficha del lugar,
solo visible para quien gestiona). **La app móvil no lo incluye todavía.** No hay horarios, fotos del negocio, promociones, reservas ni cotizaciones (fases 8–12).

**Decisiones.**
(a) **Qué edita un gestor:** solo `description`, `address`, `phone` y `website`, por lista blanca en el caso de uso; el resto del cuerpo se ignora. Nombre, categoría, coordenadas, estado y verificación siguen
siendo de moderación: un gestor no puede mover el pin, renombrar ni «verificarse» a sí mismo. Reutiliza `validate_place_update` y `update_place`, así que valida igual que la moderación y deja auditoría.
(b) **Acceso:** el rol es `place_managers` por lugar, no `is_moderator`; ser moderador no abre el panel de un lugar, ni ser gestor abre nada de moderación. 404 indistinguible para quien no gestiona.
(c) **Respuestas:** una por reseña (`UNIQUE(review_id)`), públicas, texto plano ≤ 500, solo sobre reseñas visibles del mismo lugar. La reseña oculta por moderación no admite respuesta. El autor de la reseña ve la respuesta, no hay hilo.
(d) **Cifras:** solo agregados del propio lugar (guardados, reseñas visibles, promedio, reseñas sin responder, planes activos futuros). Nunca quién guardó ni quién va a un plan.
(e) Límite `BUSINESS_WRITE` de 30 escrituras/hora y cuenta.

**Pendiente / riesgos.** (1) Una reseña editada después de responderla conserva la respuesta, que puede quedar fuera de contexto. (2) Sin reportes sobre respuestas del negocio: hoy se retira la reseña o el lugar
por los canales existentes. (3) Sin avisos al autor de la reseña ni al negocio. (4) Un gestor puede poner en `website`/`phone` datos engañosos; la mitigación es el reporte de datos de lugar (fase 2) y la auditoría.
(5) La exportación de datos no incluye las respuestas escritas por un gestor. (6) Panel móvil pendiente.

**Verificación.** 23 pruebas en `tests/places/test_business_panel.py` contra PostgreSQL real (sesión, 404 a no gestores y a moderación, lista blanca, auditoría, entradas inválidas, límite de uso, respuesta
pública, editar/quitar, reseña de otro lugar u oculta, identidad por JWT, cascada). Se amplió la lista de excepciones `SET NULL` de `test_account_deletion.py` con `place_plan_members`, `place_claims` y
`place_managers` (referencias de autoría ajena que no guardan datos de la persona).

## 24. Fase 8 — reservas (2026-10-08)

**Alcance.** Una persona solicita una reserva (fecha, personas, nota) en un lugar que las aceptó; quien lo gestiona confirma o rechaza; la persona puede cancelar. Backend y web (formulario en la ficha;
configuración y bandeja en el panel de negocio). **La app móvil no lo incluye todavía.** No hay calendario ni horarios de apertura (fase 9), cotizador ni PDF (fases 10–12), pagos ni depósitos.

**Decisiones.**
(a) **Opt-in del negocio:** `place_reservation_settings.enabled` es falso por defecto y solo lo cambia quien gestiona el lugar. El detalle público solo expone el booleano `accepts_reservations`.
(b) **Cupo sin sobreventa:** capacidad en personas por horario exacto (`starts_at`). Al crear, la fila de configuración se bloquea con `SELECT … FOR UPDATE` mientras se suma y se inserta: dos peticiones simultáneas se serializan.
Verificado con una prueba de concurrencia real (dos hilos por los últimos asientos: entra uno). `pending` y `confirmed` ocupan cupo; rechazar o cancelar lo libera.
(c) **Horario:** cuartos de hora exactos, ≥ 30 min de anticipación, ≤ 90 días, zona obligatoria. Sin horarios de apertura todavía: el negocio rechaza lo que no pueda atender.
(d) **Abuso:** una reserva activa por persona y horario (índice único parcial), máximo 5 activas por persona, 30 escrituras/hora.
(e) **Privacidad:** el negocio ve nombre de usuario, nombre, avatar, personas y nota de quien reserva (lo necesario para atender); nunca correo ni teléfono. La persona ve el estado y la nota de la decisión.
(f) Quien gestiona resuelve solo `pending` y a futuro; una reserva confirmada solo la cancela la persona.

**Pendiente / riesgos.** (1) Sin notificaciones: ni la persona ni el negocio se enteran hasta abrir la ficha. (2) Sin horarios de apertura ni bloqueo de fechas: se aceptan solicitudes en horas en que el local cierra. (3) Sin
recordatorios ni «no se presentó». (4) Un negocio puede desactivar las reservas con solicitudes pendientes; quedan como están (la persona las cancela). (5) Spam hacia un negocio concreto: acotado por persona (5 activas), no por
cuenta nueva. (6) Bloqueos entre persona y gestor no se aplican a las reservas. (7) Reservas de cuentas eliminadas se borran, y el negocio pierde ese historial.

**Verificación.** Pruebas en `tests/places/test_place_reservations.py` contra PostgreSQL real (configuración y validación, 404 a quien no gestiona, lugar cerrado o no público, 14 entradas inválidas sin guardar, cupo por horario,
liberación, duplicados y tope, concurrencia, límite de uso, identidad por JWT, cancelar, confirmar/rechazar, otro gestor, exportación y borrado de cuenta). Se amplió el conjunto esperado de claves de `test_review_reports.py` con `reply` (fase 7)
y la lista de excepciones `SET NULL` de `test_account_deletion.py` con `place_reservations` (`decided_by`).

## 25. Fase 9 — horario y calendario de reservas (2026-10-08)

**Alcance.** Quien gestiona un lugar publica su horario semanal y los días cerrados; las personas ven los horarios libres con cupo restante; una reserva solo entra en horario y en días abiertos. El negocio tiene una vista de calendario
con las reservas por día. Backend y web. **La app móvil no lo incluye todavía.** Sin cotizador, PDF ni pagos (fases 10–12).

**Decisiones.**
(a) **Zona horaria fija UTC-6.** El catálogo es de El Salvador, que no usa horario de verano; un desfase fijo evita depender de `tzdata` en Windows. Si entran lugares de otros países, la zona pasa a ser una columna de `places`
y `schedule.py` es el único módulo que cambia.
(b) **Horario opcional y compatible:** sin horario cargado no se restringe por hora (así no se rompe la fase 8); los cierres puntuales cuentan siempre.
(c) **Tramos:** hasta 3 por día, en cuartos de hora, sin cruzar medianoche (un bar que cierra a las 02:00 se registra como dos tramos). La hora de cierre no admite entrada. Reemplazar todo el horario es atómico: si algo es inválido no cambia nada.
(d) **Disponibilidad pública pero acotada:** devuelve solo horarios de entrada y asientos libres, nunca quién reservó. Máximo 96 horarios por día, hoy a 90 días.
(e) **Lógica pura** en `domain/reservations/schedule.py`, probada sin base de datos; el caso de uso solo orquesta. La comprobación de horario se hace antes del bloqueo de cupo de la fase 8, que sigue garantizando la ausencia de sobreventa.
(f) Mismo límite de escrituras que las reservas (`RESERVATION_WRITE`).

**Pendiente / riesgos.** (1) Cambiar el horario o cerrar un día **no cancela** las reservas ya hechas en ese día: el negocio las rechaza o las cancela a mano (se ven en el calendario). (2) Sin horarios especiales por fecha (solo cierres de día completo)
ni cierres parciales. (3) La carrera entre cambiar el horario y reservar a la vez se resuelve a favor de la lectura previa: puede entrar una reserva justo al cerrar el día. (4) Sin avisos a las personas afectadas. (5) La web edita un tramo por día y
conserva los demás al guardar; no los muestra.

**Verificación.** Pruebas en `tests/places/test_place_schedule.py` contra PostgreSQL real, más pruebas de la lógica pura (16 horarios inválidos, comparación en hora local frente a UTC, hora de cierre excluida): 404 a quien no gestiona, leer y reemplazar horario,
cierres (alta, reemplazo, baja y 8 entradas inválidas), reservas dentro/fuera de horario y en día cerrado o sin horario, horarios libres con cupo restante, casos límite, calendario, reserva de madrugada contada en su día local, rango inválido, límite de uso y cascada.

## 26. Fase 10 — cotizador (2026-10-08)

**Alcance.** El negocio publica un catálogo de artículos con precio (por persona, unidad u hora); una persona elige cantidades y recibe una cotización con el total calculado por el servidor, válida 7 días, opcionalmente
enlazada a una reserva suya. El negocio ve las cotizaciones que le piden. Backend y web. **La app móvil no lo incluye todavía.** No hay impuestos, descuentos, depósitos ni pagos. La aceptación y el PDF llegan en la fase 11 (§27).

**Decisiones.**
(a) **El total es del servidor, en enteros.** El cliente solo manda artículo y cantidad. Los precios se leen del catálogo DENTRO de la misma transacción que crea la cotización (`FOR SHARE`), así no se cotiza con un precio que cambió a mitad de camino.
Se rechaza cualquier `float`, texto o `bool` como precio o cantidad, y los importes se formatean con aritmética entera (`divmod`), nunca con coma flotante. Un precio máximo (1 000 000,00 USD) y una cantidad máxima (10 000) acotan el total.
(b) **Instantánea inmutable:** cada línea copia nombre, unidad y precio. Editar o borrar el catálogo no cambia cotizaciones emitidas (la clave hacia el artículo es `SET NULL`).
(c) **Moneda USD fija** (la de El Salvador). Precios sin impuestos añadidos: el precio publicado es el que se cobra; el IVA, si aplica, lo incluye el negocio en el precio.
(d) **Acceso:** el catálogo lo edita solo quien gestiona el lugar; lo lee cualquiera con sesión (solo activos). Una cotización la ven quien la pidió y quien gestiona ese lugar; moderación no, salvo por los canales de moderación existentes.
(e) **Abuso:** máximo 30 artículos activos por lugar (con bloqueo de la fila del lugar), 20 líneas por cotización, 30 escrituras/hora.
(f) Enlazar una reserva exige que sea del mismo usuario y del mismo lugar.

**Pendiente / riesgos.** (1) Sin aceptación ni conversión de la cotización en cobro: es informativa. (2) Sin impuestos ni descuentos. (3) Sin notificación al negocio de una cotización nueva. (4) Un negocio puede poner precios engañosos: la mitigación
es el reporte de datos de lugar y la auditoría, no esta fase. (5) La cotización no reserva cupo. (6) Una cotización vence a los 7 días pero sigue visible; no hay estado «vencida» ni limpieza.

**Verificación.** 54 pruebas en `tests/places/test_place_quotes.py` contra PostgreSQL real (cálculo puro con enteros y formato de dinero, 16 líneas inválidas, 404 a quien no gestiona, 14 artículos inválidos sin guardar, nombres únicos y tope,
total calculado por el servidor, precios/totales inyectados ignorados, copia inmutable tras editar y borrar el catálogo, artículos ajenos, inactivos o inexistentes sin guardar nada, reserva ajena, límite de uso, quién ve cada cotización,
exportación, borrado de cuenta y de lugar). La suite completa del backend (fases 1–9) dio 1542 passed.

## 27. Fase 11 — decisión y PDF de la cotización (2026-10-09)

**Alcance.** Quien gestiona el lugar acepta o rechaza una cotización pendiente y vigente; quien la pidió y quien gestiona pueden descargarla como PDF. Backend y web. En la **app móvil** se ve el estado y quien gestiona puede aceptar o rechazar; **la descarga del PDF no está en la app** (necesita escribir y compartir archivos, una dependencia nativa y una build nueva). Sin pagos, impuestos, descuentos ni depósitos. Esta sección fija el alcance de la fase 11, que el ADR solo mencionaba como «PDF» (§6): se amplía a la aceptación porque §26 dejó esa carencia anotada. **La fase 12 se propone en §28** y no se construyó.

**Decisiones.**
(a) **La decisión es solo un estado** (`pending` → `accepted` | `rejected`), con `decided_at` y `decided_by`. No cobra, no reserva cupo, no cambia total ni líneas.
(b) **Una sola vez y solo si está vigente.** La fila se bloquea (`FOR UPDATE`), así dos gestores a la vez no deciden dos veces: el segundo recibe `409`. Una cotización vencida (`valid_until`) no se puede decidir, también `409`.
(c) **Solo decide quien gestiona ese lugar** (`place_managers`); quien la pidió, moderación y cualquier otra cuenta reciben el mismo `404`. La cotización se busca por `(quote_id, place_id)`, así un gestor no puede decidir cotizaciones de otro lugar.
(d) **PDF sin dependencias**: generador propio de PDF 1.4 (`infrastructure/pdf/quote_pdf.py`) con Helvetica estándar y codificación WinAnsi (tildes y ñ). Se evitó añadir una librería (`reportlab`, `fpdf2`) por una sola página de texto. Los caracteres que WinAnsi no representa (emoji, etc.) salen como `?`.
(e) **El PDF no calcula nada.** Dibuja los importes guardados y ya formateados por el servidor. Los textos del usuario (negocio, artículos, nota) se limpian y se escapan `\`, `(` y `)` para que no puedan cerrar la cadena e inyectar operadores.
(f) La descarga web es una petición autenticada que devuelve el binario y lo guarda con un enlace temporal, el mismo patrón que la exportación de datos; el PDF nunca tiene una URL pública ni firmada.

**Pendiente / riesgos.** (1) La persona **no recibe aviso** de la decisión: lo ve al abrir la cotización. (2) Una cotización aceptada **no genera reserva ni cobro** y el negocio puede cambiar precios después sin afectarla. (3) No se puede deshacer una decisión. (4) El PDF es de una sola fuente y diseño fijo; no lleva logo ni datos fiscales y no es una factura. (5) La alineación de importes usa anchos aproximados de Helvetica. (6) Las cotizaciones anteriores a esta fase quedan `pending`.

**Verificación.** `tests/places/test_quote_decision.py`, 23 pruebas (4 del PDF puro y el resto contra PostgreSQL real): documento válido, tabla `xref` con los desplazamientos correctos y paginación, tildes y ñ en WinAnsi, escape de texto hostil, caracteres fuera de WinAnsi; decisión (nueva en `pending`, aceptar, rechazar, solo una vez, vencida, 7 cuerpos inválidos, `404` a quien pidió/moderación/otro lugar, campos extra ignorados, estado en el listado); PDF (descarga de ambas partes, privado, muestra el estado). El PDF se abrió además con un lector independiente (PyMuPDF) para comprobar el texto y el diseño.

## 28. Fase 12 — avisos de Places (aprobada e implementada, 2026-10-10)

**Por qué esta fase.** El ADR no definía la fase 12 (§6 solo decía «8–12 … PDF»). Se propone a partir de lo que las fases 5 a 11 dejaron anotado como pendiente: **ninguna acción de Places avisa a la otra persona**. Cada «Pendiente / riesgos» lo repite: invitaciones a planes (§ planes, punto a), resolución de reclamos (§22), reservas (§24, punto 1), cotizaciones (§26, punto 3) y su decisión (§27, punto 1). Hoy la otra parte se entera solo al abrir la pantalla. Es el hueco más repetido y el que más afecta al uso real: un negocio que no ve una reserva nueva no la atiende.

**Estado.** El alcance de abajo fue aprobado por el propietario del proyecto el 2026-10-10 y se implementó; las correcciones que salieron al construirlo están en «Resultados» al final de esta sección. **Alcance.** Reutilizar la bandeja que ya existe (`notifications`, `ADR-008`) con tipos nuevos; no hay correo, notificaciones push ni mensajes en esta fase.

| Evento | Quién recibe | Tipo |
|---|---|---|
| Nueva solicitud de reserva | Quien gestiona el lugar | `place_reservation_new` |
| Reserva confirmada o rechazada | La persona que reservó | `place_reservation_decided` |
| Reserva cancelada por la persona | Quien gestiona el lugar | `place_reservation_cancelled` |
| Nueva cotización pedida | Quien gestiona el lugar | `place_quote_new` |
| Cotización aceptada o rechazada | La persona que la pidió | `place_quote_decided` |
| Invitación a un plan | La persona invitada | `place_plan_invite` |
| Reclamo aprobado o rechazado | Quien lo envió | `place_claim_decided` |
| Respuesta del negocio a una reseña | Quien la escribió | `place_review_reply` |

**Decisiones que hay que tomar antes de implementar** (cada una cambia el modelo; ninguna se da por aprobada):
(a) **El modelo actual solo enlaza a una publicación** (`post_id`) y exige `actor_id`. Hacen falta columnas opcionales `place_id` y un identificador del objeto (reserva, cotización, plan o reclamo), y decidir si `actor_id` pasa a admitir nulo para los eventos del sistema. Propuesta: **nulo en `place_claim_decided`**, para no mostrar qué cuenta de moderación decidió.
(b) **Un solo aviso por objeto y estado**, con restricción única, para que reintentos o dobles clics no generen duplicados.
(c) **Qué se enseña.** Texto mínimo: tipo, nombre del lugar y fecha. Nunca la nota de la reserva ni el contenido de la cotización, para que la bandeja (y cualquier vista previa futura) no filtre datos del negocio ni de la persona.
(d) **Quién gestiona = todos los gestores del lugar**, no solo la persona que lo reclamó. Con muchos gestores, un solo evento genera una fila por cada uno.
(e) **Bloqueos.** Hoy los bloqueos entre persona y gestor no se aplican a las reservas (§24, punto 6). Propuesta: **tampoco generan aviso** si existe un bloqueo en cualquier dirección, para no usar la bandeja como canal de acoso.
(f) **Web y móvil muestran los tipos nuevos** con el texto y el destino de cada uno (la ficha del lugar, la reserva o la cotización). La app móvil necesita añadir los tipos nuevos a su lista de renderizado; **no requiere dependencias nativas ni build nueva**.

**Fuera de alcance:** notificaciones push, correo, avisos de recordatorio («tu reserva es mañana»), preferencias para silenciar tipos, y cualquier cambio de las reglas de reservas o cotizaciones.

**Seguridad y abuso.** El aviso se crea en el servidor dentro del caso de uso, nunca por una ruta que el cliente pueda llamar. El número de avisos por persona está acotado por los límites que ya tienen reservas (5 activas) y cotizaciones (30 escrituras por hora). Borrado de cuenta y de lugar: los avisos van en cascada (`ADR-031`). Exportación de datos (`ADR-028`): se incluyen solo los avisos recibidos por la persona.

**Criterios de aceptación.** (1) Cada evento de la tabla crea exactamente un aviso por destinatario, y repetir la acción no lo duplica. (2) Quien no es destinatario no puede leerlo ni marcarlo como leído (404, mismo criterio que hoy). (3) Ningún aviso contiene texto libre del usuario. (4) Con bloqueo entre las partes no se crea el aviso. (5) Borrar la cuenta o el lugar elimina los avisos. (6) La app móvil y la web muestran los tipos nuevos; la app móvil abre el destino correcto (el panel del negocio o la ficha del lugar). (7) La suite completa pasa y `test_account_deletion.py` sigue reconociendo todas las claves a `users`.

**Verificación prevista.** Pruebas contra PostgreSQL real en `tests/places/test_place_notifications.py` para cada evento, la unicidad, el bloqueo, los varios gestores, la cascada y la exportación; pruebas puras del formato del aviso; y, para la app, comprobación en un teléfono real de que cada tipo se ve y navega.

**Riesgos.** (1) Cambiar el modelo de `notifications` toca una tabla usada por likes, comentarios y seguidores: la migración debe ser aditiva (columnas opcionales) y las pruebas de esas funciones deben seguir pasando. (2) Un gestor con muchas reservas recibe muchos avisos; sin agrupación ni silenciado puede resultar molesto. (3) Sin push ni correo, un aviso solo se ve al abrir la app: reduce el problema pero no lo elimina. (4) Enumeración: el aviso confirma al destinatario que la otra parte existe y actuó; es información que ya tiene (la reserva o cotización es suya o de su lugar).

**Alternativas descartadas.** (a) *Notificaciones push o correo primero:* añaden un proveedor externo y consentimiento, y la bandeja interna ya existe. (b) *Un chat entre negocio y cliente:* es otro producto (mensajería con roles) y no está en el alcance de ninguna fase. (c) *Convertir una cotización aceptada en reserva:* mezcla dos máquinas de estado y el cupo; se evalúa aparte.

### Resultados de la fase 12

**Qué se hizo.** Migración aditiva `b3e7d1a9c486`; ocho tipos de aviso; un mixin (`place_notifications.py`) que cada repositorio de Places usa tras su acción; presentador con `place`, `object_id` y `detail`; la lista de avisos y la exportación toleran un actor nulo; web y móvil muestran los tipos nuevos. Sin endpoints nuevos y sin dependencias nativas (la app no necesitó build nueva).

**Correcciones al alcance aprobado.**
(1) **«Cancelada por el negocio» no existe:** el negocio solo confirma o rechaza una reserva pendiente (§24), así que ese evento se quitó de la tabla. La persona sí puede cancelar y eso avisa al negocio.
(2) **Un reclamo aprobado también rechaza el resto de reclamos pendientes del lugar (§22):** esas personas reciben su aviso de «rechazado», también sin actor.
(3) **La web no navega al tocar un aviso** (tampoco lo hacía con los tipos anteriores: solo lo marca como leído). La app móvil sí abre el panel o la ficha. El criterio 6 se ajustó a eso.
(4) **El texto del aviso lo ponen los clientes**, no el servidor; un tipo o estado desconocido cae en un texto genérico en vez de romper la lista.
(5) **Al construirlo apareció un caso que el diseño no contemplaba:** con un actor nulo, el filtro de cuentas bloqueadas (`actor_id NOT IN (...)`) devuelve nulo y **ocultaba** el aviso de reclamo a quien tuviera algún bloqueo. Se corrigió y hay una prueba.
(6) **Fallo del aviso:** se registra y la acción ya hecha no se deshace; hay una prueba que lo simula.

**Pendiente / riesgos.** (1) Sin push ni correo: el aviso se ve al abrir la app (en la app se consulta al abrir la pestaña y cada 30 s). (2) Cambiar la respuesta a una reseña no vuelve a avisar, por el índice único. (3) Un plan al que se invita de nuevo a alguien que ya era integrante no avisa otra vez. (4) `object_id` no tiene clave foránea: si se borra la reserva, cotización, plan o reseña de origen, el aviso queda apuntando a algo que ya no existe (se borra con el lugar y con la cuenta, no con el objeto). (5) No hay agrupación ni silenciado: un negocio con muchas reservas recibe un aviso por cada una.

**Verificación.** 17 pruebas en `tests/places/test_place_notifications.py` contra PostgreSQL real: cada evento, quién recibe y quién no, varios gestores, unicidad, edición de la respuesta, bloqueo en las dos direcciones, que el aviso no lleve texto libre, marcar como leído solo el destinatario, aviso sin actor con bloqueos, fallo del aviso sin romper la acción, cascada al borrar el lugar, restricciones de la base y exportación. 5 pruebas puras en la app (`tests/place-notices.test.mjs`) y 6 en la web (`tests/placeNotices.test.mjs`). Comprobado en un Moto Z3: los avisos de reserva y cotización llegan al gestor y, al tocarlos, abre «Mi negocio».

## 29. Fase 13 — rutas hacia un lugar (aprobada e implementada, 2026-10-10)

**Estado.** Alcance aprobado por el propietario del proyecto el 2026-10-10 e implementado; las diferencias con lo escrito abajo están en «Resultados» al final. **Decisión de proveedor (D2, tomada por el propietario del proyecto el 2026-10-10): OpenRouteService (ORS)** detrás de una abstracción. El ADR exigía «proveedor de routing abstraído» (§6) y que el proveedor «nunca esté fijo en el código» (§4.6): ORS es la primera implementación, no una dependencia del dominio.

**Alcance.** Una persona con sesión, desde la ficha de un lugar, pide cómo llegar: distancia, duración y la línea de la ruta dibujada en el mapa, a pie, en bicicleta o en carro. Backend, web y móvil. **Sin ruta con paradas, sin guardar rutas ni historial, sin tráfico en vivo.** (La lista de indicaciones calle por calle se añadió después, a pedido del propietario: ver «Ampliación de la fase 13».)

**Cómo funciona.**
- Nuevo endpoint autenticado `GET /api/places/<id>/route?from_lat=&from_lng=&profile=walk|bike|car`. El navegador o la app **nunca hablan con ORS**: lo hace el backend, así la clave de API no sale del servidor.
- Respuesta: `{distance_m, duration_s, profile, geometry}`, donde `geometry` es una línea (GeoJSON `LineString`) simplificada para el mapa. El destino es siempre el punto del lugar guardado en la base: **el cliente no manda el destino**, solo el origen.
- Perfiles traducidos en el backend: `walk` → `foot-walking`, `bike` → `cycling-regular`, `car` → `driving-car`. Cualquier otro valor, `400`.

**Decisiones que hay que tomar antes de implementar** (ninguna se da por aprobada):
(a) **Privacidad del origen.** La ubicación de la persona es opcional y solo se pide con el botón de la mira (§6 y fase 3). Aquí **sale del sistema**: el origen viaja a un tercero (ORS, operado por HeiGIT, en Alemania). Propuesta: el cliente redondea el origen a 3 decimales (~110 m) como ya hace con «cerca de ti»; el servidor lo vuelve a redondear (no confía en el cliente); **no se guarda en ninguna tabla ni en logs** (ni siquiera el *query string*, como en §4.4) y la pantalla avisa antes del primer uso de que la ubicación se envía a un proveedor de rutas. Hay que añadirlo a la política de privacidad.
(b) **Presupuesto del proveedor.** El plan gratuito de ORS permite unas 2.000 rutas al día y 40 por minuto (según su página de planes, a verificar antes de implementar). Propuesta: un contador **global** diario por debajo de ese tope (configurable, por ejemplo 1.500) con la tabla de límites que ya existe; al agotarse, `503` con un mensaje claro y el resto de la app sigue igual. Además, un límite **por persona** (propuesta: 30 por hora) para que una cuenta no gaste el cupo de todas.
(c) **Caché.** Misma ruta (lugar, origen redondeado y perfil) durante una hora se sirve sin llamar al proveedor. Reduce el gasto del cupo y es coherente con (a): el origen ya está redondeado.
(d) **Uso comercial.** El plan gratuito de ORS no está pensado para un producto comercial. **Mientras THERS sea un proyecto no comercial no hay problema; antes de publicarlo como negocio hay que pedir una cuota comercial por escrito o cambiar de proveedor** (Mapbox o un servidor propio con OSRM/Valhalla). Igual que ya consta para MapTiler (§14). La abstracción existe precisamente para que ese cambio no toque la app.
(e) **Fallos del proveedor.** Tiempo máximo de espera corto (propuesta: 8 s). Ruta imposible o demasiado larga → `422` con mensaje; proveedor caído, sin clave o sin cupo → `503`. Nunca un `500` con el texto del proveedor.
(f) **Atribución.** ORS exige atribuir a OpenRouteService y a OpenStreetMap donde se muestre la ruta; la pantalla de la ruta lo incluye.

**Configuración.** Variables nuevas, **solo en el servidor** (`backend/.env.example`): `ROUTING_PROVIDER` (por ahora `openrouteservice`), `ROUTING_API_KEY`, `ROUTING_DAILY_BUDGET`. Sin clave, el endpoint responde `503` y la ficha esconde el botón «Cómo llegar». Nada de esto va en el bundle de la app ni de la web.

**Estructura prevista.** Puerto `RoutingProvider` en `domain/` (recibe origen, destino y perfil; devuelve distancia, duración y geometría); adaptador `OpenRouteServiceProvider` en `infrastructure/`; caso de uso en `application/`; ruta en `interfaces/routes/`. Los casos de uso no conocen ORS.

**Fuera de alcance.** Navegación en vivo con la posición actual (giro a giro mientras se camina), rutas con varios lugares («ruta de un plan»), tiempo según la hora, rutas offline, guardar «mis rutas», compartir ruta por chat.

**Seguridad y abuso.** Requiere sesión (`401`). Solo lugares públicos (`404` idéntico al resto). Parámetros validados y acotados (`from_lat` ±90, `from_lng` ±180, perfil de una lista cerrada). La respuesta del proveedor **no se reenvía tal cual**: se extraen solo distancia, duración y geometría, con un tope de puntos para que una respuesta enorme no llegue al cliente. La clave nunca aparece en una respuesta, un log ni un mensaje de error.

**Criterios de aceptación.** (1) Con clave válida, cada perfil devuelve distancia, duración y una línea que empieza cerca del origen y termina en el lugar. (2) El destino sale de la base de datos, no del cliente. (3) El origen se redondea en el servidor y no queda guardado ni en la base ni en los logs. (4) Sin sesión `401`; lugar inexistente o no público `404`; perfil u origen inválidos `400`. (5) Misma consulta dentro de una hora no vuelve a llamar al proveedor. (6) Al agotarse el cupo global o el de la persona, `503` o `429` sin llamar al proveedor. (7) Proveedor caído, lento o sin clave → `503` sin filtrar texto del proveedor. (8) Web y móvil dibujan la ruta, muestran distancia y duración, la atribución y un aviso de privacidad antes del primer uso, y siguen funcionando si el endpoint falla. (9) La clave de API no aparece en ningún archivo del cliente ni del repositorio.

**Verificación prevista.** Pruebas contra PostgreSQL real con un proveedor **simulado** (las pruebas nunca llaman a ORS): validación, los cuatro códigos de error, redondeo del origen, caché, cupo global y por persona, respuesta enorme recortada y que la clave no salga en ninguna respuesta. Una prueba **real** y manual contra ORS con una clave de desarrollo, y comprobación en el Moto Z3 de que la línea se dibuja sobre el mapa. La fase 13 móvil usa MapLibre, que ya está instalado: **no necesita build nueva**.

**Riesgos.** (1) **Uso comercial y cuota**: ver (d) y (b). (2) **Privacidad**: el origen sale a un tercero; la mitigación es el redondeo, no guardarlo y avisar. (3) **Dependencia de un servicio gratuito** que puede cambiar sus condiciones o su cupo. (4) **Calidad de la ruta en El Salvador**: ORS usa datos de OpenStreetMap; donde el mapa esté incompleto la ruta puede ser mala o imposible, y a pie o en bicicleta es menos fiable que en carro. (5) El contador global de presupuesto cuenta intentos, no éxitos: una ráfaga de errores también lo gasta.

**Alternativas descartadas.** (a) *Llamar a ORS desde la app o la web:* expondría la clave en el cliente. (b) *El servidor público de demostración de OSRM:* sin garantías y puede bloquearnos. (c) *Servidor propio de OSRM o Valhalla:* sin límite de uso, pero hay que montarlo y mantenerlo; se reconsidera antes de publicar. (d) *Mapbox:* de pago por uso y pide tarjeta; se reconsidera antes de publicar.

### Resultados de la fase 13

**Qué se hizo.** Puerto `RoutingProvider` y validación pura en `domain/routing/`; adaptador de OpenRouteService con `urllib` (sin dependencias nuevas) y caché en memoria en `infrastructure/routing/`; caso de uso y endpoint `POST /api/places/<id>/route` (contrato en `API_CONTRACT.md` §4.33). Web y móvil: sección «Cómo llegar» en la ficha, con los tres modos, aviso de privacidad, atribución y la línea dibujada en el mapa. Sin build nueva para la app (MapLibre ya estaba).

**Diferencias con lo propuesto.**
(1) **POST en vez de GET:** la ubicación va en el cuerpo, no en la URL, para que no quede en los registros de acceso. Es lo que pedía el criterio (3) de «no en logs, ni siquiera el *query string*», y es más fuerte que lo que hacen «cerca de ti» y la búsqueda.
(2) **`routing_available`** en `GET /api/places/<id>` (no estaba en el alcance): hace falta para cumplir el criterio de esconder «Cómo llegar» sin clave sin que el cliente tenga que adivinar.
(3) **La caché es por proceso**, no compartida: con varios procesos del servidor cada uno tiene la suya y solo se gasta algo más de cupo.
(4) **El cupo global cuenta consultas reales al proveedor, no intentos de las cuentas:** una consulta servida desde la caché no gasta cupo. Un fallo del proveedor sí lo gasta.

**Prueba real contra OpenRouteService (2026-10-10).** Con una clave gratuita en `backend/.env` (ignorado por git) se pidió la ruta desde el centro de San Salvador a un lugar del catálogo: a pie 3.580 m y 43 min, en bici 3.549 m y 12 min, en carro 3.907 m y 7 min, con 73 a 88 puntos y el último punto en el destino. La consulta repetida se sirvió desde la caché, un origen en Madrid dio `422`, y la clave no apareció en el registro del servidor. En el Moto Z3 la línea sigue las calles reales (6,5 km a pie desde la ubicación del teléfono). **Sin la clave la función queda desactivada.**

**Pendiente.** (1) **Sin comprobar a fondo:** la calidad de las rutas en otras zonas de El Salvador (una sola ruta de prueba) y el comportamiento al agotar el cupo real del proveedor. (2) **Política de privacidad:** hay que añadir que la ubicación aproximada se envía a OpenRouteService para calcular rutas; el aviso en pantalla ya lo dice, la política escrita no se tocó. (3) **Uso comercial** (decisión D2 (d)): antes de publicar como negocio, pedir cuota comercial por escrito o cambiar de proveedor. (4) Las cifras del plan gratuito de ORS (2.000 rutas al día) salen de su página de planes y deben verificarse antes de depender de ellas. (5) La calidad depende de los datos de OpenStreetMap, que en zonas rurales pueden estar incompletos. (6) La web se comprobó con lint, compilación y pruebas, pero **no en un navegador**.

**Verificación.** 87 pruebas en `tests/places/test_place_routing.py` contra PostgreSQL real: validación pura y de la salida del proveedor, el adaptador con respuestas HTTP falsas (orden `[lon, lat]`, perfiles, códigos de error, fallos de red, basura, respuestas enormes, que la clave no salga en errores ni en logs), el endpoint (los tres perfiles, destino tomado de la base de datos y origen redondeado en el servidor, 400/401/404/422/429/503, caché, cupo por cuenta y global, la clave nunca en una respuesta, identidad del token) y el campo `routing_available`. Ninguna prueba llama a OpenRouteService (`conftest.py` vacía `ROUTING_API_KEY`). 6 pruebas puras en la app y 9 en la web. Comprobado en un Moto Z3 (con proveedor simulado): la sección se esconde sin proveedor; con proveedor pide la ubicación solo al tocar el botón, muestra duración y distancia, dibuja la línea con origen y destino encuadrados y recalcula al cambiar a bici o carro.

### Ampliación de la fase 13: ver la ruta de cerca y las calles (2026-10-10)

**Qué se pidió.** Al probar la ruta en el teléfono se vio que el mapa no se podía acercar ni mover y que no había forma de saber por qué calles ir. Eran dos problemas distintos.

**1. Defecto de la app: el mapa no recibía los gestos.** El mapa de la ficha estaba dentro de una pantalla con scroll, que se quedaba los gestos: el doble toque no acercaba y arrastrar desplazaba la pantalla, no el mapa. Ahora la ficha muestra una vista previa que **no** recibe toques (la pantalla se desplaza con normalidad) y un botón «Ver mapa grande y calles» que abre la ruta en **pantalla completa**, con un mapa que sí se acerca y se mueve. La web ya permitía acercar (rueda del ratón y botones + y −).

**2. Indicaciones calle por calle** (antes fuera de alcance, ahora dentro por decisión del propietario). El backend pide al proveedor el texto de cada paso en español o en inglés (`lang`) y devuelve `steps` con la instrucción, el nombre de la calle, la distancia, el tipo de maniobra y el punto donde empieza (contrato en `API_CONTRACT.md` §4.33). **Tocar un paso acerca el mapa a esa calle** (en la app y en la web), donde ya se leen los nombres de las calles. Las indicaciones son secundarias: si el proveedor no las da o vienen malformadas, la ruta se muestra igual, sin lista.

**Decisiones.** (a) El texto lo escribe el proveedor, así que se limpia (sin caracteres de control) y se acota antes de llegar al cliente. (b) La caché de rutas pasa a ser por idioma. (c) Sin cambios de privacidad: el origen se envía igual de redondeado y los nombres de calle son datos públicos del mapa. (d) La app solo pide español; la web pide el idioma de la persona.

**Pendiente / riesgos.** (1) **No es navegación en vivo:** no sigue la posición mientras la persona camina ni avisa de los giros. (2) El texto de los pasos depende de las traducciones del proveedor: en la prueba real salieron algunas frases torpes («Camina hacia el norte» en una ruta en carro, «Gire a la izquierda a 1a Calle Poniente»). (3) Muchas vías de OpenStreetMap no tienen nombre y salen como «Vía sin nombre». (4) El doble toque y el pellizco para acercar **no se pudieron probar con `adb`** (no genera gestos de dos dedos ni toques con la rapidez necesaria); se comprobó que arrastrar mueve el mapa y que tocar un paso lo acerca, pero conviene que alguien lo pruebe a mano en el teléfono. (5) El mapa grande no tiene botones + y −.

**Verificación.** Pruebas del backend ampliadas en `tests/places/test_place_routing.py` (idioma, limpieza y topes de los pasos, 14 formas de pasos inválidas que dejan la lista vacía sin romper la ruta, el adaptador con y sin pasos, caché por idioma). Pruebas puras nuevas en la app y en la web. Ruta real contra OpenRouteService en español e inglés: 8 pasos con nombres de calle. Navegador (Chrome): la lista aparece, tocar un paso acerca el mapa y se leen los nombres de las calles. Teléfono: la vista previa deja de capturar gestos, el mapa grande se abre y se mueve, y tocar un paso acerca hasta ver «Diagonal Cipactly» y «37 Calle Oriente».

## 30. Fase 13 (continuación) — navegación en vivo en la app (aprobada por el propietario, 2026-10-10)

**Pedido.** «Hazlo como Waze y Google Maps: con la pantalla encendida, que recalcule rutas y con una voz». Solo la **app móvil**; la web no lo incluye (se evalúa aparte).

**Alcance.** Desde una ruta ya calculada (§29), la persona toca **«Iniciar navegación»** y la app:
1. Sigue su posición **mientras la pantalla de navegación esté abierta** y mueve el punto sobre el mapa; el mapa la acompaña y gira según su dirección.
2. Muestra la **próxima maniobra** («en 120 m, gire a la izquierda en 1a Calle Poniente»), la distancia y el tiempo que faltan, y avanza de paso sola.
3. **Habla** cada indicación (a distancias según el modo: a pie, bici o carro) y avisa «Llegaste». La voz se puede silenciar.
4. **Mantiene la pantalla encendida** mientras navega.
5. **Recalcula** la ruta si la persona se sale (más de ~40 m durante varias lecturas) y lo dice en voz alta.
6. Termina al llegar, al tocar «Terminar» o al cerrar la pantalla.

**Fuera de alcance (decidido).** Ubicación en **segundo plano** o con la pantalla apagada (§ «nivel C»: servicio en primer plano, permiso especial, declaración en Google Play, batería de cada fabricante); tráfico en vivo; guardar el recorrido; compartir la posición con otras personas; web; iOS.

**Decisiones de privacidad (aprobadas con el pedido).**
(a) **Seguimiento voluntario y acotado.** Solo empieza al tocar «Iniciar navegación», tras un aviso que lo explica; solo con la app abierta; se detiene al terminar, al cerrar y al pasar la app a segundo plano. **La posición exacta nunca se guarda ni se envía:** se queda en el teléfono y solo sirve para dibujar el punto y calcular el paso. Esto cambia la regla de «una sola lectura, sin seguimiento» de §6 y de la fase 3, **solo para esta función**; hay que reflejarlo en la política de privacidad.
(b) **Recalcular necesita un origen más preciso.** El origen de una ruta normal se redondea a ~110 m (3 decimales); un recalculo se redondea a ~11 m (4 decimales), porque con 110 m la ruta nueva saldría de otra calle. Esa posición sí llega a nuestro servidor y a OpenRouteService, **solo al recalcular** y nunca guardada. El servidor solo acepta el origen preciso con una marca explícita (`precision: "high"`).
(c) **Cupo.** Cada recalculo cuenta contra el cupo diario global del proveedor. Límite aparte por cuenta (30 recalculos por hora, independiente del de rutas normales) y un mínimo de 30 s entre recalculos en la app.

**Cómo funciona.** Casi toda la lógica es local y pura (sin red): proyectar la posición sobre la línea de la ruta, saber cuánto se avanzó, qué paso toca y cuánto falta, decidir cuándo hablar y cuándo recalcular. La red solo interviene al recalcular. Se usan dos librerías nativas nuevas (`expo-keep-awake` y `expo-speech`), por lo que la app **necesita una compilación nueva** una sola vez.

**Criterios de aceptación.** (1) El punto sigue a la persona y el mapa la acompaña. (2) El paso actual y la distancia a la próxima maniobra se actualizan y avanzan solos. (3) La voz dice cada maniobra una sola vez por umbral y «Llegaste» al final; se puede silenciar. (4) La pantalla no se apaga mientras navega y vuelve a su comportamiento normal al terminar. (5) Salirse de la ruta dispara **un** recalculo (no varios seguidos) y la ruta nueva reemplaza a la anterior. (6) Una lectura con mala precisión no provoca recalculos. (7) La posición exacta no se guarda ni se envía; el origen del recalculo va a ~11 m y solo con `precision: "high"`. (8) Al cerrar o pasar a segundo plano se deja de leer la ubicación. (9) El servidor rechaza `precision` con valores fuera de la lista y no devuelve nada más preciso que 4 decimales. (10) Sin ubicación, sin permiso o sin red, la app lo dice y no se queda colgada.

**Verificación prevista.** Pruebas puras de toda la lógica (proyección, avance, pasos, umbrales de voz, desvío, llegada, GPS impreciso) y del servidor (precisión, cupo aparte). En el teléfono: una **simulación solo de desarrollo** (`__DEV__`) que recorre la ruta con posiciones falsas, para ver la voz, el avance, el desvío con recalculo y la llegada sin salir a caminar. Moverse de verdad por la calle queda para quien lo pruebe.

**Riesgos.** (1) **No es lo mismo que probarlo en la calle:** el GPS real tiembla, hay túneles y calles paralelas; la lógica se probó con recorridos simulados. (2) El teléfono de pruebas es Android 9; los permisos y la voz pueden comportarse distinto en Android 14. (3) Si la pantalla se apaga a mano o la app pasa a segundo plano, el seguimiento se detiene (es lo decidido). (4) La calidad de la voz depende del motor de síntesis del teléfono. (5) El cupo gratuito de rutas es pequeño: una persona que se sale muchas veces gasta recalculos de todos.

### Resultados de la navegación en vivo (2026-10-10)

**Qué se hizo.** Backend: `precision` en `POST /route` con su límite aparte (contrato en §4.33). App: motor de navegación puro (`navigation.ts`: proyección sobre la ruta, paso actual, voz por umbrales, desvío, llegada), hook `useNavigation` (ubicación en vivo, voz, pantalla encendida, recálculo), pantalla completa con la maniobra grande arriba, tiempo y hora de llegada abajo, botón de voz y de terminar, y un mapa que acompaña a la persona con botón «Recentrar» si lo mueve. Dos librerías nativas nuevas (`expo-keep-awake` y `expo-speech`): **la app necesitó una compilación nueva**. Solo móvil; la web no lo incluye.

**Diferencias con lo propuesto.** (1) **Aviso previo:** antes de empezar sale un cuadro que explica qué se lee y qué se envía (criterio de privacidad (a)). (2) **La voz es `es-MX`** y la lee el motor de síntesis del teléfono. (3) **Herramienta de desarrollo:** en builds de desarrollo (`__DEV__`) hay un panel «Solo desarrollo» con «Simular recorrido» y «Salirme de la ruta»; no existe en una build de producción. (4) El recálculo reemplaza la ruta y **reinicia el avance al inicio de la ruta nueva**, que sale del punto donde estaba la persona.

**Comprobado.** Teléfono (Moto Z3, Android 9) con recorridos **simulados**: la maniobra y la distancia cambian solas y el mapa acompaña al punto; la voz se oye (30 síntesis en un recorrido completo, `es-US`/`es-MX` del motor de Google); la pantalla se mantiene encendida; al llegar dice «Llegaste a Café Aurora» y deja de seguir; al «salirme de la ruta» recalcula **una vez** (un solo pedido nuevo al servidor, con el cupo aparte: 3 recálculos y 1 ruta normal contados por separado) y continúa por la ruta nueva. 28 pruebas puras nuevas del motor (proyección, ruta que pasa dos veces por el mismo sitio, pasos, desvío con GPS impreciso, mínimo entre recálculos, umbrales de voz, un recorrido completo simulado).

**No comprobado (hay que probarlo en la calle).** (1) **Caminar o conducir de verdad:** el GPS real tiembla, hay túneles y calles paralelas; todo se probó con posiciones simuladas. (2) **Pantalla apagada a mano:** el seguimiento se detiene (es lo decidido); no se probó cómo se comporta cada fabricante. (3) **Android actual:** el teléfono de pruebas es Android 9; los permisos y la voz pueden comportarse distinto en Android 14. (4) **Otras voces:** solo se oyó la del motor de Google; sin voz en español instalada, la síntesis puede fallar en silencio. (5) La prueba de los nuevos límites del backend (`precision`, cupo aparte) está escrita y **no se ha ejecutado** por la ocupación de la base de pruebas.

**Pendiente.** (1) **Política de privacidad escrita:** añadir que la ubicación se lee en vivo mientras se navega y que, al recalcular, se envía a ~10 m a nuestro servidor y a OpenRouteService; el aviso en pantalla ya lo dice. (2) El recálculo gasta cupo del proveedor (1.500 al día para toda la app): una zona con mala señal puede gastar muchos. (3) Sin ubicación en segundo plano ni voz con la pantalla apagada (nivel C, fuera de alcance). (4) El mapa de la navegación no tiene botones + y −. (5) La web no tiene navegación en vivo.

## 31. Fase 16 (parte 1) — estadísticas para quien gestiona un lugar (2026-10-10)

**Pedido.** El propietario pidió empezar las fases posteriores por «la analítica del negocio». Se hace la parte que **no necesita datos nuevos**: contar, por día, lo que ya existe en la base. **Pulse (fase 15), las recomendaciones (fase 14) y el registro de eventos nuevos como «alguien abrió la ficha» quedan fuera** (necesitan actividad real o un registro nuevo de comportamiento, con su propia decisión de privacidad).

**Alcance.** Un nuevo `GET /api/places/<id>/manage/analytics?days=7|30|90` (por defecto 30), solo para quien gestiona el lugar (`404` al resto, como todo `/manage/*`). Devuelve, para el periodo y el anterior de igual duración:
- **Serie diaria** de: reseñas nuevas, solicitudes de reserva, solicitudes de cotización, publicaciones con el lugar, y (con restricción, ver abajo) guardados y planes creados.
- **Totales:** reseñas y calificación media del periodo; reservas pedidas, confirmadas, rechazadas, canceladas, pendientes y personas confirmadas; cotizaciones pedidas, aceptadas, rechazadas y pendientes, con el **valor total de las aceptadas**; publicaciones.
- **Comparación** con el periodo anterior (cantidad y porcentaje).
Web y móvil muestran un bloque «Estadísticas» en el panel del negocio: selector de periodo, tarjetas con la variación y un gráfico de barras por día.

**Decisiones de privacidad (las tomo yo por ser lo más conservador; el propietario puede cambiarlas).**
(a) **Solo conteos agregados:** nunca un identificador, un nombre ni una lista de personas. El panel ya prometía «solo cifras agregadas: nunca quién guardó el lugar ni quién va a un plan» y se mantiene.
(b) **Mínimo para mostrar lo sensible.** Guardados y planes creados solo se muestran si el periodo suma **al menos 5**; por debajo, el servidor devuelve `null` (no «0») y lo lista en `hidden`. Con menos gente, un número diario permitiría deducir quién fue. Es el mismo mínimo que se aplicará a Pulse. Reseñas, reservas, cotizaciones y publicaciones no se ocultan: quien gestiona ya las ve una por una.
(c) **El valor de las cotizaciones aceptadas** es dinero que el negocio ya conoce (las acepta él mismo).
(d) **No se guarda nada nuevo.** No hay tablas, columnas ni migraciones: se calcula al pedirlo, desde las tablas existentes. No cambia la exportación ni el borrado de cuenta.

**Decisiones técnicas.** (1) Los días son de **hora de El Salvador (UTC-6)**, como el horario y el calendario (§25). (2) Los días sin actividad vienen con 0 (la serie siempre tiene un valor por día). (3) La lógica de armar la serie, ocultar y comparar es **pura** (`domain/analytics/`), probada sin base de datos. (4) Una sola consulta por métrica sobre el rango de ambos periodos. (5) Límite de uso por cuenta (60 por minuto). (6) La variación es `null` cuando el periodo anterior fue 0 (no se inventa un «infinito %»).

**Fuera de alcance.** Visitas a la ficha, clics en teléfono o web, búsquedas que encontraron el lugar (requieren registrar comportamiento); comparación con otros lugares; exportar a CSV; avisos automáticos; analítica para moderación o para la plataforma entera.

**Criterios de aceptación.** (1) Solo quien gestiona el lugar la ve; el resto, `404`. (2) `days` fuera de 7, 30 y 90 da `400`. (3) La serie tiene un valor por día del periodo, en hora de El Salvador, y cada día cuenta lo que ocurrió ese día. (4) Los totales coinciden con la suma de la serie. (5) Guardados y planes con menos de 5 en el periodo salen `null` y aparecen en `hidden`; con 5 o más se muestran. (6) La variación frente al periodo anterior es correcta y `null` si ese fue 0. (7) La respuesta no contiene ningún identificador de persona. (8) Las reseñas ocultas por moderación y los reclamos de otros lugares no cuentan. (9) Web y móvil muestran los números y el gráfico, el aviso cuando algo está oculto por pocos datos, y no se rompen sin actividad. (10) Sin cambios de esquema.

**Verificación prevista.** Pruebas puras de la lógica (rangos, relleno de días, supresión, variación, redondeos, dinero) y contra PostgreSQL real (404, 400, conteo por día con fechas en el borde de la medianoche local, estados de reservas y cotizaciones, supresión de guardados, aislamiento entre lugares, ausencia de identificadores). Comprobación visual en el teléfono y en el navegador.

**Riesgos.** (1) Con poca actividad los gráficos están casi vacíos: es la realidad de hoy, no un defecto. (2) El mínimo de 5 puede esconder datos en un lugar pequeño durante mucho tiempo. (3) Sin visitas a la ficha no se puede calcular una «tasa de conversión» (de ver a reservar), que es lo que más suele pedir un negocio. (4) Las consultas recorren tablas por `place_id` y fecha: con mucho volumen habría que añadir índices o precalcular.

### Resultados de las estadísticas del negocio (2026-10-10)

**Qué se hizo.** `GET /api/places/<id>/manage/analytics` (contrato en `API_CONTRACT.md` §4.34): lógica pura en `domain/analytics/place_analytics.py` (rango, relleno de días, ocultar lo sensible, variación), una consulta por métrica en `business_repository.analytics_rows`, caso de uso y ruta con límite de 60 por minuto. Web y app: bloque «Estadísticas» en el panel del negocio con selector de 7, 30 y 90 días, seis tarjetas con la variación, el detalle de reservas y cotizaciones (con el valor de las aceptadas) y un gráfico de barras por métrica. **Sin migraciones, sin tablas nuevas y sin registrar nada de nadie.**

**Diferencias con lo propuesto.** (1) **Un dígito de otro alfabeto** (como «٧») ya no se acepta en `days`: `int()` de Python lo habría tomado por 7. (2) El gráfico muestra una barra por día incluso a 90 días; las etiquetas del eje son solo la primera, la del medio y la última fecha.

**Defecto encontrado y corregido durante la verificación (no era de esta función).** Al ver el gráfico en el navegador salió **sin color**. La causa: los tokens de color de la web viven bajo `th-` en `tailwind.config.js` (`bg-th-brand`), pero **124 clases en 22 archivos** de `Frontend/src/features/places` usaban nombres sin prefijo (`bg-brand`, `text-on-brand`, `text-danger-fg`...) que Tailwind no genera: botones y chips activos, mensajes de error y enlaces de marca salían sin color desde la fase 3 de la web, sin que el build ni el lint lo avisaran. Se renombraron todas con una sustitución mecánica y se añadió `tests/placesColors.test.mjs`, que falla si reaparece un nombre sin prefijo o si alguna clase `th-` usada no existe en la configuración. Los cambios son solo de nombre de clase.

**Comprobado.** 49 pruebas del backend contra PostgreSQL real (404 a quien no gestiona, 400, serie completa a 7, 30 y 90 días, fechas en el borde de la medianoche local, estados y valor de cotizaciones, reseñas ocultas y otros lugares sin contar, guardados ocultos con menos de 5 y visibles con más, comparación con el periodo anterior, sin identificadores ni notas privadas en la respuesta, límite de uso) y 10 pruebas puras en la app y 9 en la web. Navegador (Chrome) con actividad de demostración en Café Aurora: aparecen las seis cifras, el gráfico a 7, 30 y 90 días tiene 7, 30 y 90 barras, a 7 días los guardados se explican como ocultos en vez de mostrar ceros, y quien no gestiona el lugar no ve el bloque.

**No comprobado.** (1) **Teléfono:** el bloque de la app compila y pasa sus pruebas, pero no se ha visto en el Moto Z3 (la conexión USB pidió autorización de nuevo). (2) Con actividad **real** y mucho volumen: las consultas filtran por `place_id` y fecha sin índice propio; hoy no hace falta. (3) Los datos de las capturas son de **demostración** (70 reservas, 14 cotizaciones y 9 guardados cargados con un script en `thers_dev`), no actividad de personas.

**Pendiente.** (1) Falta registrar visitas a la ficha para poder calcular una tasa de conversión (decisión de privacidad propia). (2) Exportar a CSV y comparar con otros lugares siguen fuera de alcance. (3) Pulse (fase 15, §32) usa el mismo mínimo de 5.

## 32. Fase 15 — Pulse del lugar (aprobada por el propietario e implementada, 2026-10-10)

**Pedido.** Seguir con la siguiente fase de Places. El ADR solo fijaba «Pulse solo agregada, nunca presencia exacta» y el mínimo de 5 (§31); el propietario eligió las dos decisiones abiertas: (a) medir **solo con datos que ya existen** y (b) mostrar **un nivel cualitativo**, no cifras.

**Alcance.** `GET /api/places/<id>/pulse` (público) devuelve `{"pulse": {"level", "window_days": 7}}`. `level` es `null` con menos de 5 eventos y, si no, `moving` (5–14), `active` (15–39) o `buzzing` (40 o más). Eventos de los últimos 7 días: reseñas visibles, guardados, planes activos creados y publicaciones con el lugar. Web y móvil muestran una etiqueta «Actividad reciente: …» bajo el nombre del lugar en la ficha, y no pintan nada si no hay nivel o la petición falla. **No** aparece en tarjetas ni en el mapa (evita una consulta por lugar), **no** hay Pulse por persona ni «quién está ahora», **no** se registra ninguna visita ni ubicación.

**Decisiones de privacidad (las tomo yo por ser lo más conservador; el propietario puede cambiarlas).** (1) El nivel se calcula sobre la **suma** de las cuatro fuentes y no se devuelve ningún conteo ni desglose, así que el nivel no revela quién guardó o reseñó. (2) Por debajo de 5 no se devuelve nada (`null`). (3) **Las publicaciones de cuentas privadas no cuentan**, las reseñas ocultas por moderación tampoco, ni los planes cancelados: el Pulse es público y no debe delatar actividad que el resto no puede ver. (4) Los umbrales (5, 15, 40) son una elección mía, sin datos reales que los respalden; viven en `domain/pulse/place_pulse.py` y se ajustan en un solo sitio. (5) Respuesta con `Cache-Control: public, max-age=300`.

**Decisiones técnicas.** Lógica pura en `domain/pulse/place_pulse.py` (umbral y etiqueta, sin base de datos); una sola consulta con cuatro subconsultas en `PlaceRepository.pulse_counts`; caso de uso `place_use_cases.get_pulse` con el mismo `404` que la ficha. **Sin migraciones, sin tablas nuevas, sin cambios en exportación ni borrado de cuenta.** Sin límite de uso propio: es de solo lectura, como el resto del catálogo público.

**Fuera de alcance.** Visitas a la ficha o «alguien abrió el lugar» (registro nuevo de comportamiento: decisión de privacidad aparte), Pulse por zona o ciudad, tendencias («sube/baja») y recomendaciones (fase 14).

**Criterios de aceptación.** (1) Sin sesión se puede leer. (2) Lugar inexistente, inactivo o no verificado da el mismo `404` que la ficha. (3) Menos de 5 eventos da `level: null`; de 5 a 14, `moving`. (4) Lo viejo (más de 7 días), lo oculto, lo cancelado y lo de cuentas privadas no cuenta. (5) La actividad de un lugar no afecta a otro. (6) La respuesta solo tiene `level` y `window_days`. (7) Web y móvil no muestran nada sin nivel y no se rompen si la petición falla.

### Resultados de la fase 15 (2026-10-10)

**Qué se hizo.** Backend, web y móvil como se describe arriba. Contrato en `API_CONTRACT.md` §4.35 (v0.55).

**Comprobado.** 15 pruebas nuevas del backend (`tests/places/test_place_pulse.py`: umbrales, suma ignorando valores raros, forma de la respuesta, lectura sin sesión, 404 idéntico, paso de `null` a `moving`, aislamiento entre lugares, lo viejo/oculto/privado/cancelado sin contar) contra PostgreSQL real, y toda la carpeta `tests/places` (873 pruebas) pasa en verde. Web: lint de los archivos tocados sin avisos, `npm run build` y 99 pruebas en verde. Móvil: `tsc --noEmit` limpio y 129 pruebas en verde (2 nuevas de la etiqueta).

**No comprobado.** (1) La etiqueta **no se ha visto en pantalla** (ni navegador ni teléfono) en esta entrega. (2) Los umbrales no se han contrastado con actividad real. (3) La suite completa del backend no se corrió; solo la carpeta `tests/places`.

**Pendiente.** Las recomendaciones (fase 14) y el registro de visitas (fase 16, parte 2) siguen sin hacerse.

## 33. Fase 16 (parte 2) — visitas anónimas a la ficha (2026-10-12)

**Pedido.** Seguir con la fase 16, parte 2. Al no haber todavía usuarios reales, el propietario aceptó construir la infraestructura completa y validarla con datos de demostración, sin calibrar nada. Las decisiones de privacidad las fijó el propietario aceptando mis valores por defecto (abajo).

**Decisiones (aceptadas por el propietario).**
1. **Sí se registran visitas**, pero solo como **contador anónimo por lugar, día local (UTC-6) y evento**. No hay `user_id`, IP, dispositivo, ubicación ni hora exacta. Por eso no entra en la exportación (ADR-028) ni en el borrado de cuenta (ADR-031) ni necesita retención por persona (ADR-037): no existe dato por persona.
2. **Eventos:** abrir la ficha (`view`), tocar el teléfono (`phone`), tocar el sitio web (`website`) y empezar «Cómo llegar» (`directions`). **Fuera:** búsquedas que encontraron el lugar (más invasivo), clics en el mapa, tiempo en pantalla.
3. **No se cuenta a quien gestiona el lugar.** Si llega un token de gestor, no se inserta nada; la respuesta es la misma `204`, así que no revela si se contó.
4. **Mínimo de 5**, el mismo de Pulse y de las estadísticas: con menos de 5 eventos en el periodo, el servidor devuelve `null` y lista `visits` en `hidden`.
5. **Aviso en la política de privacidad** (ver «Pendiente»).

**Alcance.** `POST /api/places/<id>/visits` (público, `204`, `API_CONTRACT.md` §4.36), tabla `place_visit_counts` (migración `c9d4a1e7b362`, PK `(place_id, day, event)`, `ON DELETE CASCADE` desde el lugar), y en `GET /api/places/<id>/manage/analytics` las visitas por día, el desglose por evento y la **tasa de conversión** (reservas + cotizaciones pedidas ÷ visitas a la ficha). Web y app registran el evento al abrir la ficha (una vez por lugar y carga de página/sesión de la app), al tocar teléfono o sitio web, y al pulsar «Cómo llegar»; el panel del negocio muestra las visitas, la conversión y el desglose.

**Decisiones técnicas.** Un solo `INSERT … ON CONFLICT DO UPDATE` que suma 1 (sin carreras) y que se salta la fila si el visitante gestiona el lugar. El evento se valida en `domain/visits/place_visits.py` (lista cerrada). Tope de uso por **IP y lugar** (30/hora) para que un script no pueda inflar cifras; la IP viene de `X-Forwarded-For`, que el cliente puede falsear, así que **no es una defensa fuerte** (ver riesgos). El cliente nunca muestra un fallo del registro. La lógica de ocultar y de la conversión es pura (`domain/analytics/place_analytics.py`). Los días sin visitas vienen con 0, como el resto de la serie.

**Datos de demostración.** `backend/scripts/seed_place_visits.py` siembra 1–365 días de visitas **inventadas**, solo para los lugares sembrados (`seed-*`), nunca uno real, y solo en una base local (o con `--allow-remote`, que no debe usarse contra producción). `--reset` borra esos contadores. **Esas cifras, su conversión y cualquier captura que salga de ellas no son resultados:** si se enseñan, hay que decir que son de demostración.

**Fuera de alcance.** Búsquedas que encontraron el lugar, clics en el mapa, tiempo en la ficha, visitas únicas o recurrentes (exigirían identificar a alguien), embudo por origen, exportar a CSV, comparar con otros lugares.

**Criterios de aceptación.** (1) Sin sesión se puede registrar; el cuerpo de la respuesta es vacío. (2) `event` fuera de los cuatro, cuerpo ausente o no objeto: `400`, y no se cuenta. (3) Lugar inexistente, inactivo o no verificado: el mismo `404` que la ficha, sin contar. (4) La tabla no tiene ninguna columna que identifique a alguien. (5) Las visitas de quien gestiona el lugar no se cuentan y la respuesta no lo delata. (6) Un token inválido es una visita anónima normal. (7) Más de 30 visitas por hora desde una IP a un lugar: `429`, sin pasar de 30 en el contador; otro lugar sigue funcionando. (8) Menos de 5 eventos en el periodo: `visits: null`, `hidden` con `visits`, `views` nulo en la serie. (9) El día local decide dónde cae cada visita; los datos de otro lugar no se mezclan. (10) Conversión `null` sin visitas a la ficha o con más solicitudes que visitas. (11) La respuesta del panel no contiene identificadores. (12) Web y app no se rompen si el registro falla.

### Resultados de la fase 16 parte 2 (2026-10-12)

**Qué se hizo.** Backend, web y app como arriba. Contrato en `API_CONTRACT.md` §4.36 (v0.56).

**Comprobado.** Backend: 43 pruebas nuevas (`tests/places/test_place_visits.py`: eventos válidos y rechazados, ocultar bajo 5, conversión, comparación con el periodo anterior, contador anónimo y sin `user_id`, visita de gestor no contada y sin delatarse, token inválido, 400 y 404, aislamiento entre lugares, tope por IP y lugar, borrado en cascada, borde del día local, sin identificadores) contra PostgreSQL real; con las 49 de estadísticas, **92 pasan**. Se actualizaron 4 pruebas de estadísticas que esperaban `hidden == ["saves", "plans"]` (ahora incluye `visits`) y `tests/conftest.py` (la tabla nueva entra en el `TRUNCATE`). Web: 106 pruebas en verde (las nuevas en `tests/placeVisits.test.mjs`, y `tests/placeRoute.test.mjs` adaptada: sigue exigiendo que la ubicación se pida solo al pulsar el botón, ahora junto al conteo), lint sin errores nuevos y `npm run build`. App: `tsc --noEmit` limpio y 137 pruebas en verde. El script de datos de demostración se probó contra `thers_dev`: 751 contadores en 30 días, la segunda corrida deja lo mismo y `--reset` deja 0.

**No comprobado.** (1) **Nada se ha visto en pantalla** (ni navegador ni teléfono): ni el bloque de visitas del panel, ni que los toques registren de verdad. (2) La suite completa del backend no se corrió, solo `tests/places`. (3) La tasa de conversión y los umbrales no significan nada sin actividad real. (4) El tope por IP no se probó detrás del proxy real.

**Riesgos.** (1) **Las cifras se pueden inflar:** el contador es anónimo y el tope por IP se puede esquivar cambiando `X-Forwarded-For`; sirve contra un descuido, no contra alguien decidido. Por eso la tasa de conversión debe leerse como indicativa. (2) Abrir la ficha cuenta una vez por carga de página/sesión de la app, pero sin identidad no se pueden distinguir visitas repetidas de la misma persona entre sesiones. (3) Las visitas anteriores a esta fase no existen: en un periodo con solicitudes pero sin visitas registradas la conversión sale `null`, no un número.

**Pendiente.** (1) **Política de privacidad:** el borrador V1 (`docs/legal/POLITICA_PRIVACIDAD_V1_BORRADOR.md`) declara que la V1 no trata ubicación ni otras funciones de Places; antes de publicar Places hay que actualizarla (también con los puntos de ubicación de la ruta, §29) y mencionar estos contadores anónimos. No se editó ese texto legal en esta fase. (2) La fase 14 (recomendaciones) sigue sin hacerse y espera actividad real.
