import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';
import type { IconName } from '@shared/ui/Icon';

import { TeroAvatar } from './TeroAvatar';

type Props = {
  visible: boolean;
  animated: boolean;
  onClose: () => void;
};

type Entry = { label: string; description: string; icon: IconName; href: Href };

/**
 * «Novedades» abre la pantalla de Avisos que ya existe (datos reales del
 * servidor) en vez de duplicarla dentro de Tero.
 */
const ENTRIES: Entry[] = [
  { label: 'Preguntar', description: 'Escríbele a Tero', icon: 'comment', href: '/tero/chat' },
  { label: 'Resumen', description: 'Tu semana en THERS', icon: 'activity', href: '/tero/summary' },
  { label: 'Novedades', description: 'Tus avisos', icon: 'bell', href: '/notifications' },
  { label: 'Más', description: 'Inicio de Tero y ajustes', icon: 'more', href: '/tero' },
];

/** Distancia desde la que sube la hoja al abrirse. */
const SHEET_TRAVEL = 360;

/**
 * Panel rápido que abre la burbuja. Misma estructura que `ActionSheet` (hoja
 * inferior sobre un telón, se cierra con Atrás), pero con accesos en cuadrícula
 * en vez de una lista de acciones.
 *
 * Apertura y cierre animados con el driver nativo: el telón se funde y la hoja
 * sube con un resorte suave. Sin animaciones (preferencia o accesibilidad),
 * aparece y desaparece al instante. Al elegir un acceso se cierra al instante,
 * para no quedar encima de la pantalla que se abre.
 */
export function TeroQuickPanel({ visible, animated, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const closeInstantly = useRef(false);

  useEffect(() => {
    if (visible) {
      closeInstantly.current = false;
      setMounted(true);
      if (animated) {
        progress.setValue(0);
        Animated.spring(progress, { toValue: 1, friction: 9, tension: 70, useNativeDriver: true }).start();
      } else {
        progress.setValue(1);
      }
      return;
    }
    if (!animated || closeInstantly.current) {
      progress.stopAnimation();
      setMounted(false);
      return;
    }
    const exit = Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    exit.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => exit.stop();
  }, [visible, animated, progress]);

  const sheetMotion = {
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [SHEET_TRAVEL, 0] }) }],
  };

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Cerrar Tero"
          accessibilityRole="button"
        />
      </Animated.View>
      <View style={styles.spacer} pointerEvents="none" />
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + space[4] }, sheetMotion]}>
        <View style={styles.header}>
          <TeroAvatar size={48} mood="attention" animated={animated} />
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">
              Hola, soy Tero
            </Text>
            <Text style={styles.subtitle}>¿En qué te ayudo? · Vista previa</Text>
          </View>
        </View>
        <View style={styles.grid}>
          {ENTRIES.map((entry) => (
            <Pressable
              key={entry.label}
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={() => {
                closeInstantly.current = true;
                onClose();
                router.push(entry.href);
              }}
              accessibilityRole="button"
              accessibilityLabel={entry.label}
              accessibilityHint={entry.description}
            >
              <Icon name={entry.icon} color={colors.brandText} />
              <Text style={styles.tileLabel}>{entry.label}</Text>
              <Text style={styles.tileDescription} numberOfLines={1}>
                {entry.description}
              </Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { backgroundColor: colors.scrim },
  spacer: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.dialog,
    borderTopRightRadius: radius.dialog,
    paddingTop: space[4],
    paddingHorizontal: space[4],
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space[4] },
  headerText: { marginLeft: space[3], flex: 1 },
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg },
  subtitle: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 96,
    padding: space[3],
    borderRadius: radius.card,
    backgroundColor: colors.bgSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    justifyContent: 'space-between',
  },
  tilePressed: { backgroundColor: colors.brandSoft },
  tileLabel: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginTop: space[2] },
  tileDescription: { fontSize: fontSize.labelMd, color: colors.fgMuted },
}));
