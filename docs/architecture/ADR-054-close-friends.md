# ADR-054 — Mejores amigos e historias con audiencia

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por el
  propietario: poder publicar historias solo para una lista privada de personas.
- **Relacionado:** `ADR-042` (historias), `ADR-007` (follows), `ADR-029` (bloqueos), `ADR-044` (moderación).

## 1. Decisión

| Tema | Decisión |
|---|---|
| Lista | Tabla `close_friends (owner_id, friend_id, created_at)`, PK compuesta, ambas FK a `users` con `ON DELETE CASCADE`, `CHECK (owner_id <> friend_id)`. Máximo 500 personas por lista. |
| Audiencia | Columna `stories.audience` (`everyone` por defecto o `close_friends`, `ck_stories_audience`). Las historias existentes quedan `everyone`. |
| Visibilidad | Una historia es visible si cumple la regla de `ADR-042` (seguimiento aceptado, sin bloqueo) **y** su audiencia lo permite: `everyone`, o el lector es la autora, o el lector está en su lista. Se evalúa al leer, así que quitar a alguien le oculta también lo ya publicado. |
| Quién puede añadirse | Cualquier cuenta existente que no sea la propia ni esté bloqueada (en cualquier sentido). La persona **no recibe aviso** al añadirla ni al quitarla. |
| Publicaciones | `posts.audience` con los mismos valores (`ck_posts_audience`, migración `c3e6a0b2d8f4`). Misma regla de lectura: se suma a la visibilidad de cuentas privadas y bloqueos (`ADR-022`/`ADR-029`) y se evalúa en el feed, el perfil, las tarjetas por mensaje, y al comentar, dar like, guardar o reportar (404 si no puedes verla). Las menciones de una publicación solo para mejores amigos (y de sus comentarios) se limitan a la lista; el contador de publicaciones de un lugar las excluye. Solo se puede publicar con la audiencia `close_friends` con `STORIES_ENABLED` encendido (`400` si no). |
| Cliente | App móvil: pantalla Ajustes → Mejores amigos, selector de audiencia al publicar, anillo y etiqueta verdes. |
| Flag | Detrás de `STORIES_ENABLED`: apagado, los endpoints responden `404`. |

## 2. Riesgos

- La lista revela implícitamente la audiencia a quien la ve en la tira (anillo verde); es el mismo compromiso de Instagram.
- Quitar a alguien no avisa; una persona no sabe si está o no en la lista de otra.

## 3. Migración

`b2d5f9a1c7e3` crea `close_friends` y añade `stories.audience`. Reversible (`downgrade` borra ambas).
