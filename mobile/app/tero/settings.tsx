import { Alert, Pressable, Switch, Text, View } from 'react-native';

import { TeroAvatar } from '@features/tero/components/TeroAvatar';
import { TeroGate } from '@features/tero/components/TeroGate';
import { useTero } from '@features/tero/context/TeroContext';
import type { TeroSide } from '@features/tero/types';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

/**
 * Ajustes de Tero. Son preferencias LOCALES de este teléfono (AsyncStorage), a
 * diferencia de «Configuración y privacidad», cuyas filas leen y escriben en el
 * servidor. Por eso viven aquí y no en `app/settings/`.
 */
export default function TeroSettings() {
  return (
    <TeroGate>
      <TeroSettingsContent />
    </TeroGate>
  );
}

const SIDES: { value: TeroSide; label: string }[] = [
  { value: 'left', label: 'Izquierda' },
  { value: 'right', label: 'Derecha' },
];

function TeroSettingsContent() {
  const { preferences, update, reset } = useTero();

  function confirmReset() {
    Alert.alert(
      'Restablecer Tero',
      'Se borrarán las preferencias de Tero guardadas en este teléfono y volverán los valores iniciales.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Restablecer', style: 'destructive', onPress: () => void reset() },
      ],
    );
  }

  return (
    <Screen title="Ajustes de Tero" back>
      {/* Vista previa: refleja al momento «Animaciones» y reducir movimiento. */}
      <View style={styles.preview}>
        <TeroAvatar size={72} mood="idle" />
        <Text style={styles.description}>
          {preferences.animations ? 'Tero se mueve con calma y parpadea de vez en cuando.' : 'Tero se queda quieto.'}
        </Text>
      </View>

      <SwitchRow
        label="Mostrar Tero"
        description="La burbuja flotante sobre las pestañas."
        value={preferences.showTero}
        onChange={(showTero) => update({ showTero })}
      />

      <View style={styles.row}>
        <Text style={styles.label}>Posición</Text>
        <Text style={styles.description}>Lado de la pantalla. También puedes arrastrar la burbuja.</Text>
        <View style={styles.segment} accessibilityRole="radiogroup">
          {SIDES.map((side) => {
            const selected = preferences.side === side.value;
            return (
              <Pressable
                key={side.value}
                onPress={() => update({ side: side.value })}
                style={[styles.segmentItem, selected && styles.segmentSelected]}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{side.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <SwitchRow
        label="Animaciones"
        description="Movimiento de Tero. Si tu teléfono pide reducir el movimiento, Tero se queda quieto igual."
        value={preferences.animations}
        onChange={(animations) => update({ animations })}
      />

      <SwitchRow
        label="Sonidos"
        description="Próximamente: Tero todavía no reproduce sonidos."
        value={preferences.sounds}
        onChange={(sounds) => update({ sounds })}
        disabled
      />

      <View style={styles.row}>
        <Text style={styles.label}>Idioma</Text>
        <Text style={styles.description}>Español. Otros idiomas llegarán con las traducciones de la app.</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Privacidad</Text>
        <Text style={styles.description}>
          Estas preferencias se guardan solo en este teléfono y no incluyen datos de tu cuenta. En esta vista
          previa Tero no envía tus preguntas a ningún servidor ni guarda la conversación.
        </Text>
        <Button label="Restablecer preferencias" variant="secondary" onPress={confirmReset} style={styles.reset} />
      </View>
    </Screen>
  );
}

function SwitchRow({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, styles.switchRow]}>
      <View style={styles.switchText}>
        <Text style={[styles.label, disabled && styles.disabled]}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.borderStrong, true: colors.brand }}
        thumbColor={colors.onBrand}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  preview: { alignItems: 'center', gap: space[2], paddingVertical: space[4] },
  row: { paddingVertical: space[4], borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  switchText: { flex: 1 },
  label: { fontSize: fontSize.bodyLg, fontWeight: '600', color: colors.fg },
  disabled: { color: colors.fgDisabled },
  description: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2, lineHeight: 18 },
  segment: {
    flexDirection: 'row',
    marginTop: space[3],
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  segmentSelected: { backgroundColor: colors.brand },
  segmentText: { fontSize: fontSize.bodyMd, color: colors.fgSecondary },
  segmentTextSelected: { color: colors.onBrand, fontWeight: '700' },
  reset: { marginTop: space[3] },
}));
