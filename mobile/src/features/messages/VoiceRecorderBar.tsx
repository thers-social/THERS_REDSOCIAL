import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

import { VoiceBubble } from './VoiceBubble';
import { formatDuration } from './voice';
import type { VoiceRecorderApi } from './useVoiceRecorder';

/**
 * Barra que sustituye al campo de texto mientras se graba o se revisa una nota de voz (`ADR-042`).
 * Solo dibuja: el estado vive en `useVoiceRecorder`.
 *
 *  · grabando: punto rojo, tiempo y tope, «Detener» y «Cancelar»;
 *  · grabada: vista previa para escucharla, «Descartar» y «Enviar». Nada se manda solo.
 */
export function VoiceRecorderBar({
  voice,
  sending,
  onSend,
}: {
  voice: VoiceRecorderApi;
  sending: boolean;
  onSend: () => void;
}) {
  const { status, elapsedMs, recording, maxSeconds } = voice;

  if (status === 'recording' || status === 'requesting') {
    return (
      <View style={styles.row} accessibilityLabel="Grabando una nota de voz">
        <Pressable
          onPress={() => void voice.clear()}
          hitSlop={8}
          style={styles.ghost}
          accessibilityRole="button"
          accessibilityLabel="Cancelar la grabación"
        >
          <Icon name="close" size={22} color={colors.fgMuted} />
        </Pressable>
        <View style={styles.dot} />
        <Text style={styles.timer} accessibilityLiveRegion="none">
          {status === 'requesting' ? 'Esperando permiso…' : formatDuration(elapsedMs)}
        </Text>
        <Text style={styles.hint} numberOfLines={1}>
          Máximo {Math.round(maxSeconds / 60)} minutos
        </Text>
        <Pressable
          onPress={() => void voice.stop()}
          disabled={status === 'requesting'}
          style={[styles.stop, status === 'requesting' && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Detener la grabación"
        >
          <Icon name="stop" size={18} color={colors.onBrand} />
        </Pressable>
      </View>
    );
  }

  if (status === 'recorded' && recording) {
    return (
      <View style={styles.row} accessibilityLabel="Tu nota de voz, lista para enviar">
        <Pressable
          onPress={() => void voice.clear()}
          disabled={sending}
          hitSlop={8}
          style={[styles.ghost, sending && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Descartar la nota de voz"
        >
          <Icon name="close" size={22} color={colors.fgMuted} />
        </Pressable>
        <View style={styles.preview}>
          <VoiceBubble url={recording.uri} durationMs={recording.durationMs} mine={false} name="ti" />
        </View>
        <Pressable
          onPress={onSend}
          disabled={sending}
          style={[styles.send, sending && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Enviar la nota de voz"
        >
          <Text style={styles.sendText}>Enviar</Text>
        </Pressable>
      </View>
    );
  }

  return null;
}

/** Botón de micrófono del compositor. */
export function VoiceRecordButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.mic, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel="Grabar una nota de voz"
    >
      <Icon name="mic" size={22} color={colors.fg} />
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 44 },
  ghost: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.dangerAccent },
  timer: { fontSize: fontSize.bodyMd, fontWeight: '600', color: colors.fg, minWidth: 44 },
  hint: { flex: 1, fontSize: fontSize.labelMd, color: colors.fgMuted },
  stop: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space[3],
    justifyContent: 'center',
  },
  send: {
    minHeight: 44,
    minWidth: 72,
    borderRadius: radius.input,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
  },
  sendText: { color: colors.onBrand, fontWeight: '700', fontSize: fontSize.bodyMd },
  mic: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
}));
