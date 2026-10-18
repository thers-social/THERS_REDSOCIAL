# ADR-042 — Notas de voz en mensajes y voz para Tero

- **Estado:** **`PROPUESTO`** el 2026-10-17 — **pendiente de aprobación del equipo** (`HB-001` §11–12).
  Se implementa detrás de interruptores **apagados por defecto** para poder probarlo; no es una decisión
  ratificada y no debe fusionarse a `develop` sin esa aprobación.
- **Fecha:** 2026-10-17
- **Por qué existe:** la mensajería (`ADR-013`) y las imágenes en mensajes (`ADR-039`) solo admiten texto y fotos.
  El propietario pidió poder **mandar audios a otras personas** y **hablarle a Tero**, en la web y en la app.
- **Relacionado:** `ADR-039-images-in-posts-and-messages.md` (misma tubería de medios),
  `ADR-035-chat-sync.md` (idempotencia por `client_id`), `ADR-027-rate-limiting.md`,
  `ADR-031-account-deletion.md`, `ADR-032-content-reports-and-moderation.md`,
  `ADR-037-data-retention.md`, `ADR-041-tero-ai-assistant.md`, `ADR-018-hosting-and-environments.md`.

---

## 1. Decisión

### 1.1 Notas de voz entre personas

| Tema | Decisión |
|---|---|
| Alcance | **1 nota de voz por mensaje directo**, de hasta **120 s**. Solo mensajes: no en publicaciones ni comentarios. No se combina con imágenes en el mismo mensaje. |
| Contrato | `POST /api/users/<id>/messages` acepta `multipart/form-data` con el campo **`audio`** (un archivo), además del JSON y de `images` de siempre. **No se rompe ningún cliente.** Con audio el texto puede ir vacío. |
| Tabla | Nueva **`audio_attachments`** (`message_id` único, `owner_id`, `storage_key` único, `duration_ms`, `size_bytes`, `created_at`); claves foráneas `ON DELETE CASCADE`. **Separada de `media_attachments`** a propósito: esa tabla exige `width`/`height` y su `CHECK` de exclusividad, y todo el código que la lee asume imágenes. |
| Respuesta | `audio: {url, duration_ms}` (o `null`) en cada mensaje y `last_message.has_audio` en las conversaciones. Nunca se expone la clave interna ni el dueño. |
| Procesado | El servidor **decodifica por contenido** con PyAV (ffmpeg incluido), exige **un único flujo de audio y ningún vídeo**, corta la decodificación al pasar el tope de duración, convierte a **mono 24 kHz** y **re-codifica a AAC 40 kb/s en MP4** (`audio/mp4`, `.m4a`). El original nunca se guarda: se descartan los metadatos y cualquier carga escondida. |
| Por qué normalizar | Chrome graba `webm/opus`, Safari e iOS `mp4/aac` y la app `m4a`. Safari/iOS no reproduce de forma fiable `webm/opus`; **AAC en MP4 suena en todos**. Una sola salida evita que cada cliente tenga que soportar todos los formatos. |
| Entradas aceptadas | Reconocidas por su cabecera, no por la extensión ni el `Content-Type`: **WebM/Matroska, Ogg, MP4/M4A y WAV**. Cualquier otra cosa → 400. |
| Límites | **3 MiB** de entrada (se comprueba al leer el archivo), **120 s** (+0,5 s de tolerancia). La petición comparte el techo multipart de las imágenes (22 MiB, `ADR-039`). La duración que se muestra la **calcula el servidor**, nunca el cliente. |
| Nombres | `voice/<uuid4>.m4a`: aleatorios e impredecibles. |
| Abuso | Regla `AUDIO_UPLOAD`: **30 envíos con audio por hora y cuenta** (`ADR-027`). Decodificar cuesta CPU. |
| Interruptor | **`VOICE_MESSAGES_ENABLED`** (servidor, apagado por defecto). Apagado, un envío con audio responde **`503`** con `code: "voice_disabled"`; el resto de la mensajería no cambia. Clientes: `VITE_VOICE_ENABLED` / `EXPO_PUBLIC_VOICE_ENABLED`. |

### 1.2 Voz para Tero

| Tema | Decisión |
|---|---|
| Qué es | **Dictado:** la persona habla, el dispositivo lo convierte en **texto**, y ese texto va al campo de Tero **para que lo revise y lo envíe ella**. Nunca se envía solo. |
| El audio no llega a THERS | Ni al servidor ni a Tero ni al proveedor de IA: Tero (`ADR-041`) sigue recibiendo **solo texto**. Claude no procesa audio. |
| Cómo | Reconocimiento **del dispositivo**: Web Speech API (`SpeechRecognition`) en la web y reconocimiento nativo en la app. **Sin coste** y sin un proveedor nuevo. |
| Idioma | El de la interfaz (`es-SV`/`es`, `en-US`). |
| Interruptor | `VITE_TERO_VOICE_ENABLED` / `EXPO_PUBLIC_TERO_VOICE_ENABLED`, apagados por defecto. Si el navegador no lo soporta, el botón **no aparece** (no se muestra un botón que no funciona). |

