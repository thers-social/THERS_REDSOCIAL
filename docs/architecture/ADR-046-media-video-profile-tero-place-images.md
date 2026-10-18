# ADR-046 — Videos cortos, fotos en la app, foto de perfil, imágenes para Tero e imagen de cada lugar

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12).
  Pedido por el propietario. Se implementa detrás de interruptores **apagados por defecto** donde cuesta CPU,
  dinero o saca datos a un tercero (video, imágenes para Tero); no es una decisión ratificada.
- **Fecha:** 2026-10-18
- **Por qué existe:** `ADR-039` permitió fotos en publicaciones y mensajes (solo en la web), y `ADR-015` la foto de
  perfil (solo en la web). Faltaba: **video**, **todo lo anterior en la app móvil**, **mandarle imágenes a Tero** y
  que **cada lugar tenga una imagen que lo identifique**.
- **Relacionado:** `ADR-039-images-in-posts-and-messages.md`, `ADR-042-voice-messages-and-tero-voice.md` (misma
  forma de pipeline de medios), `ADR-015-profile-media.md`, `ADR-040-thers-places.md`, `ADR-041-tero-ai-assistant.md`,
  `ADR-027-rate-limiting.md`, `ADR-031-account-deletion.md`, `ADR-032-content-reports-and-moderation.md`.

## 1. Decisión

| Tema | Decisión |
|---|---|
| **Video** | **Uno** por publicación o mensaje, **excluyente** con fotos y con nota de voz. Hasta **60 s** y **25 MB** de entrada. MP4, MOV (QuickTime) o WebM. El servidor lo **re-codifica siempre** a MP4 (H.264 *main* + AAC estéreo 44,1 kHz, **máx. 720p** —1280×720 o 720×1280—, **30 fps**, `faststart`, tasa de bits acotada) y genera una **miniatura WebP**. El original nunca se guarda. Duración y dimensiones las calcula el servidor. |
| **Procesado** | PyAV (ya presente por `ADR-042`), sin dependencias nuevas. Contenedor por **cabecera**, no por extensión; un solo flujo de video y como mucho uno de audio; topes de tamaño, resolución (4096 px), duración y fotogramas comprobados **mientras se decodifica**. Un video grabado de lado (casi todos los verticales) se **endereza** con el filtro de ffmpeg según su metadato de rotación. Medido: ~2,4 s de CPU por cada 10 s de video 1080p (≈ 15 s para el máximo). |
| **Tabla** | `video_attachments` (`post_id` **o** `message_id`, exactamente uno por `CHECK`, cada uno `UNIQUE`), con `owner_id`, `storage_key`, `thumb_key`, `width`, `height`, `duration_ms`, `size_bytes`. Todas las claves foráneas `ON DELETE CASCADE`. Tabla propia (no `media_attachments`) por el mismo motivo que el audio (`ADR-042`). |
| **API** | Los mismos endpoints (`POST /api/posts`, `POST /api/users/<id>/messages`) aceptan el campo multipart **`video`**. Respuesta: `video: {url, thumbnail_url, width, height, duration_ms}` (o `null`) en posts y mensajes; `last_message.has_video` en conversaciones. `GET /api/media/videos/<id>.mp4` atiende `Range` (206). |
| **Interruptor y límites** | `VIDEO_UPLOADS_ENABLED` (**apagado por defecto**: `503 {"code":"video_disabled"}`) y regla `video_upload`: **10 envíos con video por hora y cuenta**, contados aunque el archivo sea inválido (`ADR-027`). `413` > 25 MB; `400` inválido, demasiado largo o mezclado con imágenes/audio. |
| **App móvil** | `expo-image-picker` (solo galería: **ni cámara ni micrófono**; en Android moderno es el *Photo Picker* del sistema, sin permiso) y `expo-video` (la miniatura se ve primero y el video no se descarga hasta tocarlo). Publicaciones: hasta 4 fotos o 1 video. Chat: 1 foto o 1 video. Foto de perfil: cambiar y quitar desde editar perfil. **Requiere compilar de nuevo la app** (módulos nativos nuevos). |
| **Foto de perfil** | Sin cambios de servidor (`POST`/`DELETE /api/users/me/avatar`, `ADR-015`); la app móvil ya puede usarlos. |
| **Tero con imágenes** | **Una** imagen por pregunta, en base64 dentro del JSON (`image: {media_type, data}`). El servidor la decodifica por contenido, la **endereza, la reduce a 1280 px, la aplana a JPEG y le quita EXIF/GPS**, y la manda al modelo como bloque de imagen. **No se guarda** y no entra en el historial. Con imagen el texto es opcional. `TERO_IMAGES_ENABLED` (**apagado por defecto**: `503 tero_images_disabled`), cuenta contra `TERO_CHAT` y `IMAGE_UPLOAD`. La imagen **sale a Anthropic**: la interfaz lo dice. El prompt prohíbe identificar personas por su cara y trata el texto dentro de la imagen como información, no como órdenes. Los **videos no se envían a Tero**. |
| **Imagen del lugar** | `places.image_key` (migración `d4a7e1b9c356`). Solo la sube **quien gestiona el lugar**: `PUT`/`DELETE /api/places/<id>/manage/image` (multipart, campo `image`; `404` a quien no gestiona **antes** de decodificar nada). Se reduce a 1200 px, WebP, sin metadatos. Aparece como `cover_image_url` (campo que ya existía y era siempre `null`) en listas, mapa, búsqueda y ficha. Reemplazar borra el archivo anterior; cada cambio se **audita** (`place_updated`). Funciona también en lugares importados de OSM una vez reclamados (`ADR-043`). |

