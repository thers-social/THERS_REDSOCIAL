# ADR-043 — Videos y cortos

- **Estado:** **`BORRADOR — PROPUESTO`**. Sin ratificar. Hasta que el equipo lo apruebe (`HB-001`
  §11–12) **no se crea ninguna tabla, endpoint ni pantalla**.
- **Fecha:** 2026-10-17
- **Autor del borrador:** Claude Code, a pedido del propietario del proyecto.
- **Relacionado:** `ADR-039-images-in-posts-and-messages.md` (imágenes y `media_attachments`),
  `ADR-018-hosting-and-environments.md` (hosting y costos), `ADR-042-stories.md` (historias, que
  heredan el video cuando exista), `ADR-032`/`ADR-038` (reportes y seguridad infantil),
  `ADR-027` (límites de uso), `ADR-031` (eliminación de cuenta), `ADR-028` (exportación).

> Convención: **[VERIFICADO]** se comprobó en el repositorio · **[PROPUESTA]** el equipo debe
> aceptarla o cambiarla · **[PENDIENTE]** no se puede decidir desde el repositorio (costos, cuotas
> de proveedores, política).

---

## 1. Contexto

### 1.1 Qué existe hoy [VERIFICADO]

- **Web:** `/videos` es `ModulePending`; su propio texto dice «Sin endpoint de vídeo en el backend:
  requiere contrato nuevo». El badge LIVE de la maqueta no se muestra.
- **Móvil:** la pestaña Reels dice «Próximamente» y no inventa contenido.
- **Buscador web:** el ámbito «Videos» y los selectores «Duración» y «Calidad» están
  deshabilitados porque «no hay contenido de vídeo indexado».
- **Backend:** `ADR-039` solo acepta **imágenes** (JPEG/PNG/WebP, 5 MiB). El techo HTTP global es
  de 6 MiB (`MAX_CONTENT_LENGTH`) y solo las rutas de publicar y de mensaje suben a 22 MiB.
  `media_attachments` tiene `CHECK` de «`post_id` o `message_id`, exactamente uno» y no distingue
  tipo de archivo.
- **Sin transcodificación:** `backend/requirements.txt` no incluye `ffmpeg` ni ninguna biblioteca de
  video. El backend corre en Render con 512 MB (Starter) y 2 *workers* de `gunicorn`
  (`ADR-018`, guía de staging).
- **Almacenamiento:** un solo bucket público de Supabase (S3 compatible). Plan gratuito: 1 GB de
  archivos; Pro: 100 GB de archivos y 250 GB de salida (`ADR-018`).

### 1.2 Qué problema resuelve

El diseño aprobado incluye Videos, Cortos y Reels, pero la plataforma no tiene ni un archivo de
video. El propietario pide que sean reales.

---

## 2. Decisión propuesta

| Tema | Propuesta |
|---|---|
| Qué es | Un **clip corto** adjunto a una publicación (una «cápsula»), de **hasta 60 segundos** y **25 MiB**. Un video por publicación, **sin mezclarlo con imágenes**. |
| Formato | **MP4 con H.264 y AAC** únicamente. Es lo que reproducen todos los navegadores y Android sin bibliotecas extra. Otros formatos se rechazan. |
| Transcodificación | **Ninguna en el servidor** en la v1. El servidor **valida**, no convierte (ver §3.2). |
| Subida | **Directa al almacenamiento** con una URL de subida firmada y de corta vida, no a través de Flask (ver §3.3). |
| Miniatura | El cliente genera un *póster* JPEG y lo sube por el flujo de imágenes de `ADR-039` (reducido y sin EXIF). |
| Reproducción | Web: etiqueta `<video>` con controles propios. Móvil: `expo-video`. Ambos con carga bajo demanda, silenciado por defecto y sin reproducción automática con sonido. |
| Dónde se ve | Web: `/videos`. Móvil: pestaña Reels, una lista vertical. Buscador: ámbito «Videos» y filtros de duración y calidad reales. |
| Directos (LIVE) | **Fuera de alcance.** No hay señal real de directo. |
| Moderación | Reportable con `ADR-032`; **bloquea el lanzamiento público** (ver §4). |
| Rate limit | Regla nueva de `ADR-027`: **10 videos por día y cuenta**. |

