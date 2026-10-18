# ADR-045 — Proveedor de IA compartido entre módulos

| Campo | Valor |
|---|---|
| Documento | `docs/architecture/ADR-045-shared-ai-provider.md` |
| Tipo | Architecture Decision Record (`HB-001` §11–12) |
| Versión | 2 — **lista para ratificación** (incorpora la decisión 8 del propietario, 2026-10-18) |
| Estado | **`PROPUESTA — PENDIENTE DE RATIFICACIÓN`**. Pasa a `Aceptada` solo con el procedimiento de [`MODERATION_APPROVAL_MATRIX.md`](MODERATION_APPROVAL_MATRIX.md) §1. Hasta entonces **no se crea tabla, módulo ni cambio de código** |
| Fecha | 2026-10-18 (v1: 2026-10-17) |
| Autor | Claude Code, a pedido del propietario del proyecto |
| Amplía a | `ADR-041-tero-ai-assistant.md` (aceptado por el equipo según el propietario; **el archivo en `develop` todavía dice «borrador»**, debe actualizarse en su propio PR) |
| Relacionado | `ADR-044`, `ADR-032`, `ADR-038`, `ADR-027`, `ADR-028`, `ADR-031` |

> Convención: **[VERIFICADO]** · **[DECISIÓN]** del propietario, pendiente de ratificación ·
> **[PROPUESTA]** · **[PENDIENTE]**.

---

## 1. Contexto

### 1.1 Qué existe hoy [VERIFICADO, `develop` `db84edc`]

- Puerto `AiProvider` (`backend/app/domain/tero/provider.py`) con un solo método,
  `complete(system, messages, max_tokens, tools=None)`, que devuelve un `AiReply` o lanza
  `AiProviderError` sin texto del proveedor.
- Adaptador `AnthropicProvider` en `infrastructure/ai/`, el único archivo que importa el SDK.
- Fábrica `tero_provider(app)`: **un** proveedor, **una** clave (`ANTHROPIC_API_KEY`), **un** modelo
  (`TERO_MODEL`), guardado en `app.extensions["thers_tero"]`.
- Presupuesto: tabla `tero_usage`, una fila por mes, sin usuario ni propósito.
- `SYSTEM_PROMPT` fijo y herramientas propias de Tero. Límites por cuenta `TERO_CHAT` y `TERO_ACTION`.

### 1.2 Problema

El equipo ya paga la infraestructura de IA de Tero y quiere reutilizarla para clasificar textos de
moderación (decisión 8). Tal como está, reutilizarla **mezclaría consumos, claves y datos** de módulos
con requisitos de privacidad muy distintos: una conversación privada con Tero no puede acercarse a un
caso de moderación.

---

## 2. Decisión

1. **[DECISIÓN 8]** Se reutiliza el puerto `AiProvider` para clasificación de texto, **manteniendo
   separados** cuotas, prompts, credenciales y registros.
2. **El puerto `AiProvider` no cambia.** Ningún archivo de Tero se modifica en la primera entrega.
3. Cada propósito se declara en un registro propio, con su configuración. Ningún módulo usa la
   configuración de otro.
4. Cada propósito tiene su contador de gasto, su tope y su límite por cuenta.
5. **[DECISIÓN 2]** Ninguna IA impone sanciones. La salida de los propósitos de moderación son
   **señales** que lee el motor de políticas de `ADR-044`.
6. **[DECISIÓN 10]** El material sospechoso de abuso sexual infantil no se envía a ningún modelo de
   propósito general, de ningún propósito (§6).

### 2.1 Propósitos [PROPUESTA]

| Propósito | Quién lo invoca | Entrada | Salida | Herramientas | Historial |
|---|---|---|---|---|---|
| `tero_chat` | La persona usuaria (existe hoy) | Su mensaje e historial | Texto y tarjetas | Sí, con sus permisos | Lo envía el dispositivo |
| `moderation_text` | El worker de moderación | Un texto ya publicado o reportado, como **dato** | JSON con categorías y puntajes | **Ninguna** | **Ninguno** |
| `admin_summary` | Una persona moderadora, por pedido | Un caso que ya puede ver | Resumen para humanos | Ninguna | Ninguno |
| `support_suggestion` | Soporte | Una solicitud | Respuesta **sugerida** que una persona revisa | Ninguna | Ninguno |

Solo `moderation_text` entra en la primera implementación. `admin_summary` y `support_suggestion`
quedan para después.

### 2.2 Configuración por propósito [PROPUESTA]

```
AI_<PROPOSITO>_API_KEY
AI_<PROPOSITO>_MODEL
AI_<PROPOSITO>_MONTHLY_BUDGET_USD
AI_<PROPOSITO>_ENABLED        # apagado por defecto
```

Cada propósito define además: prompt de sistema (archivo propio, versionado), formato de salida, tiempo
máximo, tope diario por cuenta si lo invoca una persona, límite de peticiones (`ADR-027`) y retención de
su registro. `TERO_*` se conserva sin cambios; `tero_chat` se mapea a esas variables.

### 2.3 Contador de gasto [PROPUESTA]

