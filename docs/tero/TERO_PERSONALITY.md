# TERO — Guía de personalidad visual e interacción

**Estado:** propuesta de la Fase 2 (2026-10-08), pendiente de revisión del equipo. Implementada en
`mobile/src/features/tero/animation/expressions.ts`, que es la fuente de verdad de los valores.

## Carácter

Tero es **amigable, curioso, expresivo, respetuoso, útil y no invasivo**. Es un acompañante: está
disponible, no reclama atención.

## Reglas de comportamiento

### Puede reaccionar por su cuenta solo para
- **Parpadear** de vez en cuando (cada 3,2–7 s; uno de cada cinco es doble).
- **Dormirse** tras 90 s sin que nadie lo toque (cara quieta, sin parpadeo ni flotación).
- **Volver a reposo** 2,6 s después de responder (no se queda "hablando").

### Reacciona solo como respuesta a algo que hizo la persona
- Aparecer en pantalla → entrada suave.
- Tocarlo → se hunde bajo el dedo y rebota; si dormía, se despierta **sorprendido**.
- Abrir el panel → pone cara **curiosa** (cabeza inclinada).
- Escribir en el chat de Tero → cara **atenta** (escuchando), solo mientras se escribe en ese campo.
- Enviar una pregunta → **pensando** (puntos sobre la cabeza y burbuja de escritura).
- Recibir la respuesta → pequeño salto de "mensaje"; si la respuesta es alegre, salto de **alegría**.

### Nunca
- Se mueve de sitio, abre paneles, suena ni muestra avisos por su cuenta.
- Observa la actividad de la persona fuera de lo que ella hace con Tero (no hay vigilancia continua:
  "escuchando" depende solo del campo de texto del chat de Tero).
- Insiste, se agita o usa urgencia para conseguir interacción (sin patrones manipulativos).
- Reacciona de forma brusca a un error: la cara de error es quieta y comprensible.
- Se anima si la persona lo pidió (`Animaciones` apagado) o si Android pide reducir el movimiento.

## Estados (contrato `TeroMood`, sin cambios desde la Fase 1)

| Estado | Nombre en la guía | Cara | Movimiento |
|---|---|---|---|
| `idle` | Reposo | ojos redondos, sonrisa | flota unos ciclos tras cada motivo, parpadea |
| `attention` | Curioso | ojos grandes | cabeza inclinada −8°, flota, parpadea |
| `listening` | Escuchando | ojos redondos, onda lavanda | quieto, inclinado +5°, parpadea |
| `thinking` | Pensando | mira hacia arriba, boca recta | flotación lenta, puntos animados |
| `speaking` | Respondiendo | boca abierta | flota, parpadea |
| `happy` | Feliz | ojos en arco, sonrisa amplia | salto de alegría al entrar |
| `error` | Error | ojos en X, boca triste | quieto |
| `sleeping` | Dormido | ojos cerrados | quieto |

**Sorprendido** no es un estado sino una **reacción** breve (`TeroReaction: 'surprise'`), para no
ampliar el contrato de ocho estados.

## Paleta

Sin cambios: cyan `#22d3ee`, aqua `#2dd4bf`, azul `#3b82f6`, lavanda `#c4b5fd`, rostro `#0b1220`
(`teroColors.ts`, provisional aprobada en la Fase 1). No se encontró una especificación posterior.
