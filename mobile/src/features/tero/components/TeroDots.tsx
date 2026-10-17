import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

type Props = {
  color: string;
  /** Diámetro de cada punto. */
  dot?: number;
  /** `false`: puntos quietos (sin animaciones permitidas). */
  animated: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tres puntos que se encienden en secuencia: el indicador de «Tero está
 * pensando». Lo usan el avatar (sobre la cabeza) y el chat (burbuja de
 * escritura). Solo existe mientras Tero piensa, así que la animación no es
 * permanente; sin animaciones queda como tres puntos quietos.
 */
export function TeroDots({ color, dot = 6, animated, style }: Props) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0.35))).current;

  useEffect(() => {
    if (!animated) {
      values.forEach((value) => value.setValue(0.8));
      return;
    }
    const pulse = (value: Animated.Value) =>
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0.35, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]);
    const loop = Animated.loop(Animated.stagger(160, values.map(pulse)));
    loop.start();
    return () => loop.stop();
  }, [animated, values]);

  return (
    <View style={[{ flexDirection: 'row', gap: dot * 0.6 }, style]} accessible={false}>
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: color,
            opacity: value,
            transform: [{ scale: value.interpolate({ inputRange: [0.35, 1], outputRange: [0.8, 1.1] }) }],
          }}
        />
      ))}
    </View>
  );
}
