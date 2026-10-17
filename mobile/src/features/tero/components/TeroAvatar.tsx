import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';

import { teroColors } from '../design/teroColors';
import type { TeroMood } from '../types';

type Props = {
  size?: number;
  mood?: TeroMood;
  /** `false` lo deja quieto (preferencia de Tero o "reducir movimiento" del sistema). */
  animated?: boolean;
};

/**
 * Avatar de Tero. ÚNICO punto de la app que sabe cómo se dibuja la mascota: la
 * fase 2 cambia este interior por el runtime de Rive (con este dibujo como
 * respaldo si falta `tero.riv`) sin tocar a quien lo usa.
 *
 * Fase 1: dibujo vectorial con `react-native-svg` (ya instalado) — cuerpo
 * redondo con el copete del tero, rostro oscuro y una expresión por estado.
 */
export function TeroAvatar({ size = 56, mood = 'idle', animated = true }: Props) {
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) {
      float.setValue(0);
      return;
    }
    const duration = mood === 'sleeping' ? 2600 : mood === 'thinking' ? 700 : 1600;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, mood, float]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.05] });

  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ translateY }] }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="teroBody" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={teroColors.cyan} />
            <Stop offset="0.55" stopColor={teroColors.aqua} />
            <Stop offset="1" stopColor={teroColors.blue} />
          </LinearGradient>
        </Defs>
        {/* Copete: el rasgo del tero. */}
        <Path d="M50 22 C 56 6, 72 2, 82 8 C 70 10, 62 15, 58 24 Z" fill={teroColors.lavender} />
        <Circle cx={50} cy={56} r={38} fill="url(#teroBody)" />
        <Ellipse cx={50} cy={58} rx={27} ry={22} fill={teroColors.face} />
        <Face mood={mood} />
      </Svg>
    </Animated.View>
  );
}

function Face({ mood }: { mood: TeroMood }) {
  const eye = teroColors.eye;
  const line = { stroke: eye, strokeWidth: 3.5, strokeLinecap: 'round' as const, fill: 'none' };

  const eyes =
    mood === 'happy' ? (
      <>
        <Path d="M36 56 Q 40 50, 44 56" {...line} />
        <Path d="M56 56 Q 60 50, 64 56" {...line} />
      </>
    ) : mood === 'sleeping' ? (
      <>
        <Path d="M36 56 Q 40 59, 44 56" {...line} />
        <Path d="M56 56 Q 60 59, 64 56" {...line} />
      </>
    ) : mood === 'error' ? (
      <>
        <Path d="M37 52 L43 58 M43 52 L37 58" {...line} strokeWidth={3} />
        <Path d="M57 52 L63 58 M63 52 L57 58" {...line} strokeWidth={3} />
      </>
    ) : (
      <>
        <Circle
          cx={40}
          cy={mood === 'thinking' ? 51 : 55}
          r={mood === 'attention' ? 6 : 4.5}
          fill={eye}
        />
        <Circle
          cx={60}
          cy={mood === 'thinking' ? 51 : 55}
          r={mood === 'attention' ? 6 : 4.5}
          fill={eye}
        />
      </>
    );

  const mouth =
    mood === 'speaking' ? (
      <Ellipse cx={50} cy={68} rx={5} ry={4} fill={teroColors.lavender} />
    ) : mood === 'error' ? (
      <Path d="M44 70 Q 50 65, 56 70" {...line} strokeWidth={3} />
    ) : mood === 'thinking' || mood === 'sleeping' ? (
      <Path d="M46 68 L54 68" {...line} strokeWidth={3} />
    ) : (
      <Path d={mood === 'happy' ? 'M42 65 Q 50 74, 58 65' : 'M44 66 Q 50 71, 56 66'} {...line} strokeWidth={3} />
    );

  return (
    <>
      {eyes}
      {mouth}
      <Circle cx={31} cy={66} r={3.5} fill={teroColors.cheek} opacity={0.55} />
      <Circle cx={69} cy={66} r={3.5} fill={teroColors.cheek} opacity={0.55} />
      {mood === 'listening' ? (
        <Path d="M84 46 Q 90 56, 84 66" {...line} stroke={teroColors.lavender} strokeWidth={3} />
      ) : null}
    </>
  );
}