Tabla nueva `ai_usage` con clave `(period, purpose)` y las mismas columnas que `tero_usage`.
**No se modifica `tero_usage`**: es del módulo de Tero.

### 2.4 Adaptador reutilizable de clasificación [PROPUESTA]

- Puerto `TextClassifier` en `domain/moderation/` con `classify(text) -> TextSignal` (categorías
  cerradas y puntajes en `[0, 1]`) o error tipado.
- Adaptador `AiProviderTextClassifier` en `infrastructure/ai/` que **recibe un `AiProvider` ya
  construido** por una fábrica de propósito (no `thers_tero`), arma el mensaje con el texto dentro de
  un bloque delimitado, llama a `complete` **sin herramientas**, valida la respuesta contra un esquema
  estricto y registra el consumo en `ai_usage`.
- Adaptador simulado `FakeTextClassifier` para pruebas: sin red ni credenciales.
- Salida fuera de esquema, `refused`, tiempo excedido, tope agotado o `AiProviderError` →
  `TextSignal.unclassified`. El motor de políticas lo trata como «revisión humana», **nunca** aprobado.

### 2.5 Facturación y claves [PENDIENTE]

- Debe ser una **cuenta de API de la organización**, no la suscripción personal de una persona. No
  está verificado.
- Recomendado, si la consola lo permite: una clave y un espacio de trabajo por propósito, cada uno con
  su propio límite de gasto en consola.
- Hasta confirmarlo, los propósitos de moderación **no se encienden**. Sin credencial real, solo
  corre el adaptador simulado.

---

## 3. Separación de datos [PROPUESTA]

| Regla | Cómo se cumple |
|---|---|
| Moderación no recibe conversaciones de Tero | El historial de Tero vive en el dispositivo y viaja solo en `tero_chat`. `moderation_text` recibe un texto concreto por identificador, leído por el worker |
| Tero no recibe datos de moderación | `tero_chat` mantiene su lista cerrada de herramientas, sin ninguna de moderación |
| Cada propósito, su prompt | Archivos distintos; sin prompt compartido |
| Los registros no llevan contenido | Se registra propósito, identificadores, duración, tokens, resultado y versión de modelo y prompt. **Nunca** el texto enviado ni la respuesta |
| Los textos de personas son datos no confiables | Van en un bloque delimitado con la instrucción de ignorar órdenes dentro; la salida se valida contra un esquema |

## 4. Seguridad de la clasificación [PROPUESTA]

Sin herramientas ni acciones; salida JSON con categorías cerradas; lo que no cumpla el esquema se trata
como «no clasificado»; la señal no aprueba por sí sola; un fallo deja el contenido en `pending` o
`held`.

## 5. Privacidad [PENDIENTE]

- Los textos de **otras personas** saldrían hacia un tercero para moderarlos. Hay que actualizar la
  política de privacidad (`docs/legal/`) y los términos antes de activar el propósito.
- Verificar en los términos del proveedor la **retención** y el **no entrenamiento** de las entradas de la
  API antes del primer texto real.
- Se envía el mínimo: el texto, sin nombre, correo ni identificadores de cuenta.

## 6. Lo que la IA general no hace

No decide sanciones; no reemplaza la detección especializada de abuso infantil (`ADR-044` §3); no recibe
imágenes ni textos sospechosos de serlo; no lee mensajes directos salvo el texto que una persona reporta.

## 7. Compatibilidad con Tero

Cero cambios a los archivos de Tero en la primera entrega; `ai_usage` y el registro de propósitos son
módulos nuevos al lado. Cualquier generalización posterior de `tero_usage` o de la fábrica se acuerda
con su autor y va en un PR aparte. Las pruebas de Tero (`backend/tests/tero/`) deben seguir en verde
**sin modificarlas**.

## 8. Costos

Estimación **sin verificar** contra la página oficial del proveedor: con los precios por defecto del
módulo de Tero (USD 0,10 de entrada y 0,50 de salida por millón de tokens), unos 300 tokens de entrada y
50 de salida cuestan ~USD 0,00006 por texto, ~USD 6 por cada cien mil textos. Con contador y tope
propios, no compite con el tope de Tero.

## 9. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Reutilizar `tero_usage` y la misma clave | Mezcla consumos y revocaciones; un pico de moderación apaga a Tero |
| Enviar imágenes a un modelo general para detectar abuso infantil | No es una herramienta fiable para ello |
| Dejar que la IA suspenda cuentas | Falsos positivos sin revisión; contra `ADR-032` |

## 10. Criterios de aceptación

Migración aditiva con `upgrade`/`downgrade` verificada en PostgreSQL real; pruebas con proveedor
simulado que demuestren que un propósito no gasta el contador de otro, que moderación nunca recibe
historial de Tero, que una salida fuera del esquema no aprueba contenido y que el registro no guarda
texto; pruebas de Tero en verde sin modificarlas; documentación en `API_CONTRACT.md` y
`DATABASE_ARCHITECTURE.md`. Detalle en `MODERATION_IMPLEMENTATION_SCOPE.md` §4–5.
