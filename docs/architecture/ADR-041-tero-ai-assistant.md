# ADR-041 — Tero: asistente con IA (chat, herramientas, acciones y automatizaciones)

- **Estado:** **`ACEPTADO`** el 2026-10-17 (PR #97 aprobado por el equipo; proveedor, modelo y
  tope de gasto decididos el mismo día, §4). **Sin implementar:** las Fases 4–7 siguen pendientes.
  **Abiertos todavía:** retención de datos del proveedor (§4), dónde corre n8n (`ADR-018`).
- **Fecha:** 2026-10-17
- **Autor del borrador:** Claude Code, a pedido del propietario del proyecto.
- **Habilita:** Fases 4–7 de `docs/tero/TERO_IMPLEMENTATION_PLAN.md` (chat backend, herramientas de
  lectura, acciones con confirmación, n8n). Lo exige `docs/tero/TERO_PHASE2.md` §6.
- **No cubre:** voz (paso 8 del plan, posterior al MVP) ni Rive (decisión aparte, ver §9).

> Convención de este borrador: lo marcado **[VERIFICADO]** se comprobó en el repositorio. Lo marcado
> **[PROPUESTA]** es una recomendación que el equipo debe aceptar o cambiar. Lo marcado
> **[PENDIENTE]** es una decisión que **no** se puede tomar desde el repositorio y que este ADR deja
> abierta a propósito (proveedor, modelo, costos).

---

## 1. Contexto

### 1.1 Qué existe hoy [VERIFICADO]

- **Fase 1 (UI con datos de ejemplo)** en `feature/tero-phase1-ui`, probada en un moto z3.
- **Fase 2 (animaciones e interactividad)** con `Animated` + SVG, en
  `feature/tero-phase2-animations`. Pruebas físicas de rendimiento pendientes.
- **Idioma (ADR-045 §6):** Tero responde en el idioma en que le escriben (español o inglés).
- Todo vive en `mobile/src/features/tero/`, **encendido por defecto** (2026-10-17, decisión del propietario) con `EXPO_PUBLIC_TERO_ENABLED`; se apaga fijándolo a `false`
  (solo se activa si vale exactamente `true`).
- **No existe** ningún endpoint `/api/tero/*`, ningún módulo `tero` en el backend ni variable de
  entorno de IA. El chat actual responde con mocks tipados.
- `docs/tero/TERO_RESEARCH.md` fija la arquitectura objetivo: *Expo para UI, Flask para auth, tools y
  seguridad, n8n para automatizaciones, **IA sin acceso directo a PostgreSQL***.
- `docs/tero/TERO_PERSONALITY.md` (propuesta pendiente de revisión) fija límites de comportamiento:
  nada por iniciativa propia, sin vigilancia, sin patrones manipulativos.

### 1.2 Qué falta decidir

El backend y los datos de THERS (usuarios privados, mensajes directos, bloqueos, reportes,
ubicación de lugares) son **datos personales sensibles**. Conectar un modelo de lenguaje externo
introduce, por primera vez, tres riesgos que hoy no existen: **fuga de datos hacia un tercero**,
**inyección de instrucciones** (*prompt injection*) y **costo variable por uso**. Este ADR fija
las reglas para que la IA nunca amplíe permisos y para que el costo y la privacidad queden acotados
antes de escribir código.

---

## 2. Decisión

**Tero es una capa de conversación sobre la API existente, nunca un atajo alrededor de ella.**

1. **Flask es la única fuente de autorización y de negocio.** El modelo no ejecuta nada: solo
   propone texto o solicita *herramientas* que el backend decide si ejecuta.
2. **El modelo no toca PostgreSQL ni los repositorios.** Solo llama a *herramientas* que a su vez
   invocan los casos de uso (`application/`) ya existentes, con los permisos del usuario autenticado.
3. **Toda acción con efecto requiere confirmación explícita del usuario** (patrón *pending action*,
   §6). Ningún prompt puede saltársela.
4. **El proveedor de IA va detrás de un puerto** (`domain`/`application`) para poder cambiarlo sin
   tocar el resto.
5. **n8n es infraestructura de automatización, no backend del chat** y nunca fuente de verdad (§7).
6. **Todo es opcional y apagable** por variable de entorno, con una respuesta controlada cuando la
   IA está deshabilitada (§8).

---

## 3. Arquitectura [PROPUESTA]

