import { useIsFocused } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

import { useTero } from '../context/TeroContext';
import { useAppActive } from '../lib/useAppActive';
import { useReducedMotion } from '../lib/useReducedMotion';
import type { TeroMood } from '../types';
import {
  BREATH_SCALE,
  FACE_CROSSFADE_MS,
  floatCycles,
  floatHalfCycleMs,
  isDoubleBlink,
  lookFor,
  MOOD_MOTION,
  MOUTH_REST,
  mouthKeyframes,
  mouthLoops,
  nextBlinkDelayMs,
  reactionForMoodChange,
  SCAN_CYCLES,
} from './expressions';
import type { TeroReaction } from './expressions';

/**
 * ¿Puede Tero moverse ahora? Es el ÚNICO lugar que lo decide. No se mueve si:
 * - la persona apagó «Animaciones» en Ajustes de Tero;
 * - Android pide reducir el movimiento (accesibilidad);
 * - la app está en segundo plano;
 * - la pantalla que lo contiene no está visible (otra pantalla encima).
 */
export function useTeroMotionAllowed(override = true): boolean {
  const { preferences } = useTero();
  const reducedMotion = useReducedMotion();
  const appActive = useAppActive();
  const focused = useIsFocused();
  return override && preferences.animations && !reducedMotion && appActive && focused;
}

/** Una reacción pedida desde fuera. `key` distinto = reaccionar otra vez. */
export type ReactionRequest = { kind: TeroReaction; key: number };

/** Las dos capas de ojos: qué estado dibuja cada una, cuál se ve y hacia cuál se va. */
type Faces = { a: TeroMood; b: TeroMood; front: 'a' | 'b'; target: TeroMood };

type Options = {
  size: number;
  mood: TeroMood;
  allowed: boolean;
  pressed: boolean;
  reaction?: ReactionRequest | null;
};

/**
 * Controlador de animaciones de Tero. Todo corre con el driver nativo
 * (`transform` y `opacity`): el hilo de JavaScript solo arranca y detiene. Por eso la boca no
 * cambia su trazo: es una capa que se abre y cierra con escala, y las caras se mezclan con
 * fundidos entre dos capas de ojos.
 *
 * Nada es infinito: la flotación y la respiración duran una ventana tras cada motivo, el barrido de
 * la mirada y el habla tienen un tope, y el parpadeo es un temporizador que se cancela en cuanto
 * Tero no puede moverse.
 */
