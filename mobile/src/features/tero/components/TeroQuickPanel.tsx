import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { Modal, Pressable, Text, View } from 'react-native';
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

/**
 * Panel rápido que abre la burbuja. Misma estructura que `ActionSheet` (hoja
 * inferior sobre un telón, se cierra con Atrás), pero con accesos en cuadrícula
 * en vez de una lista de acciones.
 */
export function TeroQuickPanel({ visible, animated, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar Tero" accessibilityRole="button">
        <View />
      </Pressable>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space[4] }]}>
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
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: colors.scrim },
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
