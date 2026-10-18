# TERO — Conexión de la app móvil con el servidor (fases 4 a 6 en pantalla)

**Fecha:** 2026-10-17 · **Rama:** `feature/tero-chat-backend` · **Estado:** implementada; verificada con
typecheck, pruebas y **en un teléfono real** (moto z3) contra la API de Anthropic. Pendiente repetirla
en el Samsung A16 5G.

Hasta ahora el chat de Tero de la app respondía con textos de ejemplo (fase 1). Esto lo conecta al
servidor descrito en `ADR-041` y en `API_CONTRACT.md` §4.37, sin cambiar la interfaz de
`TeroClient`: las pantallas no saben cuál de los dos clientes usan.

## Interruptores

| Variable | Dónde | Efecto |
|---|---|---|
| `EXPO_PUBLIC_TERO_ENABLED` | app | Muestra u oculta Tero (ya existía) |
| `EXPO_PUBLIC_TERO_LIVE` | app | `true`: el chat llama al servidor. Apagado: respuestas de ejemplo |
| `TERO_ENABLED`, `TERO_AI_ENABLED` | servidor | Módulo e IA |
| `TERO_TOOLS_ENABLED` | servidor | Tero puede consultar perfil, avisos, personas, publicaciones y lugares |
| `TERO_ACTIONS_ENABLED` | servidor | Tero puede **preparar** acciones (aparecen las tarjetas) |

Desde 2026-10-17 `EXPO_PUBLIC_TERO_ENABLED` y `EXPO_PUBLIC_TERO_LIVE` nacen **encendidos** (se apagan con `false`); los interruptores del servidor siguen apagados por defecto. Con el servidor apagado y `EXPO_PUBLIC_TERO_LIVE=true`, el chat muestra «Tero
no está disponible»: no se rompe nada.

## Cómo funcionan las tarjetas

1. La persona escribe «sigue a beto». El servidor responde con texto y `confirmation_cards`.
2. La app dibuja una tarjeta bajo la respuesta: **«Tero preparó esto · todavía no se ha hecho»**, el
   texto que redactó el servidor (`Seguir a @beto`) y los botones **Cancelar** / **Confirmar**.
3. Solo al pulsar **Confirmar** la app llama a `POST /api/tero/actions/<id>/confirm`. Ninguna
   respuesta del chat dispara esa llamada por sí sola (hay una prueba que lo comprueba).
4. Tras confirmar, la app vuelve a leer lo que cambió: el perfil (`update_profile`) o el feed
   (seguir / dejar de seguir).

### Estados de una tarjeta

| Estado | Cuándo | Botones |
|---|---|---|
| Pendiente | recién propuesta, vigente | activos |
| Confirmando / Cancelando | petición en camino | bloqueados |
| Hecho | el servidor ejecutó la acción | — |
| Cancelada | la persona la descartó | — |
| Venció | pasaron 10 minutos (se repinta sola al vencer) | bloqueados |
| No se pudo completar | p. ej. la cuenta la bloqueó entre la propuesta y la confirmación | — |
| No disponible | la acción ya no existe o las acciones se apagaron | — |

Un fallo de red o el límite de intentos (`429`) **no** cierran la tarjeta: queda pendiente con un aviso
para reintentar. Los demás errores son definitivos.

## Conversación

El servidor no guarda el historial (`ADR-041` §5.2). La app manda los últimos 10 turnos en cada
petición: solo mensajes entregados, sin respuestas de ejemplo ni mensajes fallidos, empezando por la
persona y recortando cada turno a 1.000 caracteres (el tope del servidor). La conversación vive solo
mientras la pantalla está abierta.

## Archivos

- `mobile/src/features/tero/lib/teroCards.ts` — lógica pura (historial, validación de lo recibido,
  estado de las tarjetas, mensajes de error). Probada en `mobile/tests/teroCards.test.mjs`.