Sigue la arquitectura hexagonal ya en uso (`BACKEND_ARCHITECTURE.md`):

```
backend/app/
├─ domain/tero/            # entidades, reglas y excepciones; SIN dependencias de Flask
├─ application/tero/       # TeroChatService, casos de uso de herramientas y de acciones,
│                          #   y el PUERTO del proveedor de IA (AiProvider)
├─ infrastructure/ai/      # cliente concreto del proveedor (único lugar que conoce su SDK)
├─ infrastructure/persistence/   # tablas de Tero (§5) y repositorios
└─ interfaces/routes/      # tero_routes.py (blueprint /api/tero/*)
```

El móvil reutiliza `mobile/src/shared/lib/api.ts` (contrato de errores y *timeout* existente) y
sustituye los mocks de `features/tero/` por llamadas reales detrás de la misma interfaz tipada.

### 3.1 Endpoints previstos [PROPUESTA]

| Método | Ruta | Fase | Propósito |
|---|---|---|---|
| `POST` | `/api/tero/chat` | 4 | Enviar un mensaje; devuelve texto y, si aplica, una `confirmation_card` |
| `POST` | `/api/tero/actions/{id}/confirm` | 6 | Confirmar una acción pendiente |
| `POST` | `/api/tero/actions/{id}/cancel` | 6 | Cancelarla |
| `GET` | `/api/tero/settings` | 4 | Preferencias de privacidad de Tero del usuario (si se persisten, §5) |

Todos exigen JWT. Cada endpoint se documenta en `API_CONTRACT.md` el mismo día del PR (`HB-001`
§15.1) y entra en la política de *rate limiting* de `ADR-027` (§8).

---

## 4. Proveedor y modelo — **decidido el 2026-10-17**

`TERO_RESEARCH.md` citaba la guía de inicio de OpenAI como fuente, pero no era una decisión. La
decisión del equipo es:

| Decisión | Valor | Nota |
|---|---|---|
| Proveedor | **Anthropic** (API de Claude) | Detrás del puerto `AiProvider` (§3): se puede cambiar |
| Modelo inicial (`TERO_MODEL`) | **`claude-haiku-5-5`** | Gama económica. Si no alcanza con herramientas o español, subir a `claude-sonnet-5-5` cambiando solo la variable |
| Presupuesto mensual | **USD 20** tope duro | Corte automático a la respuesta controlada (§8.2) |
| Región / retención | **[PENDIENTE]** | Verificar en los términos de Anthropic que las entradas de la API no se usan para entrenar y cuánto se retienen, antes del primer mensaje con datos reales |

**Precio de referencia, sin verificar contra la página oficial:** Haiku 5.5 aparece en fuentes de
terceros a USD 0,10 / 0,50 por millón de tokens (entrada / salida); Sonnet 5.5 a USD 2 / 10. Con
~2.000 tokens de entrada y ~400 de salida por mensaje, Haiku cuesta unos USD 0,40 por cada 1.000
mensajes, de modo que el tope de USD 20 deja un margen amplio. **Confirmar los precios en la página
oficial antes de fijar el tope en código.**

**Elección entre modelos:** antes de pasar a Sonnet se mide con un banco de 20–30 mensajes reales en
español (resumir una publicación, buscar un lugar, proponer seguir a alguien): aciertos con
herramientas, latencia y costo.

**Requisitos mínimos para aceptar un proveedor** [PROPUESTA]: que permita desactivar el
entrenamiento con nuestros datos, que soporte llamadas a herramientas con esquema JSON estricto y
que tenga *timeout* y cuotas configurables. La clave de API vive **solo en el backend** (variable de
entorno, igual que `JWT_SECRET_KEY`); **nunca** en el móvil ni en el bundle (`EXPO_PUBLIC_*` se
embebe en el APK).

---

## 5. Datos y privacidad [PROPUESTA]

### 5.1 Qué recibe el modelo

- **Mínimo necesario por petición.** Mensaje del usuario + contexto reducido
  (`screen`, `entity_type`, `entity_id`) + resultado de las herramientas que el backend ejecutó.
- **`entity_id` del móvil no es de confianza:** el backend lo revalida contra el JWT y los permisos
  antes de usarlo.
- **Nunca se envían:** contraseñas, tokens, correos o teléfonos de terceros, mensajes directos,
  contenido de cuentas privadas que el usuario no puede ver, ni datos de usuarios bloqueados o
  restringidos (`ADR-029`). La visibilidad que ve el modelo es **exactamente** la que vería el
  usuario en la app.
