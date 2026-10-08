import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

export type SheetAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

type Props = {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
};

/**
 * Hoja de acciones inferior (menú de una publicación, de un mensaje...). `Alert`
 * de Android admite solo tres botones y no se ve como THERS; esto no tiene límite
 * y se cierra con el botón Atrás del sistema.
 */
export function ActionSheet({ visible, title, actions, onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Cerrar menú"
        accessibilityRole="button"
      >
        <View />
      </Pressable>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space[3] }]}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {actions.map((action) => (
          <Pressable
            key={action.label}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.itemText, action.destructive && styles.destructive]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={({ pressed }) => [styles.item, styles.cancel, pressed && styles.itemPressed]}
          onPress={onClose}
          accessibilityRole="button"
        >
          <Text style={styles.itemText}>Cancelar</Text>
        </Pressable>
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
    paddingTop: space[2],
    paddingHorizontal: space[2],
  },
  title: {
    fontSize: fontSize.labelLg,
    color: colors.fgMuted,
    textAlign: 'center',
    paddingVertical: space[3],
  },
  item: { minHeight: 52, justifyContent: 'center', paddingHorizontal: space[4] },
  itemPressed: { backgroundColor: colors.bgSubtle },
  itemText: { fontSize: fontSize.bodyLg, color: colors.fg },
  destructive: { color: colors.dangerAccent, fontWeight: '600' },
  cancel: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, marginTop: space[1] },
}));
