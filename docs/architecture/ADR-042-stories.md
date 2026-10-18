# ADR-042 — Historias (contenido efímero de 24 horas)

- **Estado:** **`PROPUESTO` — aprobado por el propietario del proyecto el 2026-10-17 para su
  implementación; pendiente de revisión del equipo** (`HB-001` §11–12). Implementado en las ramas
  `feature/stories`, `feature/stories-web` y `feature/stories-mobile` (§10).
- **Fecha:** 2026-10-17
- **Autor del borrador:** Claude Code, a pedido del propietario del proyecto.
- **Relacionado:** `ADR-039-images-in-posts-and-messages.md` (imágenes y almacenamiento),
  `ADR-037-data-retention.md` (purga programada), `ADR-029` (bloqueo y restricción),
  `ADR-022` (cuentas privadas), `ADR-031` (eliminación de cuenta), `ADR-032`/`ADR-038` (reportes),
  `ADR-027` (límites de uso). Video: ver `ADR-043` (pendiente de redactar).

> Convención: **[VERIFICADO]** se comprobó en el repositorio · **[PROPUESTA]** el equipo debe
> aceptarla o cambiarla · **[PENDIENTE]** no se puede decidir desde el repositorio.

---

## 1. Contexto

### 1.1 Qué existe hoy [VERIFICADO]

- **Web:** el ítem de navegación con ícono `history_toggle_off` corresponde a «Cápsulas», no a
  historias. No hay tira de historias en el feed.
- **Móvil:** `mobile/app/(tabs)/home.tsx` muestra «Tu historia» con un `+`, pero solo llama a
  `comingSoon('Las historias')`. No se simulan datos.
- **Backend:** no existe ninguna tabla, modelo ni ruta de historias.
- **Imágenes:** `ADR-039` ya procesa y guarda imágenes (hasta 5 MiB, JPEG/PNG/WebP, re-codificadas a
  WebP, sin EXIF) en un único bucket **público** con nombres aleatorios. **No hay soporte de video**
  ni de GIF animado.
- **Purga programada:** `backend/scripts/purge_expired_data.py` está pensado para un Cron Job diario
  de Render (`ADR-037`). Un trabajo diario **no basta** para ocultar una historia a las 24 h exactas:
  ver §3.4.
- **Privacidad:** existen cuentas privadas, bloqueo y restricción (`ADR-022`, `ADR-029`). Una
  historia debe respetarlos igual que una publicación.

### 1.2 Qué problema resuelve

El diseño aprobado (`THERS_IMPLEMENTACION_MAESTRA_CLAUDE.md`) muestra una tira de historias en el
inicio. Hoy es un botón que dice «Próximamente». El propietario pide que sean reales.

---

## 2. Decisión propuesta

| Tema | Propuesta |
|---|---|
| Qué es una historia | Una **imagen** (1 por historia) con texto opcional de hasta 200 caracteres. **Sin video en la primera versión** (ver §6). |
| Duración | **24 horas** desde la creación. Pasado ese tiempo ya no se lista ni se sirve. |
| Quién la ve | Quien **sigue** a la autora o autor con seguimiento aceptado, más esa persona. En cuentas públicas se propone **solo seguidores**, no cualquiera: evita una vía de acoso a desconocidos. **[PENDIENTE]** si las cuentas públicas deben mostrarse a todos. |
| Bloqueo y restricción | Una persona bloqueada o que bloquea **no ve** la historia ni aparece en la tira (`ADR-029`). |
| Vistas | Se registra **quién la vio** (una fila por persona e historia). Solo la autora ve la lista y el conteo. |
| Respuestas | **Fuera de la primera versión.** Responder a una historia sería un mensaje con contexto, que exige `message_type` (`ADR-040` §6, fase 4). |
| Reacciones | Fuera de la primera versión. |
| Borrado | La autora puede borrar su historia antes de las 24 h; se borran el archivo y las vistas. |
| Eliminación de cuenta | Las historias y sus archivos entran en `media_keys` de `ADR-031`. |
| Moderación | Reportable con el flujo de `ADR-032` (nuevo tipo `story`). Aplica `ADR-038` a imágenes. |

---

## 3. Modelo de datos [PROPUESTA]

### 3.1 Tablas nuevas

- **`stories`**: `id` (uuid), `author_id` → `users` (`ON DELETE CASCADE`), `content` (texto,
  nullable, ≤ 200), `storage_key` (único), `width`, `height`, `created_at`, `expires_at`
  (`created_at + 24 h`, **guardado**, no recalculado). Índice por `(author_id, expires_at)`.