---

## 3. Diseño [PROPUESTA]

### 3.1 Modelo de datos

Se **extiende `media_attachments`** en vez de crear una tabla de videos paralela, para heredar el
borrado en cascada, `media_keys` (`ADR-031`) y la exportación (`ADR-028`):

- Columna `kind` (`'image'` por defecto, `'video'`) con `CHECK`.
- Columnas nullable `duration_ms`, `poster_key` y `size_bytes`, obligatorias solo si `kind = 'video'`
  (`CHECK`).
- Un `CHECK` o índice parcial que impida más de **un** video por publicación y mezclarlo con
  imágenes.

Migración aditiva. Las filas existentes quedan como `kind = 'image'`.

### 3.2 Validación en el servidor (sin ffmpeg)

El servidor no puede confiar en el tipo que declara el cliente. Tras la subida:

1. Comprobar tamaño real (`HEAD` al objeto) ≤ 25 MiB.
2. Leer **solo las cabeceras del contenedor MP4** (la caja `ftyp` y la `moov`) con un analizador
   propio en Python puro, sin decodificar video. De ahí salen la **duración**, las **dimensiones**
   y los **códecs** declarados.
3. Rechazar y **borrar el objeto** si no es MP4, si el códec no es H.264/AAC, si dura más de 60 s o
   si no se puede analizar.

**[PENDIENTE]** Validar el contenedor no valida el contenido: un archivo MP4 puede declarar algo y
llevar otra cosa. Es una defensa de formato, no de seguridad (ver §4).

### 3.3 Subida directa

Subir 25 MiB a través de Flask ocupa un *worker* durante toda la transferencia y arriesga memoria
(512 MB, 2 *workers*). La propuesta:

1. `POST /api/videos/uploads` → el servidor crea una **reserva** (fila pendiente con `storage_key`
   aleatorio) y devuelve una URL firmada de subida de ~5 minutos.
2. El cliente sube directo al almacenamiento.
3. `POST /api/videos/uploads/<id>/complete` → el servidor valida (§3.2) y, si pasa, la reserva queda
   lista para adjuntarse a una publicación.
4. Una reserva que no se completa en una hora se borra con la purga (`ADR-037`).

**[PENDIENTE]** `backend/app/domain/media/private_storage.py` ya genera URLs firmadas de
**lectura** (`signed_url`), pero no hay nada para **subida** firmada. Hay que verificar que el
proveedor (Supabase Storage) permita subidas firmadas con límite de tamaño por objeto.
Alternativa si no: subida por Flask con un límite menor (10 MiB) y transmisión por bloques.

### 3.4 API

Se documentaría en `API_CONTRACT.md` el mismo día del PR (`HB-001` §15.1).

| Método y ruta | Uso |
|---|---|
| `POST /api/videos/uploads` | Reserva una subida y devuelve la URL firmada. |
| `POST /api/videos/uploads/<id>/complete` | Valida el objeto subido. |
| `POST /api/posts` | Acepta `video_upload_id` (opcional) además de lo actual. |
| `GET /api/posts?kind=video` | Solo publicaciones con video, para `/videos` y Reels. |
| `GET /api/posts` | Cada publicación gana `video: {url, poster_url, duration_ms, width, height}` o `null`. Aditivo, no rompe a ningún cliente. |

### 3.5 Buscador

Con `duration_ms`, `width` y `height` guardados, los selectores «Duración» y «Calidad» del buscador
web pasan de deshabilitados a reales, y el ámbito «Videos» se vuelve buscable. «Calidad» se deriva de
la altura (por ejemplo 720p o más), no es un campo nuevo.

---

## 4. Seguridad y privacidad

1. **Sin moderación automática ni *hash matching*.** Con imágenes ya es un riesgo que `ADR-039`
   declara bloqueante del lanzamiento público. Con video es peor: un clip es más difícil de revisar
   a mano y más grande de conservar como evidencia (`ADR-038`). **No se abre la subida de videos al
   público hasta tener detección de material de abuso infantil.** Hasta entonces, la subida se
   restringe a cuentas de prueba.
2. **URL pública.** Igual que las imágenes: quien tenga la URL ve el video sin iniciar sesión,
   aunque sea de una cuenta privada (`ADR-039` §3). Para video el costo de una filtración es mayor.