- Los serializadores de las herramientas devuelven solo los campos necesarios (no el modelo ORM).

### 5.2 Qué se guarda

| Dato | Decisión propuesta |
|---|---|
| Historial de conversación | **No se persiste en el MVP.** Vive en memoria del dispositivo. Persistirlo exige su propia decisión (retención, borrado, exportación `ADR-028`) |
| `pending_actions` | Sí (§6): id, usuario, acción, parámetros, estado, `expires_at` |
| Registro de herramientas | Sí: herramienta, usuario, latencia, resultado resumido. **Sin secretos ni contenido de mensajes** |
| Preferencias de privacidad de Tero | Opcional; hoy son locales (`preferencesStore.ts`) |

Si se añaden tablas, requieren migración Alembic y entrada en `DATABASE_ARCHITECTURE.md`. El borrado
de cuenta (`account_deletion`) y la exportación de datos deben cubrirlas.

### 5.3 Consentimiento

Tero está **apagado por defecto** y el usuario lo activa. Antes del primer mensaje real a la IA se
muestra un aviso claro de que el texto se envía a un proveedor externo. Esto debe revisarse contra
la política de privacidad publicada antes del lanzamiento (`docs/LAUNCH_CHECKLIST.md`).

---

## 6. Herramientas y acciones [PROPUESTA]

### 6.1 Herramientas de solo lectura (Fase 5)

`profile.read`, `notifications.summary`, `users.search`, `post.read`, `places.search`
(`places` ya existe, `ADR-040`).

Reglas vinculantes para cada herramienta:

1. El modelo **nunca** llama a un repositorio; la herramienta llama a un caso de uso existente.
2. Esquema JSON estricto de entrada, nivel de riesgo declarado y serializador mínimo.
3. Se revalidan JWT y permisos en cada llamada, no una vez por conversación.
4. Se registra herramienta, resultado y latencia, sin secretos.
5. **Un texto leído por una herramienta es dato, no instrucción.** Una publicación, bio o comentario
   que diga «ignora tus reglas» no puede elevar permisos ni disparar acciones (inyección indirecta).

### 6.2 Acciones con efecto (Fase 6) — siempre con confirmación

Alcance inicial: `profile.update`, `saved_post.create/remove`, `follow.create/remove`.

**Excluidas por decisión** (el prompt de fase 6 ya lo prohíbe): contraseña, correo, 2FA, borrado de
cuenta, bloqueo y cualquier acción de moderación.

Flujo obligatorio:

```
IA propone → backend valida y crea pending_action (con expiración)
          → chat devuelve confirmation_card (NO ejecuta)
          → el usuario confirma explícitamente
          → /confirm revalida JWT, dueño, expiración y estado
          → ejecuta el caso de uso existente (idempotente) → auditoría
```

Pruebas obligatorias: confirmación ajena, doble confirmación, expiración, permiso denegado y éxito.

---

## 7. n8n (Fase 7) [IMPLEMENTADO en código, apagado por defecto]

> **Implementación (2026-10-17):** decisiones del propietario: el aviso de reporte lo **envía n8n por
> correo**, genérico y con datos mínimos; el resumen semanal es **solo para quien lo active**
> (`weekly_summary_email`, apagado por defecto). Firma HMAC en ambos sentidos, API interna firmada
> (sin JWT), acuse idempotente, fallos de n8n nunca rompen la resolución. Contrato: `API_CONTRACT.md`
> §4.38; operación y flujos: `docs/n8n/`. Verificado con n8n real en Docker y un Resend simulado.
> Sigue bloqueado para producción por el hosting (`ADR-018`) y la elección del proveedor de correo.

- **Uso permitido:** resumen semanal de actividad y aviso de cambio de estado de un reporte.
- Flask autoriza; n8n recibe **datos mínimos** y nunca credenciales de PostgreSQL. Se prefiere una API
  interna limitada.
- Comunicación backend→n8n firmada con secreto (`N8N_WEBHOOK_SECRET`), con *idempotency key*,
  *timeouts* y reintentos acotados. El secreto nunca llega al móvil.