- **`story_views`**: `(story_id, viewer_id)` como clave primaria compuesta, `viewed_at`.
  `ON DELETE CASCADE` en ambas claves.

`expires_at` se guarda para que cambiar la duración en el futuro no reescriba historias existentes.

### 3.2 API [PROPUESTA]

Se documentaría en `API_CONTRACT.md` el mismo día del PR (`HB-001` §15.1).

| Método y ruta | Uso |
|---|---|
| `POST /api/stories` | `multipart/form-data` con `image` y `content` opcional. Devuelve `201`. |
| `GET /api/stories` | La tira: una entrada por autora o autor con historias vigentes, con `has_unseen`. Solo seguidos aceptados y yo. |
| `GET /api/users/<id>/stories` | Historias vigentes de una persona, si se me permite verlas. |
| `POST /api/stories/<id>/view` | Registra la vista. Idempotente. |
| `GET /api/stories/<id>/views` | Solo la autora: quién la vio. |
| `DELETE /api/stories/<id>` | Solo la autora. `404` indistinguible si no existe o no es suya (mismo criterio que `ADR-020`). |

Una historia vencida responde `404`, igual que una inexistente.

### 3.3 Límites [PROPUESTA]

Regla nueva de `ADR-027`: **20 historias por día y cuenta**. Reutiliza el procesado de `ADR-039`
(mismos límites de tamaño y píxeles).

### 3.4 Caducidad [PROPUESTA]

Dos mecanismos, porque el Cron diario de Render no alcanza:

1. **Lectura:** toda consulta filtra `expires_at > now()`. Es lo que garantiza que ninguna historia
   vencida se vea, aunque el archivo siga ahí.
2. **Purga:** `purge_expired_data.py` borra filas y archivos vencidos (los archivos con un margen de
   unas horas). Si el Cron falla un día, lo único que ocurre es que ocupan espacio de más.

---

## 4. Seguridad y privacidad

1. **El bucket es público** (`ADR-039` §3). Quien tenga la URL de una historia la puede abrir **sin
   iniciar sesión**, incluso vencida, mientras el archivo exista. La defensa es el nombre aleatorio
   de 128 bits y la purga. Una historia de una cuenta privada tiene el mismo riesgo que ya tiene una
   foto de una publicación privada.
   **[PENDIENTE]** Si el equipo lo considera inaceptable para historias, la alternativa es el
   bucket privado con URLs firmadas que `ADR-040` ya exige para los reclamos de negocio
   (`backend/app/domain/media/private_storage.py`). Es más seguro y más costoso.
2. **Sin moderación automática de imágenes** (`ADR-039` §3): solo reporte manual. El contenido
   efímero es más difícil de moderar porque desaparece. Hay que conservar lo reportado el tiempo que
   fije `ADR-037`. **Bloquea el lanzamiento público**, igual que en `ADR-039`.
3. **Las vistas son datos personales.** Entran en la exportación (`ADR-028`) y en la eliminación
   (`ADR-031`). Un bloqueo posterior no borra vistas anteriores.
4. **Capturas de pantalla:** no se pueden impedir. La interfaz no debe prometer lo contrario.

---

## 5. Clientes [PROPUESTA]

- **Web:** tira en `Home.jsx`; visor de pantalla completa con barra de progreso; compositor con
  recorte y vista previa.
- **Móvil:** la tira de `home.tsx` deja de usar `comingSoon`; visor y compositor propios.
- Los estados de carga, vacío y error se distinguen (regla de `THERS_IMPLEMENTACION_MAESTRA_CLAUDE.md`).
  No se simula ninguna historia.

---

## 6. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Historias como `posts` con `expires_at` | Mezcla contenido efímero con el feed, los conteos y la edición de `ADR-021`. Cada consulta de posts tendría que excluirlas. |
| Video desde el inicio | Exige transcodificación, límites de duración y almacenamiento mayores. Va en `ADR-043`. |
| Caducar solo con el Cron diario | Una historia seguiría visible hasta 24 h de más. |
| Visibles para cualquiera | Abre un canal de acoso a desconocidos. |

---

## 7. Riesgos

1. **Costo de almacenamiento** en el plan gratuito de Supabase (1 GB). 20 historias por día y cuenta,
   a unos 200 KB cada una, son unos 4 MB diarios por cuenta activa. La purga es obligatoria, no
   opcional.
2. **Abuso:** historias para publicar contenido ilegal que desaparece. Mitigación parcial: el límite
   diario y la retención de lo reportado.
3. **Sin push:** no hay notificación de «nueva historia»; se ve al abrir la app.
4. **Zona horaria y reloj del cliente:** `expires_at` se calcula siempre en el servidor.

