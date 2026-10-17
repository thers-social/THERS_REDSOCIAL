import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@shared/lib/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import { reportPlace } from './api';
import {
  MAX_REPORT_DETAILS,
  REASON_NEEDS_DETAILS,
  REPORT_REASONS,
  type ReportReason,
} from './placeReasons';

type Props = { visible: boolean; placeId: string; placeName: string; onClose: () => void };

/**
 * Reportar datos incorrectos de un lugar (`POST /api/places/<id>/report`, ADR-040 fase 2).
 * El servidor valida todo; aquí solo se evita enviar un formulario que se sabe inválido.
 */
export function ReportPlaceModal({ visible, placeId, placeName, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetails('');
      setBusy(false);
      setError(null);
      setSent(false);
    }
  }, [visible]);

  const needsDetails = reason === REASON_NEEDS_DETAILS;
  const canSend = !!reason && (!needsDetails || details.trim().length > 0) && !busy;

  async function submit() {
    if (!reason || !canSend) return;
    setBusy(true);
    setError(null);
    try {
      await reportPlace(placeId, { reason, details: details.trim() || undefined });
      setSent(true);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'No pudimos enviar el reporte. Intentá de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space[4] }]}>
          {sent ? (
            <View>
              <Text style={styles.title} accessibilityRole="header">
                Gracias por avisarnos
              </Text>
              <Text style={styles.body}>
                Recibimos tu reporte sobre «{placeName}». El equipo de moderación lo revisará.
              </Text>
              <Button label="Cerrar" onPress={onClose} />
            </View>
          ) : (
            <>
              <Text style={styles.title} accessibilityRole="header">
                Reportar datos de «{placeName}»
              </Text>
              <Text style={styles.body}>¿Qué está mal?</Text>
              {error ? <Banner tone="error">{error}</Banner> : null}
              <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                {REPORT_REASONS.map((item) => {
                  const selected = reason === item.value;
                  return (
                    <Pressable
                      key={item.value}
                      onPress={() => setReason(item.value)}
                      style={[styles.reason, selected && styles.reasonSelected]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
                <TextInput
                  style={styles.details}
                  value={details}
                  onChangeText={setDetails}
                  placeholder={needsDetails ? 'Contanos qué pasa (obligatorio)' : 'Detalles (opcional)'}
                  placeholderTextColor={colors.fgDisabled}
                  multiline
                  maxLength={MAX_REPORT_DETAILS}
                  textAlignVertical="top"
                  accessibilityLabel="Detalles del reporte"
                />
              </ScrollView>
              <View style={styles.buttons}>
                <Button
                  label="Cancelar"
                  variant="secondary"
                  onPress={onClose}
                  disabled={busy}
                  style={styles.flex}
                />
                <Button
                  label="Enviar reporte"
                  onPress={submit}
                  loading={busy}
                  disabled={!canSend}
                  style={styles.flex}
                />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.dialog,
    borderTopRightRadius: radius.dialog,
    padding: space[4],
    maxHeight: '85%',
  },
  title: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, marginBottom: space[2] },
  body: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginBottom: space[3], lineHeight: 21 },
  list: { flexGrow: 0 },
  reason: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    marginBottom: space[2],
  },
  reasonSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  reasonText: { fontSize: fontSize.bodyMd, color: colors.fg },
  reasonTextSelected: { color: colors.brandText, fontWeight: '700' },
  details: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
    marginTop: space[1],
  },
  buttons: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  flex: { flex: 1 },
}));