- `mobile/src/features/tero/lib/teroClient.ts` — `liveTeroClient` junto al de ejemplo.
- `mobile/src/features/tero/components/TeroActionCard.tsx` — la tarjeta.
- `mobile/app/tero/chat.tsx` — usa todo lo anterior.

## Verificado en el teléfono (moto z3, 2026-10-17)

Con el servidor y Metro en la computadora, unidos al teléfono por `adb reverse`, una base temporal y
la clave real de Anthropic. Se comprobó, mirando la pantalla y la base de datos:

- **Seguir a alguien:** la tarjeta «Seguir a @beto» aparece con «todavía no se ha hecho»; antes de
  confirmar hay 0 follows y la acción está `pending`; al pulsar Confirmar pasa a «Hecho», hay 1 follow
  y la acción queda `confirmed`.
- **Cancelar:** una tarjeta de cambio de biografía, cancelada, deja la acción `cancelled` y la
  biografía sin cambios. Confirmada, la biografía cambia.
- **Estados del avatar:** «Te escucho…» al escribir, «pensando» con la burbuja de puntos al esperar.
- **Costo:** la sesión completa (unos 10 mensajes con herramientas) gastó unos USD 0,005.

### Errores que salieron al probar, y su arreglo

| Qué pasó | Causa | Arreglo |
|---|---|---|
| La app se caía al iniciar sesión | El APK instalado era viejo y no traía el módulo nativo `AsyncStorage` | Recompilar e instalar (ver abajo) |
| Tero «corregía» que seguías a alguien que ya habías confirmado | El historial decía «todavía no está hecha» y nunca supo del Confirmar | `historyForRequest` añade, a cada turno con tarjetas, una línea `[Tarjeta «…»: la persona la confirmó y YA SE HIZO]`; el prompt le dice que esas líneas son fiables |
| Se veían `**asteriscos**` | La app no interpreta Markdown | El prompt pide texto plano y `plainText()` limpia lo que aun así llegue |
| Confirmar y Cancelar quedaban tapados por el campo de texto | La lista no conocía la altura de la tarjeta al desplazarse | Segundo desplazamiento al final cuando cambia la lista o una tarjeta |
| El panel decía «Vista previa» con el chat real | Texto de la fase 1 | Solo se muestra si `EXPO_PUBLIC_TERO_LIVE` está apagado |

### Trampas de esta máquina (Windows)

- **Metro debe escuchar en IPv4.** Con `--host localhost` Node escucha solo en `::1` y el túnel de
  `adb reverse` entra por `127.0.0.1`: la app da «Connection reset». Usar `--host lan`.
- **Compilar con la unidad `M:` falla** en la tarea de generación de código de `react-native-svg`
  («this and base files have different roots»). Lo que funcionó: copiar `mobile/` a una ruta corta
  real (`C:\tm`), `npm ci` y `npx expo run:android --no-bundler`; la compilación tardó unos 6
  minutos. Metro sigue sirviendo el JavaScript desde la carpeta original, que es la que se edita.
  `C:\tm` es temporal y puede borrarse.
- **`expo run:android --device` espera el nombre del modelo**, no el número de serie; con un solo
  teléfono conectado basta omitirlo.
- Con `CI=1` Metro no recarga archivos cambiados: reiniciarlo para ver cambios.
- Un enlace `thers://tero/chat` lanzado mientras la app carga puede abrir el navegador; esperar a que
  cargue el inicio antes de usarlo.

## Lo que NO está hecho

- Repetir la verificación en el Samsung A16 5G.
- La versión web de Tero (`Frontend/`): no existe todavía.
- «Resumen» y «Novedades» siguen con datos de ejemplo: no hay endpoint.
- Respuestas en streaming: una respuesta con herramientas tardó entre 6 y 24 segundos en el teléfono
  (la primera llamada fue la más lenta) y la pantalla muestra «pensando» todo ese tiempo.
- Tero aún no sabe listar a quién sigues (`profile_read` solo da el número). Es una herramienta que
  se puede añadir si el producto lo pide.
