# ADR-047 — Guardar y compartir publicaciones

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por
  el propietario ("guardar publicaciones y compartirlas").
- **Fecha:** 2026-10-18
- **Por qué existe:** la tarjeta de una publicación ya dibujaba los iconos de guardar y compartir, pero sin ninguna
  función detrás (en la app abrían un aviso de «próximamente»).
- **Relacionado:** `ADR-005` (likes: mismo patrón idempotente), `ADR-022` (cuentas privadas), `ADR-029` (bloqueos),
  `ADR-040` fases 4c/4d (guardar y compartir **lugares**: mismo patrón), `ADR-013`/`ADR-035` (mensajes), `ADR-031`
  (borrado de cuenta), `ADR-028` (exportación).

## 1. Decisión

| Tema | Decisión |
|---|---|
| **Guardar** | `POST`/`DELETE /api/posts/<id>/save`, **idempotente** (200 siempre). Tabla `saved_posts` (`user_id`, `post_id`, `created_at`; PK compuesta; ambas FK `ON DELETE CASCADE`). Es **privado**: nadie ve qué guardó otra persona, no hay contador público y **no notifica** al autor. |
| **Quién se puede guardar** | Solo lo que quien guarda **puede ver** (cuenta privada que no sigue, bloqueo en cualquier sentido → `404`, igual que un post inexistente). **Quitar** nunca da 404: una publicación que ya no se ve puede sacarse de la lista. |
| **Lista** | `GET /api/posts/saved` → `{posts}` con la forma de siempre, **la última guardada primero**, máx. 100. Aplica las **mismas reglas del feed** (privacidad, bloqueos, contenido sensible, temas y palabras silenciadas): una guardada que deja de ser visible desaparece de la lista sin borrarse. |
| **Estado en el feed** | Todo post trae `saved_by_me` (booleano). Se resuelve con **una consulta por página**. |
| **Compartir** | Por **mensaje directo**: `POST /api/users/<id>/messages` acepta `post_id` (el texto es opcional; excluyente con `place_id`). El mensaje lleva `post`: una **tarjeta** `{id, available, author, is_sensitive, excerpt, thumbnail_url, has_video}`. Las conversaciones ganan `last_message.has_post`. |
| **Reglas de la tarjeta** | Se calcula **para quien mira**: si esa persona no puede ver la publicación (borrada, cuenta que pasó a privada, bloqueo) la tarjeta es `{id, available: false}` sin nada de ella (o `post: null` si la publicación se borró y el `post_id` quedó en `NULL`). Solo se puede **enviar** una publicación que **quien comparte** puede ver. Una publicación **sensible** no enseña texto ni miniatura a nadie salvo a su autor. El resto de comprobaciones del envío (bloqueo, quién puede escribirme, idempotencia por `client_id`) son las de siempre y van **antes**. |
| **Compartir fuera de THERS** | **No se hace.** No hay página pública de una publicación (hace falta sesión), así que un enlace no llevaría a nada útil a quien no tenga cuenta. Compartir es solo hacia personas dentro de THERS. |
| **Tablas** | `saved_posts` (nueva) y `messages.post_id` (`UUID` nullable, FK a `posts` `ON DELETE SET NULL`). Migración `a9d3b7e1c542`. |
| **Exportación** | La exportación de datos añade `saved_posts.json`. El borrado de cuenta se resuelve por `CASCADE`. |

## 2. Qué NO hace

- No cuenta cuántas personas guardaron una publicación ni se lo dice al autor.
- No hay carpetas/colecciones de guardados; es una sola lista.
- No hay paginación de la lista (tope de 100), igual que el feed hoy.
- Compartir no reenvía a varias personas a la vez ni publica "reposts" en el perfil propio.
- No hay enlace para compartir fuera de THERS ni vista previa (Open Graph): la publicación no es pública.

## 3. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Notificar al autor cuando alguien guarda | Guardar es un gesto privado; notificarlo lo convertiría en otro "like". |
| Contador público de guardados | Mismo motivo; además presiona a publicar para acumularlo. |
| Página pública de publicación | Exige moderación previa a abrir al público (ver `ADR-039` §3) y SEO. |
| Copiar el contenido en el mensaje | Se desactualizaría al editar/borrar y se saltaría la privacidad: la tarjeta se calcula en cada lectura. |
| Reutilizar `place_id` con un campo genérico `target` | Mezcla dos reglas de visibilidad distintas; dos columnas explícitas son más claras. |

## 4. Pendiente

Colecciones de guardados · paginación · vista pública y Open Graph · compartir a varias personas · «reenviar» a una
historia propia.