---

## 8. Decisiones que el equipo debe tomar

| # | Pregunta | Recomendación |
|---|---|---|
| D1 | ¿Bucket público o privado con URLs firmadas? | Público para una primera versión de prueba; privado antes de abrir al público. |
| D2 | ¿Quién ve una historia de una cuenta pública? | Solo seguidores. |
| D3 | ¿Aprobar el tipo de reporte `story`? | Sí, reutiliza `ADR-032`. |
| D4 | ¿24 h fijas o configurable? | Fijas en la v1. |
| D5 | ¿Se permite video en la v1? | No; `ADR-043`. |

## 9. Criterios de aceptación

Si se aprueba: migración aditiva con `upgrade`/`downgrade`; pruebas contra PostgreSQL real para
crear, listar, vencer (con reloj controlado), bloqueo, cuenta privada, borrado y límite diario;
documentación en `API_CONTRACT.md`; actualización de `DATABASE_ARCHITECTURE.md`, de la exportación
(`ADR-028`) y de `media_keys` (`ADR-031`).

## 10. Implementación (backend, 2026-10-17)

Hecho en `feature/stories`: migración `d1e5b8f2a640` (`stories`, `story_views`), los seis endpoints
de §3.2 (documentados en `API_CONTRACT.md` §4.38), límite de 20 por día (`STORY_CREATE`), purga en
`scripts/purge_expired_data.py`, exportación (`ADR-028`) y recogida de archivos al eliminar la cuenta
(`ADR-031`). 29 pruebas contra PostgreSQL real en `tests/test_stories.py`, y `upgrade`/`downgrade`
verificados.

Decisiones tomadas al implementar, que el equipo puede cambiar:
- **D1:** bucket público (el existente). **D2:** solo seguidores aceptados. **D4:** 24 horas fijas.
  **D5:** sin video.
- `GET /api/users/<id>/stories` devuelve lista vacía, no 404, para no revelar cuentas privadas.
- Ver la propia historia no cuenta como vista.
- **No se hizo (D3):** el tipo de reporte `story` en `ADR-032`.
- **Clientes (2026-10-17):** la web reemplaza la fila de «Momentos» de ejemplo por historias reales
  (tira, visor, subida con reducción en el navegador, borrado y lista de vistas). La app reemplaza el
  «Próximamente» de «Tu historia» por la tira real, el visor y la subida con `expo-image-picker`
  (dependencia nativa nueva: **hace falta recompilar la app**). Sin probar en pantalla todavía.

## 11. Integración con `develop` y flag (2026-10-17)

Las tres ramas (`feature/stories`, `-web`, `-mobile`) se integraron sobre `develop` (que ya incluía
Tero, PR #99) en `feature/stories-integration`, **sin reescribir sus commits**.

- **Conflictos resueltos conservando ambos lados:** `models.py` (Tero e Historias añadieron clases
  al mismo punto), `conftest.py` (lista de `TRUNCATE`) y `API_CONTRACT.md`. Tero ya usaba las
  versiones 0.57–0.59 y la sección §4.37, así que **Historias pasó a v0.60 y §4.38**.
- **Alembic:** `develop` terminaba en `c4f8a2d6e913` e Historias colgaba de `c9d4a1e7b362`: dos
  cabezas. Se añadió la revisión de unión `c8dcd63b24d4`, vacía; no se editó ninguna migración.
- **Flag `STORIES_ENABLED`, apagado por defecto.** Apagado, las seis rutas responden `404` (igual que
  una URL inexistente, con o sin sesión) antes de autenticar. La purga de historias vencidas sigue
  corriendo aunque el flag esté apagado: borra datos, no publica.

### Riesgos que siguen abiertos (no se resolvieron aquí a propósito)

1. **Bucket público.** Quien tenga la URL de la imagen la abre sin sesión, también de una cuenta
   privada y también ya vencida mientras el archivo exista (hasta 6 h más). La defensa es el nombre
   aleatorio de 128 bits. La alternativa (bucket privado con URL firmada, como
   `domain/media/private_storage.py`) exige un diseño y una migración de claves que **no están
   autorizados**.
2. **Sin `moderation_status`.** Lo publicado se ve sin revisión previa. Lo propone `ADR-044`
   (borrador); no se implementó un motor de moderación improvisado.
3. **Sin tipo de reporte `story`** (ADR-032, decisión D3 de este ADR).

**Por eso el flag debe seguir apagado en cualquier entorno público** hasta resolver, como mínimo, los
puntos 1 y 2.
