import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';

import { useTero } from '../context/TeroContext';
import { useAppActive } from '../lib/useAppActive';
import { useReducedMotion } from '../lib/useReducedMotion';
import type { TeroMood } from '../types';
import {
  floatCycles,
  floatHalfCycleMs,
  isDoubleBlink,
  MOOD_MOTION,
  nextBlinkDelayMs,
  reactionForMoodChange,
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

type Options = {
  size: number;
  mood: TeroMood;
  allowed: boolean;
  pressed: boolean;
  reaction?: ReactionRequest | null;
};

/**
 * Controlador de animaciones de Tero. Todo corre con el driver nativo
 * (`transform` y `opacity`): el hilo de JavaScript solo arranca y detiene.
 *
 * Nada es infinito: la flotación dura una ventana tras cada motivo y el
 * parpadeo es un temporizador que se cancela en cuanto Tero no puede moverse.
 */
export function useTeroMotion({ size, mood, allowed, pressed, reaction }: Options) {
  const motion = MOOD_MOTION[mood];

  const float = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(motion.tilt)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const reactScale = useRef(new Animated.Value(1)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const eyes = useRef(new Animated.Value(1)).current;
  // Entrada: solo si al montar ya se puede animar; si no, aparece directamente.
  const enter = useRef(new Animated.Value(allowed ? 0 : 1)).current;

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

  // Cambio de estado: inclinación, transición de la cara y reacción si toca.
  useEffect(() => {
    const previous = previousMood.current;
    previousMood.current = mood;
    const target = MOOD_MOTION[mood].tilt;

    if (!allowed) {
      tilt.setValue(target);
      eyes.setValue(1);
      return;
    }
    Animated.timing(tilt, { toValue: target, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
    if (previous !== null && previous !== mood) {
      eyes.setValue(0.3);
      Animated.timing(eyes, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
    const reactionKind = reactionForMoodChange(previous, mood);
    if (reactionKind) runReaction(reactionKind);
    // `runReaction` lee refs; no hace falta como dependencia.
  }, [mood, allowed, tilt, eyes]);

  // Reacción pedida desde fuera (toque, mensaje recibido...).
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

  // Flotación por ventanas: unos ciclos tras cada motivo (aparecer, cambio de
  // estado, toque o reacción, que por eso son dependencias) y luego quieto.
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
      for (const value of [float, hop, tilt, pressScale, reactScale, blink, eyes, enter]) value.stopAnimation();
    },
    [float, hop, tilt, pressScale, reactScale, blink, eyes, enter],
  );

  return useMemo(() => {
    const eyeLine = size * 0.05; // los ojos están 5 % por debajo del centro
    return {
      bodyStyle: {
        opacity: enter,
        transform: [
          { translateY: Animated.add(float.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.05] }), hop) },
          { rotate: tilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] }) },
          {
            scale: Animated.multiply(
              Animated.multiply(pressScale, reactScale),
              enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
            ),
          },
        ],
      },
      // Parpadeo: escala vertical alrededor de la línea de los ojos, no del centro.
      eyesStyle: {
        opacity: eyes,
        transform: [{ translateY: eyeLine }, { scaleY: blink }, { translateY: -eyeLine }],
      },
    };
  }, [size, enter, float, hop, tilt, pressScale, reactScale, eyes, blink]);
}
