# ADR-048 — Chats grupales

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por el
  propietario ("hacer los chats grupales"). La pestaña de mensajes de la app ya tenía un botón «Grupos» que avisaba de
  «próximamente».
- **Fecha:** 2026-10-18
- **Relacionado:** `ADR-013`/`ADR-014`/`ADR-035` (mensajes directos: este ADR los reutiliza), `ADR-024` (quién puede
  escribirme), `ADR-029` (bloqueos), `ADR-039`/`ADR-042`/`ADR-046` (imagen, voz y video en mensajes), `ADR-047`
  (publicaciones compartidas), `ADR-032` (reportes), `ADR-031` (borrado de cuenta), `ADR-028` (exportación).

## 1. Decisión

| Tema | Decisión |
|---|---|
| **Modelo** | Dos tablas nuevas: `group_chats` (`id`, `name` ≤ 60, `created_by`, `created_at`) y `group_members` (`group_id`, `user_id`, `role` `admin`\|`member`, `joined_at`, `last_read_at`; PK compuesta). **Los mensajes siguen en `messages`**: gana `group_id` (FK `ON DELETE CASCADE`), `recipient_id` pasa a *nullable* y un CHECK exige **exactamente uno** de los dos. Así un mensaje de grupo hereda **sin duplicar nada** imágenes, nota de voz, video, lugar y publicación compartidos, edición, borrado e idempotencia (`client_id`). |
| **Quién crea y quién gestiona** | Quien crea es `admin`. Un `admin` renombra, añade, nombra a otros `admin` y saca a **miembros normales**. A otro administrador no se le puede sacar (no existe «quitar administrador»; se va él mismo). Cualquiera puede salir. Máximo **50** personas. |
| **Privacidad al añadir** | Añadir a alguien es escribirle: se exigen las **mismas reglas que un mensaje directo** (bloqueo en cualquier sentido y `who_can_message`, `ADR-024`/`ADR-029`). Una sola respuesta de error (`403`) para todos los motivos, para no revelar un bloqueo. Se elige entre **personas con las que ya hay conversación** en las dos apps (no hay buscador de personas para empezar de cero). |
| **Quién ve qué** | Un grupo del que no eres miembro **no existe** (`404`). Se ve el historial **completo**, también el anterior a entrar (decisión simple; ver §3). Los mensajes de cuentas bloqueadas (en cualquier sentido) **se ocultan** al mirar, y reaparecen al desbloquear. |
| **Leído** | Por miembro: `last_read_at`, no un booleano por mensaje. No leídos = mensajes de **otras** personas posteriores a esa marca. Abrir el grupo la actualiza; **enviar** también (quien escribe ya está mirando). El campo `read` de cada mensaje se calcula **para quien mira** y refleja el estado previo a abrir (para el separador de no leídos, como en `ADR-014`). |
| **Contenido** | Mismo que un directo: texto, una foto, una nota de voz, un video, un lugar o una publicación. Compartir una publicación a un grupo exige que **quien la envía** pueda verla (`ADR-047`); el servidor lo comprueba al enviar. Compartir desde una publicación ahora también permite elegir un grupo (web y app). |
| **Sincronización** | La de siempre: consulta periódica (`ADR-035`). Sin indicador de «escribiendo» en grupos. Los no leídos de los grupos suman a los contadores de la barra. |
| **Reportes** | Un mensaje de grupo lo puede reportar cualquier miembro **menos su autor** (`ADR-032`); un directo, como antes, solo quien lo recibió. |
| **Cuenta eliminada** | Sus mensajes y su pertenencia caen en cascada. Si era la **única** persona de un grupo, este se borra (con los archivos de los mensajes que aún quedaban). Si era el **único administrador**, otro miembro pasa a serlo. Lo mismo al **salir**. `group_chats.created_by` queda en `NULL` (el grupo sobrevive a quien lo creó). |
| **Exportación** | `messages.json` incluye los mensajes que **escribiste** en grupos, con `group_name`. |
| **Tablas / migración** | `group_chats`, `group_members`, `messages.group_id` y `ck_messages_one_target`. Migración `b6f1d8a3c927` (el `downgrade` borra los mensajes de grupo). |

## 2. Qué NO hace

- No cifra de extremo a extremo (igual que los directos).
- No hay enlaces de invitación ni grupos públicos o descubribles: solo se entra si un administrador te añade.
- No hay foto de grupo, ni descripción, ni «solo administradores escriben».
- No hay mensajes de sistema en el hilo («X añadió a Y», «Z salió»): los cambios se ven en la información del grupo.
- No se puede **quitar** el rol de administrador, ni **transferir** la propiedad más allá de lo que ocurre al salir.
- No hay silenciar un grupo ni fijarlo.
- No hay notificaciones push ni insignias por mensaje de grupo: se consulta como los directos.
- Quien entra ve el historial **anterior** a su llegada.
- Un bloqueo **no saca** a nadie de un grupo compartido: solo oculta los mensajes de la otra cuenta a quien bloquea.
- Al salir o eliminarse la última persona se borran los archivos del grupo, pero un grupo con miembros conserva los
  archivos de los mensajes de quien se va (siguen siendo suyos hasta que se borre el mensaje o su cuenta).

## 3. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Tabla `group_messages` aparte | Duplicaría los adjuntos (tres tablas con `message_id` y su CHECK de exclusividad), la edición, el borrado, el reporte y la exportación. Con `group_id` en `messages` todo eso funciona sin tocar. |
| `conversations` + `participants` para **todo** (unificar directos y grupos) | Reescribiría el modelo ya aprobado de los directos (`ADR-013`) y migraría datos reales para ganar poco. Los directos siguen siendo «una vista derivada» entre dos personas. |
| `read_at` por mensaje y por miembro | Una fila por mensaje y miembro; innecesario cuando basta una marca por miembro. |
| Ocultar el historial anterior a la entrada | Obliga a guardar el instante de entrada y a filtrar en cada consulta; se pospone hasta que el equipo lo pida. |
| Quitar la pertenencia de quien bloquea a otro miembro | Sorprendente: se pierde un grupo por un bloqueo. Se prefiere ocultar los mensajes de la cuenta bloqueada. |

## 4. Riesgos y pendientes

- **Moderación:** los grupos son un canal privado más; la moderación de imágenes/video sigue siendo un bloqueante del
  lanzamiento público (`ADR-039`/`ADR-046`) y aplica igual aquí. Un administrador puede añadir a mucha gente (tope 50):
  conviene límite de creación por hora si se abusa (`ADR-027`).
- **Política de privacidad:** debe mencionar los chats grupales (quién ve el historial y qué pasa al salir).
- **Datos:** un grupo con solo bots o cuentas inactivas no se limpia solo; no hay purga programada.

## 5. Verificación

- Backend: `tests/test_group_chats.py` (26 pruebas: creación y reglas de privacidad, roles, salir y borrado de cuenta,
  no leídos por miembro, bloqueos, paginación, edición/borrado, contenido compartido, reportes y exportación) además de
  las suites de mensajes, reportes, exportación, restricciones y borrado de cuenta sin cambios.
- Web y app: pruebas de contrato de las pantallas (`tests/groupChats.test.mjs`), build/tipos limpios y prueba en un
  teléfono real.
