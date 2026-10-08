# TERO — Prompts para Claude Code

## PROMPT 0 — Auditoría de integración

```text
Estás trabajando en el repositorio de THERS. Antes de modificar código, realiza una auditoría enfocada exclusivamente en integrar la nueva mascota/asistente Tero.

Contexto que debes respetar:
- THERS ya tiene un feed/UI existente. NO lo rediseñes ni lo reemplaces.
- El móvil usa React Native + Expo + TypeScript + Expo Router.
- La convención del móvil es src/features/ + src/shared/ y existen alias @, @features, @shared y @assets.
- Ya existe src/shared/lib/api.ts; debes reutilizarlo y respetar su contrato de errores/timeout.
- El backend usa Flask con arquitectura hexagonal: domain, application, interfaces, config, extensions.
- Autenticación JWT existente: no romper register/login.
- PostgreSQL + SQLAlchemy + Alembic.

Haz lo siguiente SIN implementar aún:
1. Lee CLAUDE.md, documentación arquitectónica, ADRs y package files.
2. Mapea la estructura real de mobile y backend.
3. Identifica el layout raíz exacto donde debe montarse TeroFloating sin duplicación.
4. Identifica navegación, safe area, theme/styles, state management y storage local existentes.
5. Localiza servicios/endpoints reutilizables: perfil, notificaciones, users, posts, places, reports.
6. Revisa registro de blueprints, JWT y error handling de Flask.
7. Ejecuta baseline de tests/typecheck/lint.
8. Propón la estructura mínima de features/tero sin mover módulos existentes.
9. Señala incompatibilidades o ADRs necesarios.

Entrega SOLO un informe: hallazgos, archivos propuestos, puntos de integración, riesgos, comandos de verificación y plan. No cambies código todavía.
```

## PROMPT 1 — UI de Tero

```text
Implementa la Fase 1 de Tero basándote en la auditoría previa.

Restricciones:
- NO rehagas feed, navbar, autenticación ni theme global.
- Integra sobre UI existente.
- Mantén features/tero aislado.
- Reutiliza shared y src/shared/lib/api.ts cuando corresponda.
- NO conectes IA, OpenAI ni n8n todavía.
- Usa mocks tipados.

Implementa:
1. TeroFloating en esquina inferior derecha, sin tapar bottom navigation.
2. Drag dentro de límites seguros y snap opcional.
3. Tap -> TeroQuickPanel.
4. Panel: Preguntar, Resumen, Novedades, Más.
5. TeroHomeScreen: saludo, input, Resumen/Novedades/Places/Personas.
6. TeroChatScreen con mocks.
7. TeroSummaryScreen con métricas mock.
8. TeroContextActions: Resumir publicación, Ver autor, Guardar, Reportar.
9. TeroSettingsScreen: Mostrar Tero, Posición, Animaciones, Sonidos, Idioma, Privacidad.
10. EXPO_PUBLIC_TERO_ENABLED.

Diseño: colores originales cyan/aqua/azul/lavanda, rostro oscuro. Debe parecer THERS, no una app separada. Si no existe tero.riv usa fallback.

Calidad: TS estricto, accesibilidad, safe areas, teclado, sin dependencias grandes innecesarias.

Al terminar lista archivos, explica dónde montaste TeroFloating, ejecuta verificaciones y describe cómo probar los siete wireframes.
```

## PROMPT 2 — Rive

```text
Integra la mascota animada Tero usando Rive dentro de features/tero.

Antes de instalar:
1. Verifica Expo SDK y React Native reales.
2. Usa la documentación de la versión actual del runtime React Native de Rive; no copies APIs antiguas.
3. Documenta paquete y versión elegidos.

Requisitos:
- Crea TeroAvatar y un adaptador/controlador de animación.
- El resto de la app no debe importar Rive directamente.
- Archivo esperado assets/tero.riv; fallback si no existe.
- State Machine: TeroStateMachine.
- Estados lógicos: idle, attention, listening, thinking, speaking, happy, error, sleeping.
- Mapea los estados a inputs/triggers reales cuando el .riv esté disponible.
- Respeta reduced motion.
- Reduce/pausa animación cuando no esté visible si el runtime lo permite.

No cambies pantallas de negocio. Al terminar ejecuta expo-doctor/typecheck y entrega el contrato exacto que el diseñador debe usar en Rive: artboard, state machine e inputs.
```

