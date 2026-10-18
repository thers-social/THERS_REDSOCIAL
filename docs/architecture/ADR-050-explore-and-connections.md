# ADR-050 — Explorar y listas de seguidores / seguidos

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por el
  propietario: una sección de Explorar con fotos y videos recomendados como la de Instagram, y ver la lista de
  seguidores y seguidos (propios y de otras personas) al tocar los contadores.
- **Relacionado:** `ADR-007`/`ADR-022` (seguir, cuentas privadas), `ADR-029` (bloqueos), `ADR-039`/`ADR-046` (fotos y
  video en publicaciones), `ADR-049` (perfil ajeno).

## 1. Decisión

| Tema | Decisión |
|---|---|
| **Explorar** | `GET /api/explore`: publicaciones con foto o video de los últimos 30 días, de personas que no sigues y que no son tuyas, ordenadas por **popularidad** (me gusta + 2 × comentarios) y luego fecha. Es una consulta SQL sobre el filtro del feed, así que cuentas privadas, bloqueos, contenido sensible y silenciados aplican igual. Páginas de 30 con `offset`. |
| **Sin personalización** | No hay perfil de intereses ni aprendizaje: «recomendado» significa popular entre quienes no sigues. |
| **Pantalla** | Cuadrícula de 3 columnas con filtros «Para ti / Fotos / Videos», paginación al final y tirar para actualizar. Tocar una miniatura abre la publicación con sus comentarios. |
| **Seguidores / seguidos** | `GET /api/users/<id>/followers` y `/following`: solo follows aceptados, con la relación de quien mira (botón Seguir en cada fila) y `is_me`. En una cuenta privada que no sigues: `403` (misma regla que ver sus publicaciones). Bloqueo: `404` y las cuentas bloqueadas no aparecen. |
| **App** | Los contadores del perfil propio y del ajeno abren la lista (pestañas Seguidores / Siguiendo). Cada fila lleva al perfil. |

## 2. Qué NO hace

- No hay recomendación personalizada, tendencias, etiquetas ni búsqueda dentro de Explorar.
- Las publicaciones que llegan por Explorar se incorporan al estado de la app sin entrar al feed.
- No hay «quitar seguidor», «te sigue» ni ordenar la lista; tampoco buscar dentro de ella.
- Explorar no está en la web todavía.

## 3. Riesgos

- Moderación: Explorar amplifica imágenes y video sin revisión previa; la moderación de imágenes sigue siendo un
  bloqueante del lanzamiento público (`ADR-039`/`ADR-046`).
- La consulta de popularidad cuenta likes/comentarios con subconsultas por fila; con mucho volumen hará falta un
  contador materializado o un índice (no hay medición todavía).

## 4. Verificación

`backend/tests/test_explore_and_connections.py` (10 pruebas: Explorar con medios, exclusión de propias y seguidas,
orden por popularidad, filtros y validación, privadas y bloqueadas; listas, cuenta privada, bloqueos, paginación).
