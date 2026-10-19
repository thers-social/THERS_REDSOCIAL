# ADR-053 — Tero con Places y Personas, y notificaciones push

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por el
  propietario: las secciones «Places» y «Personas» de Tero, y notificaciones en el teléfono como Instagram.
- **Relacionado:** `ADR-041` (Tero), `ADR-040` (THERS Places), `ADR-043` (importación OSM), `ADR-051` (horario por defecto),
  `ADR-008` (notificaciones), `ADR-048` (grupos), `ADR-031` (borrado de cuenta).

## 1. Decisión

### 1.1 Tero con Places y Personas

| Tema | Decisión |
|---|---|
| **Personas** | Pantalla «Personas» (app): las cuentas de `GET /api/users/suggestions`, con seguir. Herramienta de lectura `people_suggestions` para el chat (mismas reglas: sin bloqueadas ni ya seguidas). |
| **Places** | Pantalla «Places» (app): chips de categoría y los mejor valorados (`GET /api/places/top`), atajos al chat. Herramientas de lectura `places_recommend` y `place_read`. |
| **Reservar desde el chat** | Herramienta de **propuesta** `propose_reserve_place` (lugar, fecha-hora con zona, personas). Valida lo mismo que la reserva normal (cuarto de hora, ≥ 30 min, horario y cierres) y crea una tarjeta de confirmación; solo al confirmarla se crea una **solicitud** de reserva que el lugar acepta o rechaza. Tero nunca reserva por su cuenta (patrón de `ADR-041` §6.2). |
| **Sin ubicación** | Tero no recibe la ubicación de la persona; para «cerca de mí» pregunta la zona o remite al mapa. |

### 1.2 Notificaciones push

| Tema | Decisión |
|---|---|
| **Canal** | Firebase Cloud Messaging (HTTP v1) directo desde el backend, con el token nativo del teléfono (`getDevicePushTokenAsync`). Sin cuenta de Expo. |
| **Cuándo avisa** | Seguir, solicitud de seguir, solicitud aceptada, me gusta, comentario, mención, mensaje directo y mensaje de grupo. Cada aviso lleva `data.type` y el identificador para abrir la pantalla correcta al tocarlo. |
| **Texto** | Corto: «@ana empezó a seguirte»; un mensaje muestra el nombre de quien escribe y una vista previa (≤ 90 caracteres) o «📷 Foto», «🎤 Nota de voz»… Ver §3. |
| **Dispositivos** | Tabla `push_devices` (token único; pasa a la última cuenta que inicia sesión en ese teléfono; máx. 10 por persona). `POST`/`DELETE /api/push/devices`. Cerrar sesión quita el teléfono antes de revocar la sesión. Un token que Firebase rechaza se borra. |
| **Seguridad** | La cuenta de servicio de Firebase es un secreto del servidor (`FCM_SERVICE_ACCOUNT_FILE` / `FCM_SERVICE_ACCOUNT_JSON`, fuera de git). `google-services.json` del móvil también está ignorado y se inyecta con `app.config.js` si existe. |
| **Interruptor** | `PUSH_ENABLED` (apagado por defecto). Sin él, o sin credenciales, no se envía nada y la API arranca igual; un fallo de Firebase nunca rompe la acción que lo originó. El envío de red va en un hilo aparte. |

## 2. Qué NO hace

- No avisa de reservas, cotizaciones, planes ni respuestas a reseñas de Places (sus avisos se crean por SQL directo).
- No hay interruptor por tipo de aviso dentro de la app: se apagan en los ajustes de Android o cerrando sesión.
- No agrupa ni colapsa avisos, no cuenta insignias y no distingue idioma (siempre español).
- iOS: la tabla admite `ios`, pero no hay cliente ni credenciales APNs.

## 3. Riesgos

- **Privacidad:** la vista previa del mensaje se ve en la pantalla de bloqueo. Es lo que hace Instagram, pero conviene
  ofrecer «ocultar vista previa» antes del lanzamiento público.
- **Abuso:** un envío masivo de mensajes o me gusta genera muchos avisos; dependen de los límites de uso existentes
  (`ADR-027`). No hay límite propio de push.
- **Secretos:** la clave de Firebase se compartió una vez por chat durante la puesta en marcha; debe rotarse.
- **Compilación:** `expo-notifications` es un módulo nativo; hay que recompilar la app una vez (en Windows exige una ruta
  de proyecto corta, ver `docs/mobile/ANDROID_SETUP.md` §9).

## 4. Verificación

Backend: `tests/test_push.py` (registro y validación, token que cambia de cuenta, avisos de seguir/me gusta/comentario,
mensaje directo y de grupo, reintento idempotente, token muerto, falla transitoria, sin emisor) y las pruebas de Tero
(`tests/tero/`: herramientas nuevas y reservar con tarjeta) y de `places/top`. App: `tests/push.test.mjs`.
