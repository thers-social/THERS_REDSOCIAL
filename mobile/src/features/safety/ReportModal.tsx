import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
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

import { MAX_REPORT_DETAILS, REPORT_REASONS, sendReport } from './api';
import type { ReportReason, ReportResult, ReportTargetType } from './api';

type Props = {
  visible: boolean;
  targetType: ReportTargetType;
  targetId: string;
  /** Qué se está reportando, en palabras: «esta publicación», «a @ana». */
  targetLabel: string;
  onClose: () => void;
};

/**
 * Reportar una publicación, un comentario, un mensaje recibido o una cuenta
 * (`ADR-032`). Quien reporta NO es revelado a la persona reportada. Un reporte es
 * solo para lo que la persona puede ver; el servidor lo comprueba.
 */
export function ReportModal({ visible, targetType, targetId, targetLabel, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);

  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetails('');
      setBusy(false);
      setError(null);
      setResult(null);
    }
  }, [visible]);

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await sendReport({ targetType, targetId, reason, details }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos enviar el reporte. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior="padding"
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space[4] }]}>
          {result ? (
            <View>
              <Text style={styles.title} accessibilityRole="header">
                {result.outcome === 'unavailable' ? 'Reportes no disponibles todavía' : 'Gracias por avisarnos'}
              </Text>
              <Text style={styles.body}>
                {result.outcome === 'unavailable'
                  ? 'El servidor todavía no admite reportes, así que NO se envió nada. Estará disponible en una próxima actualización.'
                  : result.priority === 'critical'
                    ? // La prioridad la decidió el SERVIDOR. No se afirma que el contenido sea ilegal, que la
                      // persona sea culpable ni que vaya a ser suspendida automáticamente.
                      'Gracias por tu reporte. Este tipo de denuncia recibe revisión prioritaria por nuestro equipo de moderación.'
                    : result.outcome === 'sent'
                      ? 'Recibimos tu reporte. El equipo de moderación lo revisará. La otra persona no sabrá que fuiste tú.'
                      : 'Ya habías reportado esto. Seguimos con tu reporte anterior.'}
              </Text>
              <Button label="Cerrar" onPress={onClose} />
            </View>
          ) : (
            <>
              <Text style={styles.title} accessibilityRole="header">
                Reportar {targetLabel}
              </Text>
              <Text style={styles.body}>¿Por qué lo reportas?</Text>
              {error ? <Banner tone="error">{error}</Banner> : null}
              <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                {REPORT_REASONS.map((item) => {
                  const selected = reason === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => setReason(item.id)}
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
                  placeholder="Detalles (opcional)"
                  placeholderTextColor={colors.fgDisabled}
                  multiline
                  maxLength={MAX_REPORT_DETAILS}
                  textAlignVertical="top"
                  accessibilityLabel="Detalles del reporte"
                />
              </ScrollView>
              <View style={styles.buttons}>
                <Button label="Cancelar" variant="secondary" onPress={onClose} disabled={busy} style={styles.flex} />
                <Button
                  label="Enviar reporte"
                  onPress={submit}
                  loading={busy}
                  disabled={!reason}
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