- Variables: `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `TERO_AUTOMATIONS_ENABLED`; cliente detrás de
  una interfaz (`n8n_client.py`).
- **Bloqueado por DevOps:** `CLAUDE.md` §5/§15 indica que el despliegue (hosting, dominios,
  monitoreo) **no está especificado** (`ADR-018` sigue sin ratificar). Dónde corre n8n es una
  decisión pendiente de ese ADR.

---

## 8. Seguridad, costo y operación [PROPUESTA]

### 8.1 Interruptores

| Variable | Efecto |
|---|---|
| `TERO_ENABLED` | Apaga todo el módulo; los endpoints responden de forma controlada |
| `TERO_AI_ENABLED` | Apaga solo la llamada al proveedor (útil en *staging*: respuesta fija) |
| `TERO_MODEL` | Modelo concreto (§4) |
| `EXPO_PUBLIC_TERO_ENABLED` | Ya existente; solo muestra u oculta la UI. **No es un control de seguridad** |

### 8.2 Límites

- **Rate limiting** propio de Tero dentro de `ADR-027` (por usuario y por IP), más bajo que el de
  endpoints normales porque cada mensaje cuesta dinero.
- Longitud máxima de mensaje, máximo de herramientas por turno y *timeout* de proveedor.
- **Tope de gasto mensual** con corte automático a la respuesta controlada **USD 20 al mes** (§4).
- Errores del proveedor se traducen a errores genéricos del contrato de `API_CONTRACT.md`; nunca se
  filtran detalles internos, claves ni trazas.

### 8.3 Pruebas

`pytest` con **proveedor simulado** (no se llama a la IA real en CI): 401, 400, módulo deshabilitado,
éxito, *timeout*, inyección indirecta en una herramienta, y las pruebas de §6.2.

---

## 9. Qué no decide este ADR

- **Rive.** Requiere un `tero.riv` entregado por diseño y elegir entre `rive-react-native` y
  `@rive-app/react-native` tras probar en dispositivo (`TERO_PHASE2.md` §5). Va en su propio ADR.
- **Voz.** Posterior al MVP.
- **Persistencia del historial.** Fuera del MVP (§5.2).
- **Dónde se despliega** el backend con IA y n8n (`ADR-018`).

---

## 10. Opciones consideradas

| Opción | Veredicto |
|---|---|
| **A. Flask como único orquestador; IA solo propone, herramientas y acciones pasan por casos de uso** | **Recomendada.** Reutiliza autorización existente, es auditable y acota el daño de una inyección |
| B. n8n como backend del chat | Descartada: parte la autorización en dos sistemas y n8n pasaría a ser fuente de verdad |
| C. El móvil llama directo al proveedor | Descartada: expone la clave en el APK y se pierde toda autorización |
| D. Dar al modelo acceso a la base de datos | Descartada: contradice `TERO_RESEARCH.md` y rompe el aislamiento por usuario |

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Fuga de datos personales al proveedor | Mínimo necesario (§5.1), consentimiento, proveedor sin entrenamiento con nuestros datos |
| Inyección de instrucciones vía contenido de usuarios | Herramientas = datos, no instrucciones; confirmación obligatoria; permisos revalidados |
| Costo descontrolado | Rate limit, tope mensual, interruptores (§8) |
| Alucinaciones que parezcan hechos de la app | Las respuestas con datos salen de herramientas; la UI distingue texto del modelo de datos reales |
| Dependencia de un proveedor | Puerto `AiProvider` (§3) |
| Tero invasivo | Se mantienen las reglas de `TERO_PERSONALITY.md`: nada por iniciativa propia |

---

## 12. Plan por fases tras la ratificación

| Fase | Entrega | Requiere de este ADR |
|---|---|---|
| 4 | Chat backend + puerto de IA + interruptores + tests con proveedor simulado | §3, §4, §8 |
| 5 | Herramientas de lectura | §5.1, §6.1 |
| 6 | Acciones con confirmación | §6.2 |
| 7 | n8n | §7 y `ADR-018` |

## 13. Documentos relacionados

`docs/tero/TERO_IMPLEMENTATION_PLAN.md` · `TERO_RESEARCH.md` · `TERO_PHASE2.md` ·
`TERO_PERSONALITY.md` · `TERO_CLAUDE_PROMPTS.md` · `ADR-027` (rate limiting) · `ADR-028`
(exportación de datos) · `ADR-029` (bloqueo y restricción) · `ADR-040` (places) · `ADR-018`
(hosting, sin ratificar) · `API_CONTRACT.md` · `DATABASE_ARCHITECTURE.md`.
