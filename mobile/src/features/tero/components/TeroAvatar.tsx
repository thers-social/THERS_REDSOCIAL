import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';

import { MOOD_MOTION } from '../animation/expressions';
import { useTeroMotion, useTeroMotionAllowed } from '../animation/useTeroMotion';
import type { ReactionRequest } from '../animation/useTeroMotion';
import { teroColors } from '../design/teroColors';
import type { TeroMood } from '../types';
import { TeroDots } from './TeroDots';

type Props = {
  size?: number;
  mood?: TeroMood;
  /**
   * `false` lo deja quieto. Se combina con las reglas comunes
   * (`useTeroMotionAllowed`): preferencia «Animaciones», reducir movimiento,
   * app en segundo plano y pantalla no visible.
   */
  animated?: boolean;
  /** Dedo encima (la burbuja se hunde un poco). */
  pressed?: boolean;
  /** Reacción breve pedida desde fuera (`key` nuevo = reaccionar otra vez). */
  reaction?: ReactionRequest | null;
};

/**
 * Avatar de Tero. ÚNICO punto de la app que sabe cómo se dibuja y se mueve la
 * mascota: si en el futuro se adopta Rive (docs/tero/TERO_PHASE2.md §Rive),
 * cambia este interior, con este dibujo como respaldo, sin tocar a quien lo usa.
 *
 * Dibujo en dos capas de `react-native-svg`: el cuerpo (copete, cuerpo, rostro
 * oscuro, boca) y, encima, los ojos, que van aparte para poder parpadear con una
 * transformación nativa sin redibujar el SVG.
 */
export function TeroAvatar({ size = 56, mood = 'idle', animated = true, pressed = false, reaction = null }: Props) {
  const allowed = useTeroMotionAllowed(animated);
  const { bodyStyle, eyesStyle } = useTeroMotion({ size, mood, allowed, pressed, reaction });
  const dotSize = Math.max(3, Math.round(size * 0.07));

  return (
    <Animated.View
      style={[{ width: size, height: size }, bodyStyle]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
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
        <Mouth mood={mood} />
        <Circle cx={31} cy={66} r={3.5} fill={teroColors.cheek} opacity={0.55} />
        <Circle cx={69} cy={66} r={3.5} fill={teroColors.cheek} opacity={0.55} />
        {mood === 'listening' ? (
          <Path d="M84 46 Q 90 56, 84 66" {...line} stroke={teroColors.lavender} strokeWidth={3} />
        ) : null}
      </Svg>

      <Animated.View style={[StyleSheet.absoluteFill, eyesStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Eyes mood={mood} />
        </Svg>
      </Animated.View>

      {MOOD_MOTION[mood].thinkingDots ? (
        <View style={[styles.dots, { top: size * 0.04, left: size * 0.02 }]}>
          <TeroDots color={teroColors.lavender} dot={dotSize} animated={allowed} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const line = { stroke: teroColors.eye, strokeWidth: 3.5, strokeLinecap: 'round' as const, fill: 'none' };

function Eyes({ mood }: { mood: TeroMood }) {
  if (mood === 'happy') {
    return (
      <>
        <Path d="M36 56 Q 40 50, 44 56" {...line} />
        <Path d="M56 56 Q 60 50, 64 56" {...line} />
      </>
    );
  }
  if (mood === 'sleeping') {
    return (
      <>
        <Path d="M36 56 Q 40 59, 44 56" {...line} />
        <Path d="M56 56 Q 60 59, 64 56" {...line} />
      </>
    );
  }
  if (mood === 'error') {
    return (
      <>
        <Path d="M37 52 L43 58 M43 52 L37 58" {...line} strokeWidth={3} />
        <Path d="M57 52 L63 58 M63 52 L57 58" {...line} strokeWidth={3} />
      </>
    );
  }
  // Ojos redondos: en «pensando» miran hacia arriba; en «curioso», más grandes.
  const cy = mood === 'thinking' ? 51 : 55;
  const r = mood === 'attention' ? 6 : 4.5;
  return (
    <>
      <Circle cx={40} cy={cy} r={r} fill={teroColors.eye} />
      <Circle cx={60} cy={cy} r={r} fill={teroColors.eye} />
    </>
  );
}

function Mouth({ mood }: { mood: TeroMood }) {
  if (mood === 'speaking') return <Ellipse cx={50} cy={68} rx={5} ry={4} fill={teroColors.lavender} />;
  if (mood === 'error') return <Path d="M44 70 Q 50 65, 56 70" {...line} strokeWidth={3} />;
  if (mood === 'thinking' || mood === 'sleeping') return <Path d="M46 68 L54 68" {...line} strokeWidth={3} />;
  return (
    <Path d={mood === 'happy' ? 'M42 65 Q 50 74, 58 65' : 'M44 66 Q 50 71, 56 66'} {...line} strokeWidth={3} />
  );
}

const styles = StyleSheet.create({
  dots: { position: 'absolute' },
});
