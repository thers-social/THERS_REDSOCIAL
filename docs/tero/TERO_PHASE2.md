# TERO — Fase 2: animaciones e interactividad

**Fecha:** 2026-10-08 · **Rama:** `feature/tero-phase2-animations` (sin commit) ·
**Estado:** implementada; verificada con typecheck, tests y bundle. **Pruebas físicas pendientes.**

## 1. Diferencia de alcance con el plan original

`TERO_IMPLEMENTATION_PLAN.md` y el prompt 2 de `TERO_CLAUDE_PROMPTS.md` definían la Fase 2 como
**integración de Rive** (`assets/tero.riv`, `TeroStateMachine`). El encargo de la Fase 2 pidió
animaciones e interactividad con "la tecnología más estable y sostenible", Rive solo si está
validado. **No existe ningún `.riv`**, así que la fase se hizo con `Animated` + SVG y Rive queda como
propuesta (§5).

## 2. Motor elegido: `Animated` del núcleo + `react-native-svg`

| Opción | Estado en el repo | Decisión |
|---|---|---|
| `Animated` (RN core) | En uso desde la Fase 1 | **Elegido.** Driver nativo para `transform`/`opacity`, sin dependencias nuevas ni recompilación. |
| Reanimated 4.7.1 | Solo transitivo (vía `expo-router`), no declarado; `worklets 0.13.0` con peer inválido frente a `expo-modules-core` | No usado. Declararlo exige validar esa incompatibilidad. |
| `rive-react-native` 9.8.5 | No instalado | Estable pero nativo: recompilar dev-client. Sin `.riv`. |
| `@rive-app/react-native` 0.5.4 | No instalado | Pre-1.0 y exige `react-native-nitro-modules` (otra dependencia nativa). |

**Sin dependencias nuevas en esta fase.** No hace falta recompilar el dev-client de la Fase 1.

## 3. Arquitectura

```
src/features/tero/
├─ animation/
│  ├─ expressions.ts     # PURO: movimiento por estado, ritmo de parpadeo, reglas de personalidad
│  └─ useTeroMotion.ts   # controlador central + useTeroMotionAllowed (único que decide si animar)
├─ components/
│  ├─ TeroAvatar.tsx     # cuerpo SVG + capa de ojos (parpadeo nativo) + puntos de "pensando"
│  ├─ TeroDots.tsx       # indicador de 3 puntos (avatar y burbuja de escritura del chat)
│  ├─ TeroFloating.tsx   # pulsación, reacción al toque, sueño por inactividad
│  └─ TeroQuickPanel.tsx # apertura/cierre animados
└─ lib/useAppActive.ts   # primer/segundo plano
```

`TeroAvatar` conserva su API de la Fase 1 (`size`, `mood`, `animated`) y suma `pressed` y `reaction`.

## 4. Animaciones y ciclo de vida

| Animación | Dónde | Detalle |
|---|---|---|
| Entrada | todo avatar | escala 0,6→1 + opacidad, resorte |
| Flotación | reposo/curioso/hablando/feliz (lenta en pensando) | **por ventanas**: ~8 s tras cada motivo, luego quieto |
| Parpadeo | estados con ojos redondos | temporizador 3,2–7 s, cierre 70 ms / apertura 110 ms, 20 % doble |
| Transición de expresión | cambio de estado | fundido de los ojos 180 ms + inclinación 260 ms |
| Reacciones | toque, sorpresa, alegría, mensaje | < 0,5 s, resorte |
| Pulsación | burbuja | se hunde a 0,92 mientras el dedo está encima |
| Cambio de borde | burbuja | resorte existente (Fase 1) |
| Panel | panel rápido | telón con fundido, hoja sube con resorte; cierre 180 ms; instantáneo al navegar |
| Pensando | avatar y chat | 3 puntos escalonados, solo mientras espera |
| Mensajes | chat | entrada de 220 ms solo para mensajes recién creados |

**Se detiene todo** (`useTeroMotionAllowed`) cuando: «Animaciones» está apagado, Android pide reducir
movimiento, la app pasa a segundo plano o la pantalla deja de estar enfocada (`useIsFocused`). Cada
efecto cancela sus animaciones y temporizadores al desmontar. Todo usa `useNativeDriver: true`,
salvo el arrastre y el resorte de posición de la burbuja (Fase 1, `PanResponder`).

**Rendimiento:** no se midió en el dispositivo (FPS, CPU, batería). El diseño evita animaciones
infinitas: en reposo, la burbuja solo ejecuta un parpadeo cada 3–7 s y, tras 90 s, nada.

## 5. Propuesta de Rive (no implementada, requiere decisión)

1. Recurso: un diseñador entrega `tero.riv` con artboard `Tero`, state machine `TeroStateMachine` y un
   input numérico o de texto `mood` con los ocho valores de `TeroMood`, más triggers `tap`,
   `surprise`, `joy`, `message` (mismos nombres que `TeroReaction`).
2. Runtime: elegir entre `rive-react-native` (estable) y `@rive-app/react-native` (Nitro) tras probar
   en el moto z3 y el Samsung A16; registrar la elección en un ADR.
3. Integración: solo dentro de `TeroAvatar`, con el SVG actual como respaldo si falta el `.riv`.
4. Coste: dependencia nativa → recompilar el dev-client (`ANDROID_SETUP.md` §9 y el problema de
   rutas `M:`/`C:` del cache de autolinking documentado en la sesión de la Fase 1).

## 6. Pendiente

- Mediciones reales de rendimiento en el dispositivo.
- Rive (§5). Gestos extra (pulsación prolongada, doble toque): descartados por riesgo de activación
  accidental y conflicto con el arrastre.
- IA real, n8n, endpoints, historial: Fases 3+ (requieren ADR-041).
