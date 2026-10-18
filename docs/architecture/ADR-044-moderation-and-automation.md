# ADR-044 — Moderación híbrida y automatización con n8n

| Campo | Valor |
|---|---|
| Documento | `docs/architecture/ADR-044-moderation-and-automation.md` |
| Tipo | Architecture Decision Record (`HB-001` §11–12) |
| Versión | 2 — **lista para ratificación** (incorpora las 10 decisiones del propietario, 2026-10-18) |
| Estado | **`PROPUESTA — PENDIENTE DE RATIFICACIÓN`**. Pasa a `Aceptada` solo cuando se cumpla el procedimiento de [`MODERATION_APPROVAL_MATRIX.md`](MODERATION_APPROVAL_MATRIX.md) §1. Hasta entonces **no se crea tabla, migración, ruta, flujo ni pantalla** |
| Fecha | 2026-10-18 (v1: 2026-10-17) |
| Autor | Claude Code, a pedido del propietario del proyecto (`HB-001` §19: la IA no es la única autoridad) |
| Amplía a | `ADR-032` (reportes y moderación) y `ADR-038` (seguridad infantil). **No los reemplaza** |
| Relacionado | `ADR-045` (proveedor de IA compartido), `ADR-026` (2FA), `ADR-027` (límites de uso), `ADR-028` (exportación), `ADR-031` (eliminación de cuenta), `ADR-037` (retención), `ADR-039` (imágenes), `ADR-042` (Historias, rama `docs/adr-042-stories`), `ADR-043` y su enmienda `ADR-043-A` (video/Mux, ramas `docs/adr-043-videos` y `docs/architecture-diagrams`) |
| Alcance de la primera implementación | [`MODERATION_IMPLEMENTATION_SCOPE.md`](MODERATION_IMPLEMENTATION_SCOPE.md) |

> Convención: **[VERIFICADO]** comprobado en el repositorio (`develop` `db84edc`) · **[DECISIÓN]**
> propuesta del propietario, pendiente de ratificación · **[PROPUESTA]** diseño de Claude Code que el
> equipo debe aceptar o cambiar · **[PENDIENTE]** no se puede decidir desde el repositorio.

---

## 1. Contexto

### 1.1 Qué existe hoy [VERIFICADO]

- Tabla `reports` y cola de reportes con prioridad `critical` decidida por el servidor para
  `child_safety`; acciones `dismiss`, `remove_content` y `suspend_user`; la suspensión revoca sesiones
  y tokens; panel web `Frontend/src/features/moderation/` (`ADR-032` fases 1–2, `ADR-038`).
- Rol único `users.is_moderator` (booleano), asignado solo por línea de comandos; los endpoints de
  moderación responden `404` a quien no lo es.
- `admin_audit_log` (`actor_id`, `action`, `resource_type`, `resource_id`, `changes`), usado hoy
  **solo** por lugares y reclamos. Las resoluciones de reportes no pasan por él.
- Rate limiting (`ADR-027`), purga (`ADR-037`), Resend, Sentry opcional, 2FA por TOTP (`ADR-026`).
- Imágenes en `media_attachments` (publicaciones, mensajes, reseñas de lugares; `ADR-039`/`ADR-040`),
  **sin estado de moderación**: se ven apenas se suben.

### 1.2 Qué no existe [VERIFICADO]

Estado de moderación del contenido, cola de trabajos, worker, clasificadores, apelaciones, roles
distintos de «moderador», 2FA obligatoria para moderación, estadísticas de plataforma y feature flag de
moderación. Historias (rama `feature/stories-integration`, sin fusionar) se publica sin revisión previa.

### 1.3 Problema

Abrir imágenes, historias y, más adelante, video a personas reales exige que lo nuevo y dudoso no sea
visible sin una revisión proporcional al riesgo, y que un equipo de cuatro personas pueda atender la
cola. La automatización reduce carga; **no sustituye** la revisión humana de lo grave.

---

## 2. Decisión

Las filas marcadas **[DECISIÓN]** son las diez decisiones del propietario del 2026-10-18.

