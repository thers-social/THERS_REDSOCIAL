import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet } from 'react-native';

/** Cuánto se queda el logo a plena opacidad antes de empezar a irse (igual que en la web: 1,5 s). */
const HOLD_MS = 1500;
const FADE_OUT_MS = 700;
const FADE_IN_MS = 450;

/** El PNG es un lienzo de 1024 px con la TH ocupando ~59 % del ancho: 270 px de lienzo ≈ 160 px de logo. */
const LOGO_CANVAS = 270;

// Una sola vez por arranque de la app: volver a montar el layout (cambio de tema, etc.) no repite la pantalla.
let alreadyShown = false;

/**
 * Pantalla de entrada: fondo negro con el logo de THERS en el centro, como al abrir la web (`App.jsx`).
 * Aparece sobre todo lo demás al arrancar, se mantiene un momento y se desvanece. Con «reducir
 * movimiento» activado no anima: se muestra fija y desaparece sin transición.
 */
export function BrandSplash() {
  const [visible, setVisible] = useState(!alreadyShown);
  const opacity = useRef(new Animated.Value(1)).current;
  const logo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (alreadyShown) return undefined;
    alreadyShown = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) {
          logo.setValue(1);
          timer = setTimeout(() => setVisible(false), HOLD_MS);
          return;
        }
        Animated.timing(logo, {
          toValue: 1,
          duration: FADE_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        timer = setTimeout(() => {
          Animated.timing(opacity, {
            toValue: 0,
            duration: FADE_OUT_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }).start(() => !cancelled && setVisible(false));
        }, HOLD_MS);
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [logo, opacity]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.root, { opacity }]}
      pointerEvents="auto"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.Image
        source={require('../../../assets/splash-icon.png')}
        style={[
          styles.logo,
          {
            opacity: logo,
            transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          },
        ]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </Animated.View>
  );
}

// Sin tokens de tema a propósito: es siempre negro, tenga el teléfono el tema que tenga (igual que la web).
const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  logo: { width: LOGO_CANVAS, height: LOGO_CANVAS },
});