3. **Metadatos.** Un MP4 puede llevar ubicación GPS y fecha del dispositivo. Sin transcodificar, el
   servidor **no los elimina**. Mitigación mínima: el cliente móvil debe exportar sin metadatos, y la
   v1 debe decirlo en pantalla. **[PENDIENTE]** Quitarlos del lado del servidor exige reescribir las
   cajas del contenedor (posible sin recodificar, pero es código nuevo y delicado).
4. **Archivos hostiles.** El analizador de cabeceras debe tener límites de profundidad y de tamaño de
   caja, y pruebas con archivos malformados.
5. **Datos personales.** Los videos y sus pósters entran en `media_keys` (`ADR-031`) y en la
   exportación (`ADR-028`).

---

## 5. Costos y límites [PENDIENTE de verificar en cada proveedor]

- 25 MiB por clip: el plan gratuito de Supabase (1 GB) cabe en ~40 clips. **El plan gratuito no
  sirve para videos**; hace falta Pro (`ADR-018`), con 100 GB de archivos.
- La salida de datos domina el costo: cada reproducción completa de un clip de 25 MiB son 25 MiB de
  salida. Con 250 GB incluidos son ~10 000 reproducciones completas al mes.
- Un clip de 60 s a 25 MiB son ~3,3 Mbps: aceptable para 720p, justo para 1080p.

---

## 6. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Transcodificar en el servidor con ffmpeg | No hay ffmpeg, Render Starter tiene 512 MB y un *worker* ocupado minutos bloquea la API. |
| Servicio de video administrado (Mux, Cloudflare Stream, Bunny) | Resuelve transcodificación, HLS y póster, pero es un costo y un proveedor nuevos fuera de `ADR-018`. **Es la salida natural si la v1 crece**; se deja como decisión D1. |
| Subir por Flask hasta 25 MiB | Ocupa un *worker* durante toda la subida. |
| Tabla `videos` separada | Duplica el borrado, la exportación y `media_keys`. |
| GIF animado | Pesa más que un MP4 y ocupa más para peor calidad. |
| Directos | Sin infraestructura ni señal real. |

---

## 7. Riesgos

1. **Moderación (§4.1):** es el riesgo que decide si se puede lanzar.
2. **Reproducción en móviles variados:** H.264/AAC es amplio, pero hay clips con perfiles raros. Sin
   transcodificar, algunos pueden no reproducirse. Hay que probar en el moto z3 y en el Samsung.
3. **Costo de salida** (§5).
4. **Subida interrumpida:** cubierta por la reserva con caducidad (§3.3).
5. **Compresión en el cliente:** los videos del teléfono pesan mucho más de 25 MiB. Hay que comprimir
   en el cliente antes de subir, y las bibliotecas para eso en Expo son nativas y se suman a las
   dificultades de compilación ya documentadas (`ADR-040` R4).

---

## 8. Decisiones que el equipo debe tomar

| # | Pregunta | Recomendación |
|---|---|---|
| D1 | ¿Subida y reproducción propias o un servicio de video administrado? | Propias para una v1 de prueba; evaluar Cloudflare Stream si crece. |
| D2 | ¿Límite de 60 s y 25 MiB? | Sí para empezar. |
| D3 | ¿Desde cuándo se abre la subida al público? | Solo con detección de abuso infantil operativa. |
| D4 | ¿Subida directa o por Flask? | Directa, si Supabase Storage lo permite (verificar). |
| D5 | ¿Plan de Supabase? | Pro antes de cualquier prueba con usuarios reales. |
| D6 | ¿Quién quita los metadatos? | El cliente en la v1; el servidor en una fase posterior. |

## 9. Criterios de aceptación

Si se aprueba: migración aditiva con `upgrade`/`downgrade` verificada en PostgreSQL real; pruebas del
analizador MP4 con archivos válidos, truncados, de otro formato y hostiles; pruebas de la reserva de
subida (caducidad, tamaño, doble `complete`); pruebas de rate limit; documentación en
`API_CONTRACT.md`, `DATABASE_ARCHITECTURE.md`, exportación y eliminación de cuenta; y reproducción
verificada en al menos dos teléfonos reales.