| # | Tema | Decisión |
|---|---|---|
| 1 | Autoridad | **[DECISIÓN]** Flask y PostgreSQL son los únicos que escriben el estado de moderación y toman las decisiones. La IA y los clasificadores **proponen señales**; n8n **notifica y escala**; ninguno de los dos escribe un estado |
| 2 | Límite de la IA | **[DECISIÓN]** La IA puede clasificar y recomendar aprobar o retener. **Nunca** sanciona, suspende, banea ni rechaza de forma definitiva |
| 3 | Cuentas nuevas | **[DECISIÓN]** Controles reforzados durante los primeros **7 días** desde el registro, con revisión humana cuando el riesgo lo requiera. El plazo es un parámetro de configuración (`MODERATION_NEW_ACCOUNT_DAYS`, 7 por defecto) |
| 4 | Apelaciones | **[DECISIÓN]** Las revisa una persona **distinta** a quien tomó la decisión original. Objetivo de respuesta: **72 horas** |
| 5 | Roles y 2FA | **[DECISIÓN]** Las cuentas moderadoras exigen 2FA (`ADR-026`) y **roles separados** (`reviewer`, `child_safety`, `admin`) |
| 6 | Reportes críticos | **[DECISIÓN]** Se notifican **directamente desde Flask por Resend**, sin depender de n8n |
| 7 | n8n | **[DECISIÓN]** n8n Cloud es la opción preferida para automatizaciones; **contratación pendiente** |
| 8 | IA reutilizada | **[DECISIÓN]** Se aprovecha el puerto `AiProvider` de Tero para clasificación de texto, con cuotas, prompts, credenciales y registros separados (`ADR-045`) |
| 9 | Imágenes | **[DECISIÓN]** Amazon Rekognition es la **primera opción a evaluar**. No es una elección ni una contratación |
| 10 | Abuso sexual infantil | **[DECISIÓN]** La detección especializada y la asesoría legal siguen **pendientes**. **No se autoriza la subida pública de Reels** (D3 de `ADR-043` se mantiene) |

### 2.1 Estado de moderación [PROPUESTA]

Columna `moderation_status` con valores `pending`, `approved`, `held`, `rejected`.

- **Contenido existente:** la migración lo marca `approved` al agregar la columna. **Ninguna publicación
  antigua deja de verse.**
- **Contenido nuevo:** el valor por defecto de la columna en la base es `pending` (**falla cerrado**:
  si el código olvida fijarlo, no se publica). La aplicación lo fija explícitamente: `approved` con la
  moderación apagada, `pending` con ella encendida. Esto evita que lo creado mientras el flag está
  apagado quede oculto al encenderlo.
- **Visibilidad:** con `MODERATION_ENABLED` encendido, toda consulta pública exige
  `moderation_status = 'approved'`. Con el flag apagado el comportamiento actual no cambia.
- **Quién lo ve:** la persona autora siempre ve lo suyo, con su estado. Un `held` o `pending` nunca es
  visible para terceros, en listados, búsqueda, notificaciones ni mensajes.

### 2.2 Procesamiento [PROPUESTA]

Tabla `moderation_jobs` como *outbox* transaccional: el trabajo se crea en la **misma transacción**
que el contenido. Un worker lo reclama con `FOR UPDATE SKIP LOCKED`, con reintentos y espera
creciente. `idempotency_key` único evita trabajos duplicados; un trabajo `dead` deja el contenido en
`pending` o `held`, **nunca** en `approved`. El payload lleva identificadores, no contenido.

### 2.3 Motor de políticas [PROPUESTA]

Función pura en `domain/` que combina señales, edad de la cuenta (decisión 3), historial y reportes.
Los umbrales son parámetros revisables, no verdades.

- Limpio y de cuenta con historial, sin señal alta → `approved`.
- Dudoso, **cuenta con menos de 7 días** o señal media → `held`.
- Señal grave o reporte de seguridad infantil → `held` con prioridad `critical`, aviso directo
  (decisión 6) y cola del rol `child_safety`.
- Fallo de proveedor, esquema inválido de la IA o trabajo `dead` → `pending`/`held`. Nunca `approved`.
- El motor **no** puede producir `rejected` ni una sanción: `rejected` y las sanciones solo las
  escribe una persona.

### 2.4 Auditoría [PROPUESTA]

`admin_audit_log` se amplía con la columna `actor_kind` (`human` | `system`, por defecto `human`) para
registrar también decisiones automáticas, resoluciones de reportes y sanciones. Toda transición de
`moderation_status` deja una fila con actor, motivo y versión del motor. Sin contenido evaluado.

### 2.5 Roles y 2FA [PROPUESTA]

`moderation_role` (`reviewer`, `child_safety`, `admin`), asignado **solo** por línea de comandos.
`users.is_moderator` se conserva durante la transición y equivale a `reviewer`. Un moderador no actúa
sobre su propia cuenta (existe) ni revisa su propia apelación. Los moderadores comunes **no revisan**
material sospechoso de abuso infantil. Sin 2FA activa, el rol no concede acceso.

### 2.6 Panel [PROPUESTA]

Se amplía `Frontend/src/features/moderation/`; **no hay segundo panel**. Pestañas: Reportes (existe),
Retenidos, Apelaciones, Estadísticas y Auditoría. La autorización es del backend; ocultar botones
no cuenta como control.

### 2.7 Apelaciones [PROPUESTA]

