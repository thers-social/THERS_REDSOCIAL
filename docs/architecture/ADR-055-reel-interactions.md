# ADR-055 — Me gusta, guardados y comentarios en Reels

- **Estado:** **`PROPUESTO`** el 2026-10-20 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por el
  propietario: que los Reels de la web funcionen como los de TikTok e Instagram (interacción desde el propio Reel).
- **Relacionado:** `ADR-043`/`ADR-043-A` (Reels con Mux), `ADR-005` (likes), `ADR-006` (comentarios), `ADR-047`
  (guardados de publicaciones), `ADR-029` (bloqueos), `ADR-007` (follows).

## 1. Decisión

| Tema | Decisión |
|---|---|
| Me gusta | Tabla `video_likes (video_id, user_id, created_at)`, PK compuesta, FK con `ON DELETE CASCADE` a `videos` y `users`. `POST`/`DELETE` idempotentes. |
| Guardados | Tabla `video_saves` con la misma forma e índice `(user_id, created_at)`. Privado: solo lo ve quien guardó. |
| Comentarios | Tabla `video_comments (id, video_id, author_id, content ≤ 1000, created_at)` con `CHECK` de texto no vacío. Sin edición ni respuestas anidadas en esta versión. |
| Quién puede interactuar | Solo sobre un Reel **visible** para la persona (cuentas privadas, bloqueos y suspensión, como `GET /api/videos`) **y publicado** (`ready` + `approved`). Si no, `404` indistinguible. |
| Borrado de comentarios | Su autor o la persona dueña del Reel. |
| Bloqueos | Los comentarios de personas con bloqueo en cualquier sentido con quien mira no se listan. |
| Contadores | Se calculan con `COUNT` al leer (una sola consulta para toda la página, sin N+1). No hay contadores desnormalizados. |
| Límite | `VIDEO_COMMENT`: 20 comentarios por minuto y cuenta (`429`). |
| Flag | Todo cuelga de `VIDEOS_ENABLED`: apagado, `404`. |

## 2. No objetivos (esta versión)

- **Notificaciones** de «le gustó tu Reel» y «comentó tu Reel»: no se crean. Requieren ampliar `notifications` (hoy
  referencia a `posts`) y se deja para un ADR propio.
- Menciones, edición de comentarios, «me gusta» en comentarios y respuestas anidadas.
- Compartir: el cliente web copia el enlace; no hay contador de compartidos.

## 3. Riesgos

- `COUNT` sobre `video_likes` crece con el éxito de un Reel; si deja de bastar el índice por `video_id` (la PK), se
  añadirá un contador desnormalizado.
- Los comentarios no pasan por el clasificador de moderación (igual que los de publicaciones hoy).

## 4. Migración

`d4f7b1c3e9a5` crea las tres tablas. Reversible (`downgrade` las borra).