export function useTeroMotion({ size, mood, allowed, pressed, reaction }: Options) {
  const motion = MOOD_MOTION[mood];

  const float = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(motion.tilt)).current;
  // Giro extra de las reacciones (celebrar, encogerse); se suma a la inclinación del estado.
  const wiggle = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const reactScale = useRef(new Animated.Value(1)).current;
  const blink = useRef(new Animated.Value(1)).current;
  // Opacidad de las dos capas de ojos. Siempre están montadas: una se ve y la otra espera en 0.
  // Al cambiar de estado la que espera recibe la cara nueva (sin verse) y las dos se cruzan.
  const faceA = useRef(new Animated.Value(1)).current;
  const faceB = useRef(new Animated.Value(0)).current;
  const lookX = useRef(new Animated.Value(0)).current;
  const lookY = useRef(new Animated.Value(0)).current;
  const mouth = useRef(new Animated.Value(MOUTH_REST)).current;
  // Entrada: solo si al montar ya se puede animar; si no, aparece directamente.
  const enter = useRef(new Animated.Value(allowed ? 0 : 1)).current;

  // Qué cara lleva cada capa, cuál está al frente y a qué estado se va. Se actualiza EN el render
  // (estado derivado): así la capa de atrás ya trae la cara nueva en el mismo cuadro en que cambia
  // el estado, sin un instante en que no se vea ninguna.
  const [faces, setFaces] = useState<Faces>({ a: mood, b: mood, front: 'a', target: mood });
  if (mood !== faces.target) {
    const back = faces.front === 'a' ? 'b' : 'a';
    setFaces({ ...faces, [back]: mood, target: mood });
  }
  const facesRef = useRef(faces);
  facesRef.current = faces;

  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const previousMood = useRef<TeroMood | null>(null);

  function runReaction(kind: TeroReaction) {
    if (!allowedRef.current) return;
    const lift = -size * 0.07;
    const toRest = (value: Animated.Value, rest: number) =>
      Animated.spring(value, { toValue: rest, friction: 5, tension: 140, useNativeDriver: true });
    const to = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, { toValue, duration, easing: Easing.out(Easing.quad), useNativeDriver: true });
    const settle = (value: Animated.Value, rest: number, duration: number) =>
      Animated.timing(value, { toValue: rest, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true });

    const animation =
      kind === 'tap'
        ? Animated.sequence([to(reactScale, 0.9, 80), toRest(reactScale, 1)])
        : kind === 'surprise'
          ? Animated.parallel([
              Animated.sequence([to(reactScale, 1.12, 110), toRest(reactScale, 1)]),
              Animated.sequence([to(hop, lift * 0.7, 110), toRest(hop, 0)]),
            ])
          : kind === 'joy'
            ? Animated.parallel([
                Animated.sequence([to(hop, lift, 160), toRest(hop, 0)]),
                Animated.sequence([to(reactScale, 1.06, 160), toRest(reactScale, 1)]),
              ])
            : kind === 'celebrate'
              ? // Dos saltos y un meneo de lado a lado: algo que la persona esperaba salió bien.
                Animated.parallel([
                  Animated.sequence([
                    to(hop, lift * 1.3, 140),
                    toRest(hop, 0),
                    to(hop, lift * 0.8, 120),
                    toRest(hop, 0),
                  ]),
                  Animated.sequence([
                    to(wiggle, 9, 90),
                    to(wiggle, -9, 120),
                    to(wiggle, 5, 100),
                    toRest(wiggle, 0),
                  ]),
                  Animated.sequence([to(reactScale, 1.1, 140), toRest(reactScale, 1)]),
                ])
              : kind === 'droop'
                ? // Se encoge y se inclina despacio, sin sacudidas: un error no debe alarmar.
                  Animated.parallel([
                    Animated.sequence([settle(reactScale, 0.94, 260), settle(reactScale, 1, 700)]),
                    Animated.sequence([settle(wiggle, -6, 260), settle(wiggle, 0, 700)]),
                  ])
                : kind === 'message'
                  ? Animated.sequence([to(hop, lift * 0.4, 120), toRest(hop, 0)])
                  : Animated.spring(enter, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true });
    animation.start();
  }

  // Entrada suave al montar.
  useEffect(() => {
    if (allowedRef.current) runReaction('enter');
    else enter.setValue(1);
    // Solo al montar.
  }, []);

  // Si deja de poder animarse a mitad de la entrada, que quede visible igual.
  useEffect(() => {
    if (!allowed) enter.setValue(1);
  }, [allowed, enter]);

  // Cruce de caras. Corre en el layout (antes de pintar) para que la capa que llega empiece en 0 y
  // la que se va en 1 en el mismo cuadro: el cambio de expresión se ve como una mezcla, no como un
  // salto ni como un instante sin ojos.
  useLayoutEffect(() => {
    const current = facesRef.current;
    const frontMood = current.front === 'a' ? current.a : current.b;
    if (frontMood === current.target) return;

    const frontValue = current.front === 'a' ? faceA : faceB;
    const backValue = current.front === 'a' ? faceB : faceA;
    const nextFront = current.front === 'a' ? 'b' : 'a';
    const swap = () => setFaces((state) => ({ ...state, front: nextFront }));

    if (!allowed) {
      // Sin animación (reducir movimiento, segundo plano...): el cambio es inmediato.
      frontValue.setValue(0);
      backValue.setValue(1);
      swap();
      return;
    }
    frontValue.setValue(1);
    backValue.setValue(0);
    const fade = Animated.parallel([
      Animated.timing(backValue, { toValue: 1, duration: FACE_CROSSFADE_MS, useNativeDriver: true }),
      Animated.timing(frontValue, { toValue: 0, duration: FACE_CROSSFADE_MS, useNativeDriver: true }),
    ]);
    fade.start(({ finished }) => {
      if (finished) swap();
    });
    return () => fade.stop();
  }, [faces.target, allowed, faceA, faceB]);

  // Cambio de estado: inclinación y reacción si toca.
  useEffect(() => {
    const previous = previousMood.current;
    previousMood.current = mood;
    const target = MOOD_MOTION[mood].tilt;

    if (!allowed) {
      tilt.setValue(target);
      return;
    }
    Animated.timing(tilt, { toValue: target, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
    const reactionKind = reactionForMoodChange(previous, mood);
    if (reactionKind) runReaction(reactionKind);
    // `runReaction` lee refs; no hace falta como dependencia.
  }, [mood, allowed, tilt]);

  // Reacción pedida desde fuera (toque, mensaje recibido, desenlace de una tarjeta...).
  useEffect(() => {
    if (reaction) runReaction(reaction.kind);
    // Solo cuando llega una petición nueva (`key` distinto).
  }, [reaction?.key]);

  // Pulsación: se hunde un poco mientras el dedo está encima.
  useEffect(() => {
    if (!allowed) {
      pressScale.setValue(1);
      return;
    }
    if (pressed) {
      Animated.timing(pressScale, { toValue: 0.92, duration: 90, useNativeDriver: true }).start();
    } else {
      Animated.spring(pressScale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
  }, [pressed, allowed, pressScale]);

  // Flotación y respiración por ventanas: unos ciclos tras cada motivo (aparecer, cambio de
  // estado, toque o reacción, que por eso son dependencias) y luego quieto. Es el mismo valor, así
  // que respirar no añade ninguna animación más.
  const cycles = floatCycles(motion.float);
  const halfCycle = floatHalfCycleMs(motion.float);
  useEffect(() => {
    if (!allowed || cycles === 0) {
      float.stopAnimation();
      Animated.timing(float, { toValue: 0, duration: allowed ? 200 : 0, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: halfCycle, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: halfCycle, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
      { iterations: cycles },
    );
    loop.start();
    return () => loop.stop();
  }, [allowed, cycles, halfCycle, float, mood, pressed, reaction?.key]);

  // Mirada: al escuchar baja hacia el campo de texto; al pensar barre despacio de lado a lado y
  // se detiene tras unas pasadas.
  useEffect(() => {
    const look = lookFor(mood);
    if (!allowed) {
      lookX.setValue(0);
      lookY.setValue(0);
      return;
    }
    Animated.timing(lookY, {
      toValue: look.y * size,
      duration: 220,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();

    if (look.scan === 0) {
      Animated.timing(lookX, { toValue: 0, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
      return;
    }
    const reach = look.scan * size;
    const sweep = (toValue: number) =>
      Animated.timing(lookX, { toValue, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([sweep(reach), sweep(-reach)]), { iterations: SCAN_CYCLES });
    loop.start();
    return () => {
      loop.stop();
      Animated.timing(lookX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    };
  }, [mood, allowed, size, lookX, lookY]);

  // Habla: la boca se abre y se cierra al ritmo de las sílabas, con un tope de tiempo.
  useEffect(() => {
    if (!allowed || mood !== 'speaking') {
      mouth.stopAnimation();
      mouth.setValue(MOUTH_REST);
      return;
    }
    const steps = mouthKeyframes();
    const loop = Animated.loop(
      Animated.sequence(
        steps.map((step) =>
          Animated.timing(mouth, {
            toValue: step.to,
            duration: step.ms,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ),
      ),
      { iterations: mouthLoops(steps) },
    );
    loop.start();
    return () => {
      loop.stop();
      mouth.setValue(MOUTH_REST);
    };
  }, [mood, allowed, mouth]);

  // Parpadeo ocasional: un temporizador, no una animación continua.
  useEffect(() => {
    if (!allowed || !motion.blinks) {
      blink.setValue(1);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const close = () => Animated.timing(blink, { toValue: 0.1, duration: 70, useNativeDriver: true });
    const open = () => Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: true });
    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        const steps = isDoubleBlink() ? [close(), open(), close(), open()] : [close(), open()];
        Animated.sequence(steps).start(() => {
          if (!cancelled) schedule();
        });
      }, nextBlinkDelayMs());
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      blink.stopAnimation();
      blink.setValue(1);
    };
  }, [allowed, motion.blinks, blink]);

  // Al desmontar no queda nada corriendo.
  useEffect(
    () => () => {
      for (const value of [float, hop, tilt, wiggle, pressScale, reactScale, blink, faceA, faceB, lookX, lookY, mouth, enter]) {
        value.stopAnimation();
      }
    },
    [float, hop, tilt, wiggle, pressScale, reactScale, blink, faceA, faceB, lookX, lookY, mouth, enter],
  );

  return useMemo(() => {
    const eyeLine = size * 0.05; // los ojos están 5 % por debajo del centro
    const mouthLine = size * 0.18; // la boca está 18 % por debajo del centro
    return {
      /** Las dos capas de ojos: qué estado dibuja cada una y su opacidad (una se ve, la otra espera). */
      eyeLayers: [
        { key: 'a', mood: faces.a, style: { opacity: faceA } },
        { key: 'b', mood: faces.b, style: { opacity: faceB } },
      ] as const,
      bodyStyle: {
        opacity: enter,
        transform: [
          { translateY: Animated.add(float.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.05] }), hop) },
          {
            rotate: Animated.add(tilt, wiggle).interpolate({
              inputRange: [-45, 45],
              outputRange: ['-45deg', '45deg'],
              extrapolate: 'clamp',
            }),
          },
          {
            scale: Animated.multiply(
              Animated.multiply(
                Animated.multiply(pressScale, reactScale),
                float.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + BREATH_SCALE] }),
              ),
              enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
            ),
          },
        ],
      },
      // Parpadeo: escala vertical alrededor de la línea de los ojos, no del centro; la mirada
      // desplaza las dos capas de ojos juntas.
      eyesStyle: {
        transform: [
          { translateX: lookX },
          { translateY: lookY },
          { translateY: eyeLine },
          { scaleY: blink },
          { translateY: -eyeLine },
        ],
      },
      // Boca al hablar: escala vertical alrededor de su propia línea.
      mouthStyle: {
        transform: [{ translateY: mouthLine }, { scaleY: mouth }, { translateY: -mouthLine }],
      },
    };
  }, [size, faces.a, faces.b, faceA, faceB, enter, float, hop, tilt, wiggle, pressScale, reactScale, lookX, lookY, blink, mouth]);
}
