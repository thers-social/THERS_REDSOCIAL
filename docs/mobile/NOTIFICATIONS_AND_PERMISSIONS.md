# Notificaciones y permisos de la app Android

> Documento operativo, **no oficial**. Describe lo implementado el 2026-10-17 en
> `feature/mobile-notifications-permissions`. **No está probado en un teléfono todavía.**

## Qué hay

| Pieza | Dónde | Qué hace |
|---|---|---|
| Avisos locales | `src/features/notifications/useLocalAlerts.ts` | Con la app abierta, consulta `GET /api/notifications` cada 60 s y muestra una notificación del sistema por cada aviso nuevo sin leer (máximo 3; el resto se resume en una). |
| Selección de avisos | `src/features/notifications/alertLogic.ts` | Lógica pura. La **primera** consulta de una sesión no avisa de nada (para no disparar una ráfaga al abrir). |
| Preferencias | `src/features/notifications/alertPrefs.ts` | Interruptor del dispositivo y marca de «ya se explicó el permiso». AsyncStorage, no SecureStore: no son secretos. |
| Permisos | `src/features/permissions/` | Lectura y petición de **notificaciones** y **ubicación**; estado y textos puros en `permissionState.ts`. |
| Pantalla | `app/settings/notifications.tsx` (Ajustes → «Notificaciones y permisos») | Interruptor de avisos, estado de cada permiso, botón «Permitir» o «Abrir Ajustes». Relee el estado al volver de Ajustes del sistema. |

## Qué NO hay (a propósito)

- **Notificaciones push.** No hay Firebase, ni token de dispositivo, ni envío desde el servidor.
  Con la app cerrada o muy en segundo plano **no llega ningún aviso**. Los avisos de hoy son
  locales y solo funcionan mientras se usa la app. La pantalla de Ajustes lo dice.
- **Permiso de fotos.** No hace falta: `expo-image-picker` usa el selector de imágenes del sistema
  de Android, que entrega solo la imagen elegida.
- **Permiso de segundo plano** de ubicación: la navegación solo lee la posición con la app abierta.

## Permisos que declara la app

`POST_NOTIFICATIONS` (la añade el plugin de `expo-notifications`), ubicación aproximada y precisa
en primer plano (`expo-location`). El diálogo de notificaciones se explica **una sola vez** y solo si
Android todavía deja preguntar.

## Para convertirlo en push real (fase aparte)

1. Un proyecto de Firebase y `google-services.json` en la app; la cuenta de servicio solo en Render,
   nunca en el repositorio (`HB-001` §20).
2. Una tabla de tokens de dispositivo y endpoints para registrarlos y borrarlos (con ADR).
3. Envío desde el backend al crear una notificación, con preferencias por tipo y baja al cerrar sesión.
4. Entra en la exportación de datos y en la eliminación de cuenta (`ADR-028`/`ADR-031`).

## Verificación pendiente en un teléfono

Que el diálogo aparezca una vez; que el banner salga con la app abierta; que «Abrir Ajustes» lleve
a los ajustes de THERS y que al volver el estado se actualice; que un aviso tocado abra la pestaña
de avisos. **Requiere recompilar la app** (dependencia nativa nueva: `expo-notifications`).