## 2. Integridad

- **Publicar / enviar:** se guardan los archivos y luego se crea la fila; si la base falla se **borran los archivos y
  la publicación o el mensaje**. Un envío rechazado (bloqueo, permisos, a uno mismo) no deja nada guardado.
- **Mensaje con `client_id` repetido** (`ADR-035`): el reintento devuelve el original y no duplica ni cambia el video.
- **Borrar publicación, mensaje o cuenta:** se borran el video y su miniatura (claves leídas antes del borrado y
  filtradas por dueño). La exportación de datos incluye `video_seconds` (no el archivo).
- **Editar** una publicación o un mensaje cambia el texto, **no** el video.
- **Imagen del lugar:** se guarda el archivo nuevo, se actualiza la fila y **solo entonces** se borra el anterior.

## 3. Seguridad y privacidad — lo que NO se resuelve aquí

1. **Las URL son públicas** (nombre aleatorio de 128 bits, nunca listado), igual que imágenes (`ADR-039` §3) y voz
   (`ADR-042` §3). Un video de un mensaje directo lo ve cualquiera que tenga la URL. Pendiente: URL firmadas.
2. **No hay moderación automática de video ni de imágenes.** Solo el reporte manual (`ADR-032`/`ADR-038`). El video
   multiplica el riesgo: **sin detección de contenido ilegal antes de abrir al público (p. ej. CSAM por *hash
   matching*) esto bloquea el lanzamiento público**, igual que `ADR-039`.
3. **Re-codificar es CPU del servidor y es síncrono**: un video de 60 s tarda unos 15 s dentro de la petición. Sirve
   para decenas de usuarios; con más hace falta una **cola de procesado** (pendiente, igual que `ADR-042` §3.6).
4. **x264 y licencias.** El *wheel* de PyAV trae FFmpeg con libx264 (GPL). Está bien para un servidor propio que no
   redistribuye el binario; hay que revisarlo si se empaqueta y distribuye.
5. **Tero e imágenes:** la imagen sale a un tercero y puede contener datos personales de otras personas. No se guarda,
   pero el proveedor tiene sus propias políticas de retención: hay que añadirlo a la política de privacidad y al
   aviso de la pantalla (ya lo dice).
6. **Imagen del lugar:** la sube quien gestiona el lugar, con el mismo riesgo de contenido inapropiado; el reporte
   de datos del lugar (`inappropriate`) ya existe.

## 4. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Guardar el video original | EXIF/GPS, cargas escondidas y formatos que no reproducen todos los navegadores. |
| Más de un video o mezclarlo con fotos | Complica el procesado y la interfaz sin que nadie lo pidiera. |
| 3 minutos / 100 MB | Obliga a cola de procesado y almacenamiento en la nube antes de publicar. |
| Mandar fotogramas de un video a Tero | Más coste y más superficie de privacidad; fuera de alcance. |
| Subir el video sin re-codificar | Cada teléfono graba en un formato distinto (HEVC, rotado, 4K) y el tamaño no estaría acotado. |
| Transcodificar con la cámara del teléfono (`expo-camera`) | Pide cámara y micrófono; solo se necesita la galería. |

## 5. Pendiente

URL firmadas · moderación automática · cola de procesado y almacenamiento en la nube · política de privacidad
(Tero e imágenes, video) · cambiar el *wheel* de PyAV o su política de actualización · barra de progreso de subida ·
recorte/edición del video en la app · límites por plan · probar en un teléfono físico distinto del moto z3.
