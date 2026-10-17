# TERO — Conexión de la app móvil con el servidor (fases 4 a 6 en pantalla)

**Fecha:** 2026-10-17 · **Rama:** `feature/tero-chat-backend` · **Estado:** implementada; verificada con
typecheck y pruebas. **Pendiente: ver las tarjetas en un teléfono real.**

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

Todos nacen apagados. Con el servidor apagado y `EXPO_PUBLIC_TERO_LIVE=true`, el chat muestra «Tero
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

## Lo que NO está hecho

- Verificación visual en el teléfono (el moto z3 y el Samsung A16 5G).
- La versión web de Tero (`Frontend/`): no existe todavía.
- «Resumen» y «Novedades» siguen con datos de ejemplo: no hay endpoint.
- Respuestas en streaming: una respuesta con herramientas puede tardar hasta unos 15 segundos y la
  pantalla muestra «pensando» todo ese tiempo.