Tabla `moderation_appeals`. Una apelación solo la resuelve alguien con `reviewer_id` distinto de quien
decidió; el objetivo de 72 h es una alerta de plazo, no una decisión automática.

### 2.8 n8n [PROPUESTA]

- Flask → n8n: tabla `domain_events` (outbox con `idempotency_key`), HTTPS firmado con HMAC-SHA256 y
  marca de tiempo, **solo identificadores, categorías y conteos**; nunca texto, imágenes ni correos.
- n8n → Flask: rutas `/api/internal/*`, token de servicio de alcance mínimo y firma; solo agregados y
  creación de avisos.
- **Prohibido para n8n:** aprobar, rechazar, sancionar, leer contenido y escribir estados.
- **Si n8n falla:** el contenido sigue sin publicarse (la visibilidad vive en la base) y los reportes
  críticos salen igual por Resend (decisión 6).
- Barridos periódicos (trabajos `dead`, huérfanos, plazos) en el Cron de la plataforma de hosting.
- **No se crea cuenta, flujo ni credencial de n8n hasta que se contrate** (decisión 7).

### 2.9 Clasificación de imágenes [PROPUESTA]

Se define un **puerto** `ImageClassifier` en `domain/`. En la primera implementación solo existe un
adaptador simulado para pruebas. Amazon Rekognition se evalúa después (precio, región, retención y
términos verificados en la fuente oficial) y entra como adaptador nuevo, tras otra aprobación de gasto.
**Se envía a Rekognition solo contenido que no sea sospechoso de abuso infantil** (§3).

---

## 3. Seguridad infantil [DECISIÓN 10 y PENDIENTE]

1. D3 de `ADR-043` sigue en pie: **no hay subida pública de video** hasta que la solución esté
   evaluada, implementada, probada y aprobada. Un proveedor de video o un clasificador general no
   cuentan como moderación suficiente. Los flags de video y Reels permanecen apagados.
2. El material sospechoso de abuso sexual infantil **no se envía a ningún modelo de propósito general
   ni a Rekognition como sustituto** de una solución especializada.
3. **[PENDIENTE]** Elegir y cotizar la solución especializada (huellas contra bases conocidas, servicios
   comerciales, herramientas de una red de distribución). Ninguna cubre sola el material nuevo; ninguna
   tiene elegibilidad ni precio verificados.
4. **[PENDIENTE — asesoría legal]** Protocolo para contenido ilegal grave: qué se conserva, cómo y por
   cuánto, quién lo ve, a quién se denuncia y bajo qué obligaciones en El Salvador y ante las
   plataformas de distribución. No se inventa aquí.
5. La infraestructura base (`moderation_status`, trabajos, auditoría) **no depende** de resolver 3 y 4,
   porque no abre ninguna superficie nueva de subida.

## 4. Retención [PROPUESTA]

`moderation_results` no guarda el contenido evaluado y se conserva por el plazo que fije `ADR-037`. La
evidencia retenida de un reporte la fija el equipo con asesoría legal. Las apelaciones entran en la
exportación (`ADR-028`) y en la eliminación de cuenta (`ADR-031`).

## 5. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| n8n como motor de decisiones | Una falla de n8n sería una falla de seguridad |
| Segundo panel de administración | Duplica permisos y auditoría |
| Moderación solo *a posteriori* | Lo efímero (historias) desaparece antes de revisarse |
| Sanciones automáticas por IA | Falsos positivos sin revisión; contra `ADR-032` y la decisión 2 |
| Un modelo general como detector de abuso infantil | No es fiable para ello |
| `DEFAULT 'approved'` permanente en la columna | Un olvido del código publicaría lo nuevo sin revisión |

## 6. Consecuencias y riesgos

1. **Operación:** sin personas que atiendan la cola, el sistema solo almacena. Depende de D5 de la matriz.
2. **Falsos positivos y negativos:** por eso las señales solo informan.
3. **Cuentas moderadoras comprometidas:** 2FA obligatoria y auditoría.
4. **Costos variables:** topes por propósito (`ADR-045`) y alertas.
5. **Privacidad:** textos de terceros hacia un proveedor (`ADR-045` §5); exige actualizar la política.
6. **Esquema compartido:** las migraciones deben colgar de una única cabeza (`ADR-042` §11 documenta
   cómo se fusionaron las de Tero e Historias); cada una es aditiva y reversible.

## 7. Criterios de aceptación

Definidos en [`MODERATION_IMPLEMENTATION_SCOPE.md`](MODERATION_IMPLEMENTATION_SCOPE.md) §4 y §5.

## 8. Decisiones por ratificar

La matriz completa, con quién debe aprobar cada una, está en
[`MODERATION_APPROVAL_MATRIX.md`](MODERATION_APPROVAL_MATRIX.md).
