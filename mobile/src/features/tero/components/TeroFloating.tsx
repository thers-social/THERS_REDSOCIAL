import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Animated, Keyboard, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from '@shared/design/tokens';

import { useTero } from '../context/TeroContext';
import { clampRatio } from '../lib/preferences';
import { useReducedMotion } from '../lib/useReducedMotion';
import type { TeroSide } from '../types';
import { TeroAvatar } from './TeroAvatar';
import { TeroQuickPanel } from './TeroQuickPanel';

const SIZE = 56;
const EDGE = space[3];
/** Alto de la cabecera de `Screen` (52) más un margen: la burbuja no la tapa. */
const TOP_CLEARANCE = 52 + space[2];
/** Distancia mínima para que un toque pase a ser un arrastre. */
const DRAG_THRESHOLD = 6;

type Props = {
  /** Alto de la barra de navegación inferior: la burbuja nunca baja de ahí. */
  bottomOffset: number;
};

type Bounds = { width: number; minY: number; maxY: number };

function positionFor(bounds: Bounds, side: TeroSide, ratio: number) {
  return {
    x: side === 'left' ? EDGE : bounds.width - SIZE - EDGE,
    y: bounds.minY + clampRatio(ratio) * (bounds.maxY - bounds.minY),
  };
}

/**
 * Burbuja flotante de Tero. Se monta UNA vez, en `app/(tabs)/_layout.tsx`, encima
 * de las pestañas: solo existe con sesión y conoce el alto real de la barra.
 *
 * - Se arrastra dentro de una zona segura (debajo de la cabecera, encima de la
 *   barra) y al soltarla se pega al borde más cercano. Posición y lado se
 *   guardan en las preferencias de Tero.
 * - Un toque abre el panel rápido.
 * - Se oculta con el teclado abierto: si no, taparía el campo de publicar o de
 *   escribir.
 * - Arrastre con `PanResponder` + `Animated` del núcleo de React Native: no hace
 *   falta `GestureHandlerRootView` (que el layout raíz no tiene) ni declarar
 *   dependencias nuevas para una sola burbuja.
 */
export function TeroFloating({ bottomOffset }: Props) {
  const { enabled, ready, preferences, update } = useTero();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const animate = preferences.animations && !reducedMotion;

  const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const position = useRef(new Animated.ValueXY()).current;
  const dragging = useRef(false);
  const placed = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  const bounds = useMemo<Bounds | null>(() => {
    if (!layout) return null;
    const minY = insets.top + TOP_CLEARANCE;
    const maxY = Math.max(minY, layout.height - bottomOffset - SIZE - EDGE);
    return { width: layout.width, minY, maxY };
  }, [layout, insets.top, bottomOffset]);

  // El PanResponder se crea una vez; lee lo que cambia a través de refs.
  const latest = useRef({ bounds, animate, update });
  latest.current = { bounds, animate, update };

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Coloca la burbuja según las preferencias (al cargar, al rotar o al cambiar
  // el lado desde Ajustes de Tero). Durante un arrastre manda el dedo.
  // La primera colocación es inmediata: animarla haría que la burbuja entrara
  // volando desde la esquina superior izquierda (el origen del `ValueXY`).
  useEffect(() => {
    if (!bounds || dragging.current) return;
    const target = positionFor(bounds, preferences.side, preferences.verticalRatio);
    if (animate && placed.current) {
      Animated.spring(position, { toValue: target, useNativeDriver: false, friction: 7 }).start();
    } else {
      position.setValue(target);
    }
    placed.current = true;
  }, [bounds, preferences.side, preferences.verticalRatio, animate, position]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Fase de captura: el contenedor le quita el gesto al `Pressable` de
        // adentro en cuanto el dedo se mueve, y así un arrastre nunca abre el panel.
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) + Math.abs(g.dy) > DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          dragging.current = true;
          position.stopAnimation((value) => {
            start.current = value;
          });
        },
        onPanResponderMove: (_e, g) => {
          const b = latest.current.bounds;
          if (!b) return;
          position.setValue({
            x: Math.min(b.width - SIZE, Math.max(0, start.current.x + g.dx)),
            y: Math.min(b.maxY, Math.max(b.minY, start.current.y + g.dy)),
          });
        },
        onPanResponderRelease: (_e, g) => {
          dragging.current = false;
          const b = latest.current.bounds;
          if (!b) return;
          const x = start.current.x + g.dx;
          const y = Math.min(b.maxY, Math.max(b.minY, start.current.y + g.dy));
          const side: TeroSide = x + SIZE / 2 < b.width / 2 ? 'left' : 'right';
          const ratio = b.maxY === b.minY ? 1 : (y - b.minY) / (b.maxY - b.minY);
          const target = positionFor(b, side, ratio);
          if (latest.current.animate) {
            Animated.spring(position, { toValue: target, useNativeDriver: false, friction: 7 }).start();
          } else {
            position.setValue(target);
          }
          latest.current.update({ side, verticalRatio: ratio });
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
        },
      }),
    [position],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((current) =>
      current && current.width === width && current.height === height ? current : { width, height },
    );
  };

  const visible = enabled && ready && preferences.showTero && !keyboardVisible;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onLayout}>
      {visible && bounds ? (
        <Animated.View
          style={[styles.bubble, { transform: position.getTranslateTransform() }]}
          {...responder.panHandlers}
        >
          <Pressable
            onPress={() => setPanelOpen(true)}
            style={styles.pressable}
            accessibilityRole="button"
            accessibilityLabel="Tero, tu asistente"
            accessibilityHint="Abre el panel de Tero. Mantén y arrastra para moverlo."
            accessibilityActions={[{ name: 'switchSide', label: 'Mover al otro lado' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'switchSide') {
                update({ side: preferences.side === 'left' ? 'right' : 'left' });
              }
            }}
          >
            <TeroAvatar size={SIZE} mood={panelOpen ? 'attention' : 'idle'} animated={animate} />
          </Pressable>
        </Animated.View>
      ) : null}
      <TeroQuickPanel visible={panelOpen} animated={animate} onClose={() => setPanelOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    // Sombra sutil para separarla del contenido (negra en ambos temas).
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  pressable: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
});
