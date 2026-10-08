# ADR-039 — Imágenes en publicaciones y mensajes

- **Estado:** **`PROPUESTO`** el 2026-10-05 — **pendiente de aprobación del equipo** (`HB-001` §11–12).
  Implementado en la rama `feature/post-message-images` para poder probarlo; no es una decisión ratificada.
- **Fecha:** 2026-10-05
- **Por qué existe:** hasta ahora solo se podían subir fotos de perfil y portada (`ADR-015`). Publicaciones y
  mensajes eran solo texto, y el botón «Foto» del compositor estaba deshabilitado.
- **Relacionado:** `ADR-015-profile-media.md` (almacenamiento y procesado), `ADR-027-rate-limiting.md`,
  `ADR-031-account-deletion.md`, `ADR-035-chat-sync.md`, `ADR-018-hosting-and-environments.md`.

---

## 1. Decisión

| Tema | Decisión |
|---|---|
| Alcance | Hasta **4 imágenes** por publicación y **1** por mensaje. Sin video ni GIF animado. |
| Contrato | Los mismos endpoints (`POST /api/posts`, `POST /api/users/<id>/messages`) aceptan **`multipart/form-data`** con el campo `images`, además del JSON de siempre. **No se rompe ningún cliente existente.** |
| Texto | Con imagen, el texto puede ir **vacío**. Sin imagen sigue siendo obligatorio. |
| Tabla | Una sola, **`media_attachments`** (`post_id` o `message_id`, exactamente uno por `CHECK`), con `owner_id`, `storage_key` único, `width`, `height` y `position`. Todas las claves foráneas son `ON DELETE CASCADE`. |
| Respuesta | `images: [{url, width, height}]` en posts y mensajes; `last_message.has_image` en conversaciones. Nunca se expone la clave interna ni el dueño. |
| Procesado | El servidor **decodifica por contenido**, aplica la orientación EXIF, **reduce** (lado mayor 1600 px en posts, 1280 px en mensajes, sin recortar ni ampliar) y **re-codifica a WebP**. El original nunca se guarda: se descartan EXIF/GPS y cualquier carga escondida tras la imagen. |
| Límites | 5 MiB por archivo, 40 Mpx (bomba de descompresión), JPEG/PNG/WebP, 22 MiB por petición multipart (solo en esas dos rutas; el techo global sigue en 6 MiB). |
| Nombres | `posts/<uuid4>.webp` / `messages/<uuid4>.webp`: aleatorios e impredecibles. |
| Abuso | Regla `IMAGE_UPLOAD`: **40 peticiones con imagen por hora y cuenta** (`ADR-027`). |
| Cliente | El navegador reduce la foto antes de subirla (las del móvil suelen pasar de 5 MB). Es comodidad: el servidor lo vuelve a validar todo. |

## 2. Integridad (nada queda a medias)

- **Publicar:** se guardan los archivos, luego se crea la fila. Si la base falla, se **borran los archivos y la publicación**.
- **Mensaje con `client_id` repetido** (`ADR-035`): el reintento devuelve el original y **no** duplica ni cambia la imagen.
- **Envío rechazado** (bloqueo, permisos, a uno mismo): los archivos se guardan **después** de esas comprobaciones, así que no queda nada.
- **Borrar publicación o mensaje:** se borran también los archivos. Las claves se leen **filtradas por dueño** antes del borrado, así que quien no es el autor no obtiene nada.
- **Borrar la cuenta:** `media_keys` incluye las imágenes de sus publicaciones y mensajes (`ADR-031`).
- **Editar** una publicación o un mensaje cambia el texto, **no** las imágenes.

## 3. Seguridad — lo que NO se resuelve aquí

1. **Las URL son públicas.** Cualquiera que tenga la URL puede ver la imagen, aunque la publicación sea de una cuenta privada o sea un mensaje directo. La protección es que el nombre es aleatorio e impredecible (128 bits) y que nunca se lista. **Si una URL se filtra, la imagen es accesible** hasta que se borre. Es el mismo modelo que `ADR-015` para avatares, pero con contenido más sensible. **Decisión abierta para el equipo:** para mensajes y cuentas privadas, pasar a **URL firmadas con caducidad** (S3 *presigned*) o a un endpoint autenticado. Cuesta más (el `<img>` no puede mandar `Authorization`, habría que pedir la URL firmada en cada carga).
2. **No hay moderación automática de imágenes.** Solo funciona el reporte manual (`ADR-032`/`ADR-038`). Sin detección de contenido ilegal (por ejemplo, CSAM por *hash matching*) antes de abrir al público, el riesgo es alto. **Bloquea el lanzamiento público**, no la prueba privada.
3. **Sin texto alternativo** elegido por la persona: la `alt` es genérica («Imagen de <nombre>»). Mejora de accesibilidad pendiente.
4. **Procesado en el proceso web.** Decodificar 4 imágenes de hasta 40 Mpx cuesta CPU y memoria en el worker de Gunicorn. El límite por hora lo acota, pero a escala conviene una cola y un worker aparte.
5. **Huérfanos.** Si el borrado de un archivo falla se registra una advertencia con la clave; no hay un barrido periódico (el proyecto no tiene tareas programadas).

## 4. Escalabilidad

- `Post.images` y `Message.images` se cargan con `selectin`: **una consulta extra por página**, no una por publicación.
- Los archivos se sirven desde el almacenamiento/CDN (`Cache-Control: immutable`), no por la API. En producción: `STORAGE_BACKEND=s3`.
- Falta generar **miniaturas** (hoy se sirve la misma imagen de 1600 px en el feed). Es la primera mejora de rendimiento a hacer.
- El feed sigue sin paginación real (ver la revisión del proyecto).

## 5. Verificado

- `backend/tests/test_post_message_images.py`: 34 pruebas contra PostgreSQL real (publicar, solo imagen, límite de 4, archivo inválido anula todo, validación por contenido, límite de 5 MB, EXIF y carga escondida descartados, reducción sin ampliar, orden, borrado de archivos, ajeno no puede borrar, reintento idempotente, límite por hora, recolección al borrar cuenta).
- `npm run lint` y `npm run build` sin errores nuevos.
- **No verificado en un navegador:** la interfaz (selector, vista previa, visor, mensajes) se compiló pero no se probó a mano.

## 6. Pendiente

Decidir el punto 3.1 (URL firmadas); moderación de imágenes (3.2); miniaturas; texto alternativo; subir `Content-Security-Policy` con `img-src` del dominio del bucket; app móvil (Expo) todavía sin selector de imágenes.
