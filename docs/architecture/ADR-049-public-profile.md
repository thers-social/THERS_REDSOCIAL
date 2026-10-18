# ADR-049 — Perfil de otra persona, seguir, mensaje y compartir perfil

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por el
  propietario: al tocar la foto de quien publicó, ir a su perfil con «Seguir», «Mensaje» y «Compartir», como en Instagram.
- **Relacionado:** `ADR-007` (seguir), `ADR-022` (cuentas privadas), `ADR-029` (bloqueos), `ADR-024` (quién puede escribirme).

## 1. Decisión

| Tema | Decisión |
|---|---|
| **Endpoint** | `GET /api/users/<id>`: solo campos públicos (nombre, usuario, bio, lugar, sitio, foto, portada, contadores, `is_private`) más la relación de quien mira (`follow_status`) y `can_view_posts`. Sin correo, teléfono ni fecha de nacimiento. |
| **Publicaciones** | `GET /api/posts` gana `?author_id=`. Reutiliza el mismo filtro SQL del feed, así que ninguna regla de visibilidad se reimplementa. Antes la app filtraba el feed global por autor, lo que no servía para perfiles ajenos (solo salen las 50 últimas del feed). |
| **Bloqueos** | Bloqueo en cualquier sentido = `404` (la cuenta «no existe»), como el resto de lecturas (`ADR-029`). |
| **Cuenta privada** | Se ve el perfil y los contadores, no las publicaciones, hasta que la solicitud sea aceptada. |
| **Mensaje** | Abre el chat directo existente; si la persona no acepta mensajes (`ADR-024`) el envío responde `403` como siempre. |
| **Compartir perfil** | Menú de compartir del sistema con `thers://user/<id>`. |

## 2. Qué NO hace

- No hay página web pública de perfiles: el enlace compartido solo abre la app si está instalada. Para que el enlace
  funcione en cualquier chat hace falta una URL `https` y un dominio (`ADR-018`, sin ratificar).
- No hay lista de seguidores/seguidos de otra persona, ni historias destacadas, ni etiquetas de «te sigue».
- Las publicaciones del perfil son las 50 más recientes, igual que el feed (sin paginación).
- El ocultar «Mensaje» cuando la persona no acepta mensajes no existe: el aviso aparece al enviar.

## 3. Verificación

`backend/tests/test_public_profile.py` (10 pruebas: campos públicos, relación, cuenta privada pendiente/aceptada,
perfil propio, bloqueo en ambos sentidos, id inexistente o mal formado, sesión, filtro por autor y su `400`).