## PROMPT 3 — Backend Chat

```text
Implementa el backend mínimo de Tero siguiendo la arquitectura hexagonal existente.

NO conectes n8n todavía y NO permitas tools de escritura.
Objetivo: POST /api/tero/chat autenticado con JWT.

Adapta a las convenciones reales del repo:
- domain/tero sin dependencias Flask.
- application/tero con TeroChatService y puerto del proveedor IA.
- interfaces/api para route/schema.
- infrastructure/ai para cliente IA.

Requisitos:
1. JWT obligatorio.
2. Validar message y longitud máxima.
3. context mínimo: screen, entity_type, entity_id.
4. API key solo backend.
5. Puerto para desacoplar proveedor.
6. TERO_ENABLED, TERO_AI_ENABLED, TERO_MODEL.
7. Si IA está deshabilitada, respuesta controlada para staging.
8. Timeout y errores sin filtrar detalles internos.
9. Respetar global error handler.
10. Tests: 401, 400, disabled, éxito mock, timeout.

Nunca des acceso directo a base de datos al modelo y nunca SQL dinámico. Entrega contrato JSON, ejemplo Postman/curl, variables y resultados de tests.
```

## PROMPT 4 — Tools de lectura

```text
Extiende Tero con Tool Registry SOLO LECTURA.

Objetivo inicial:
- profile.read
- notifications.summary
- users.search
- post.read
- places.search solo si ese módulo real existe; no inventes endpoints.

Reglas:
1. Modelo nunca llama repositorios directamente.
2. Tools llaman application services existentes.
3. Cada tool: JSON schema estricto, permiso, riesgo, serializer mínimo.
4. Revalidar JWT/permisos.
5. entity_id del móvil no es confiable.
6. Minimizar datos enviados al modelo.
7. Registrar tool, resultado y latencia sin secretos.
8. Prompt injection no puede elevar permisos.

Integra el mecanismo vigente de function/tool calling del proveedor y añade unit tests + una prueba end-to-end con cliente IA mock.
```

## PROMPT 5 — Acciones con confirmación

```text
Añade acciones de escritura seguras a Tero.

Solo si ya existen servicios equivalentes:
- profile.update
- saved_post.create/remove
- follow.create/remove

No implementar password, email, 2FA o account.delete.

Patrón obligatorio:
1. IA propone acción.
2. Backend valida y crea pending_action con expiración.
3. Chat devuelve confirmation_card; NO ejecuta.
4. Usuario confirma explícitamente.
5. /api/tero/actions/{id}/confirm revalida JWT, dueño, expiración y estado.
6. Ejecuta servicio existente.
7. Idempotencia.
8. Auditoría.

Añade cancel endpoint y tests para confirmación ajena, doble confirmación, expiración, permiso denegado y éxito. Ningún prompt puede saltarse confirmación.
```

## PROMPT 6 — n8n

```text
Integra n8n como infraestructura de automatización de Tero, NO como backend principal del chat.

Casos iniciales:
1. Resumen semanal de actividad.
2. Avisar cuando cambie el estado de un reporte.

Requisitos:
- Flask sigue siendo fuente de autorización y negocio.
- n8n recibe datos mínimos.
- Secreto/firma backend-to-backend; nunca al móvil.
- Idempotency key.
- Timeouts y reintentos.
- Preferir API interna limitada antes que dar a n8n credenciales completas de PostgreSQL.
- Variables N8N_BASE_URL, N8N_WEBHOOK_SECRET, TERO_AUTOMATIONS_ENABLED.
- n8n_client.py detrás de interfaz.
- n8n no es fuente de verdad.

Si no puedes crear workflows desde este entorno, documenta nodo por nodo, payloads, autenticación, mocks y cómo probar en staging.
```
