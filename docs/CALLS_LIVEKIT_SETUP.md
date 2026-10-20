# Llamadas y videollamadas 1 a 1 con LiveKit Cloud

Documento operativo, **no oficial**. La decisión (LiveKit Cloud, llamadas 1 a 1 desde el chat, audio y video, timbre solo con la app abierta) la tomó el equipo el 2026-10-20 **sin redactar un ADR**. Lo ideal es documentarla después como ADR (`HB-001` §11–12).

Contrato HTTP: `docs/architecture/API_CONTRACT.md` §4.48.

## Cómo funciona

- La API (Flask) **no toca audio ni video**. Solo guarda quién llama a quién y en qué estado está la llamada (tabla `calls`) y firma un token de LiveKit para una sala.
- El audio y el video van directo entre el navegador/teléfono y LiveKit Cloud.
- No hay tiempo real en el servidor: web y app consultan `GET /api/calls/incoming` cada 4 s y el estado de la llamada cada 2 s mientras suena. Por eso el timbre **solo funciona con la web o la app abiertas**.
- Reglas: las mismas que un mensaje directo (bloqueos y «quién puede escribirme»). Una persona solo puede estar en una llamada a la vez. Una llamada que nadie contesta en 30 s pasa a «perdida».

## 1. Crear el proyecto en LiveKit Cloud

1. Crear cuenta en <https://cloud.livekit.io> y un proyecto nuevo (por ejemplo `thers-staging`).
2. En *Settings → Keys* crear una clave. Anota la **URL** (`wss://<proyecto>.livekit.cloud`), el **API Key** y el **API Secret**.
3. El plan gratuito tiene un tope mensual de minutos: **comprobar los límites y precios vigentes en LiveKit** antes de abrir las llamadas a más gente.

El **API Secret es un secreto del servidor**. Nunca va al Frontend, a la app ni al repositorio.

## 2. Servidor (Render)

Variables de entorno de la API:

| Variable | Valor |
|---|---|
| `CALLS_ENABLED` | `1` |
| `LIVEKIT_URL` | `wss://<proyecto>.livekit.cloud` |
| `LIVEKIT_API_KEY` | el API Key |
| `LIVEKIT_API_SECRET` | el API Secret |
| `CALL_RING_SECONDS` | opcional, 30 por defecto |

La migración `e5a8c2d4f6b1` (tabla `calls`) se aplica sola con el *Pre-Deploy* `flask db upgrade`. Sin `CALLS_ENABLED` y las tres variables de LiveKit, `POST /api/calls` responde `503 calls_disabled` y la web/app muestran «Las llamadas no están disponibles ahora».

## 3. Web (Cloudflare Pages)

- No hace falta ninguna variable: `VITE_CALLS_ENABLED` está encendida salvo que valga `false`.
- `Frontend/public/_headers` ya permite micrófono y cámara (`Permissions-Policy: camera=(self), microphone=(self)`). Sin eso el navegador los bloquea.
- La CSP sigue en modo **solo informe**. Cuando se active (`Content-Security-Policy`), hay que añadir a `connect-src` `wss://*.livekit.cloud https://*.livekit.cloud`, y a `media-src` `blob:`. Si no, la sala no conecta.
- La web debe servirse por **HTTPS**: los navegadores no dan acceso al micrófono ni a la cámara en HTTP (salvo `localhost`).

## 4. App Android

- Es una **dependencia nativa nueva** (`@livekit/react-native`, `@livekit/react-native-webrtc`): hay que **recompilar la APK**; no basta con recargar el bundle.
- En Windows la build exige la ruta corta con `subst` (`docs/mobile/ANDROID_SETUP.md` §9). Tras cambiar dependencias, hay que reescribir `autolinking.json` de `C:` a `M:` (ver notas del equipo).
- `app.json` ya declara los permisos `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` y los plugins de LiveKit. Android pide el micrófono (y la cámara en videollamada) la primera vez que se contesta o se llama.
- `EXPO_PUBLIC_CALLS_ENABLED` está encendida salvo que valga `false`.

## 5. Prueba de humo (dos cuentas, dos dispositivos)

- [ ] Con las variables vacías, llamar muestra «Las llamadas no están disponibles ahora» y nada se rompe.
- [ ] Cuenta A abre el chat con B y pulsa el teléfono. A ve «Llamando...»; B ve «Llamada entrante» en menos de ~4 s.
- [ ] B contesta: ambos se oyen, el contador de tiempo avanza.
- [ ] Silenciar micrófono funciona; en videollamada, apagar/encender cámara también.
- [ ] A cuelga: B ve «La llamada terminó» y vuelve a la pantalla anterior.
- [ ] B rechaza: A ve «Rechazó la llamada».
- [ ] Nadie contesta 30 s: A ve «No contestó»; B ve «Llamada perdida» si estaba mirando.
- [ ] A llama a B mientras B ya está en otra llamada: «Ya hay una llamada en curso».
- [ ] B bloquea a A: A no puede llamarle.
- [ ] Denegar el permiso de micrófono/cámara muestra un aviso claro, no una pantalla en blanco.

## Qué NO hace todavía

- **No suena con la app o el navegador cerrados.** Haría falta una notificación push de llamada y, en Android, una pantalla de llamada entrante a pantalla completa (servicio en primer plano).
- Sin llamadas de grupo, sin grabación, sin compartir pantalla, sin historial de llamadas ni mensaje de «llamada perdida» en el chat.
- Sin TURN propio: LiveKit Cloud ya incluye uno, pero no se ha probado detrás de redes corporativas muy restrictivas.
- Las pruebas de integración del backend (`backend/tests/test_calls.py`) y la integración real con LiveKit **no se han ejecutado** al escribir esto: ver el reporte del cambio.
