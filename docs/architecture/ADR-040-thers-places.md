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
| 6–7 | Reclamos de negocio y panel de negocio | **Bucket privado + URLs firmadas** (no existen); rol de gestor distinto de `is_moderator` |
| 8–12 | Reservas, calendario, cotizador, PDF | 6–7 y disponibilidad; restricciones/transacciones contra doble reserva; total siempre calculado en backend |
| 13 | Rutas | Proveedor de routing abstraído |
| 14–16 | Recomendaciones explicables, Pulse, analítica | Actividad real suficiente; Pulse solo agregada, nunca presencia exacta |

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