## 2. Integridad (nada queda a medias)

- **Enviar:** se valida y procesa **antes** de tocar nada (un audio inválido falla con 400), después se crea el mensaje, después se guarda el archivo y la fila. Si algo falla se **borra el archivo y el mensaje** para que se pueda reintentar.
- **Mensaje con `client_id` repetido** (`ADR-035`): el reintento devuelve el original y **no** duplica ni cambia el audio.
- **Envío rechazado** (bloqueo, permisos, a uno mismo): el archivo se guarda **después** de esas comprobaciones, así que no queda nada.
- **Borrar un mensaje:** se borra también el archivo (claves leídas **filtradas por dueño** antes del borrado).
- **Borrar la cuenta:** `media_keys` incluye sus audios (`ADR-031`); una prueba recorre `information_schema` y falla si alguna tabla nueva deja de caer en cascada.
- **Editar** un mensaje cambia el texto, **no** el audio.

## 3. Seguridad y privacidad — lo que hay que saber

1. **Las URL son públicas**, igual que las de imágenes (`ADR-039` §3.1): nombre aleatorio de 128 bits, nunca listado, accesible para quien tenga la URL hasta que se borre. Una nota de voz es **dato personal más sensible que una foto** (voz identificable). **Decisión pendiente del equipo:** URL firmadas de vida corta para mensajes directos.
2. **No hay moderación automática de audio.** Solo funciona el reporte manual (`ADR-032` cubre `target_type = message`, pero quien modera hoy no podría **escuchar** el archivo). Hay que decidir cómo se revisa un audio reportado antes del lanzamiento público.
3. **Superficie de ffmpeg.** Decodificar audio de desconocidos con un demuxer de ffmpeg es una superficie de ataque real. Se mitiga con: lista cerrada de contenedores por cabecera, `format=` fijado al detectado, un solo flujo de audio, tope de entrada y de duración, y límite por hora. **Hay que mantener PyAV actualizado** (política de actualización pendiente).
4. **Retención** (`ADR-037`): el audio vive mientras exista el mensaje. No hay barrido de huérfanos periódico (el proyecto no tiene tareas programadas), igual que con las imágenes.
5. **Dictado con Tero:** en Chrome el reconocimiento de voz lo hace el servicio de **Google** y en Safari el de **Apple**: el audio sale del dispositivo hacia ellos, no hacia THERS. La interfaz debe decirlo. Hay que añadirlo al aviso de privacidad (puntos de privacidad abiertos de `ADR-041`).
6. **Procesado en el proceso web.** Decodificar y codificar hasta 2 minutos cuesta CPU en el worker; el límite por hora lo acota, pero a escala conviene una cola y un worker aparte.
7. **Peso del despliegue.** PyAV añade unos **65 MB** (ffmpeg incluido) a la imagen. Hay que tenerlo en cuenta en el hosting (`ADR-018`, sin ratificar).
8. **Permiso de micrófono:** se pide solo al pulsar grabar y nunca antes; si se niega, la interfaz lo explica y el chat sigue funcionando.

## 4. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Guardar el audio tal cual lo manda el cliente | Cada cliente tendría que reproducir todos los formatos (Safari no reproduce `webm/opus`), no se podría validar la duración ni descartar metadatos o cargas escondidas. |
| Convertir con el binario `ffmpeg` del sistema | Obliga a instalarlo en cada entorno; PyAV lo trae empaquetado y no lanza procesos externos. |
| Confiar en la duración que declara el cliente | Un cliente malicioso la falsificaría; la calcula el servidor. |
| Ampliar `media_attachments` con audio | Obliga a relajar `NOT NULL` y el `CHECK` de una tabla ya en uso y a revisar todos sus lectores. |
| Transcribir en un servicio externo (p. ej. Whisper) para Tero | Coste, un proveedor nuevo y el audio saldría hacia un tercero; choca con el tope de gasto y la privacidad de `ADR-041`. |
| Que Tero responda hablando | Función aparte; la cubre `ADR-045-tero-speaks.md`. |

## 5. Fases

1. Este ADR.
2. Backend: procesado, tabla, endpoint, interruptor, límites y pruebas (contra PostgreSQL real).
3. Web: grabar, vista previa, enviar y reproducir en mensajes.
4. App móvil: lo mismo, verificado en el teléfono.
5. Dictado para Tero en la web y en la app.

## 6. Pendiente

URL firmadas para mensajes (§3.1); cómo revisa quien modera un audio reportado (§3.2); política de actualización de PyAV (§3.3); aviso de privacidad (§3.5); forma de onda y velocidad de reproducción; transcripción de notas de voz (accesibilidad); cola de procesado (§3.6).
