import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

import { formatDuration, voiceAccessibilityLabel } from './voice';

// Solo suena una nota a la vez: al darle a reproducir en otra, la anterior se pausa.
let playing: AudioPlayer | null = null;

type Props = {
  url: string;
  /** La duración que calculó el servidor (o la de la grabación propia): no se depende de la del archivo. */
  durationMs: number;
  mine: boolean;
  /** Nombre de la otra persona, para la etiqueta accesible. */
  name: string;
};

/**
 * Nota de voz dentro de una burbuja (`ADR-042`): botón de reproducir/pausar, barra de progreso y la
 * duración. `mine` solo cambia los colores para que se lea sobre la burbuja de quien la mandó.
 */
export function VoiceBubble({ url, durationMs, mine, name }: Props) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const totalMs = Math.max(1, durationMs || status.duration * 1000 || 1);
  const positionMs = Math.min(totalMs, status.currentTime * 1000);
  const progress = status.playing || positionMs > 0 ? positionMs / totalMs : 0;

  // Al terminar, vuelve al principio para poder oírla de nuevo.
  useEffect(() => {
    if (status.didJustFinish) {
      void player.seekTo(0);
      if (playing === player) playing = null;
    }
  }, [status.didJustFinish, player]);

  // Una nota que se desmonta (otra conversación, salir del chat) deja de sonar.
  useEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        // ya estaba liberado
      }
      if (playing === player) playing = null;
    },
    [player],
  );

  function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (playing && playing !== player) {
      try {
        playing.pause();
      } catch {
        // ya estaba liberado
      }
    }
    playing = player;
    player.play();
  }

  const shown = status.playing || positionMs > 0 ? positionMs : totalMs;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        style={[styles.button, mine ? styles.buttonMine : styles.buttonTheirs]}
        accessibilityRole="button"
        accessibilityLabel={`${status.playing ? 'Pausar' : 'Reproducir'}. ${voiceAccessibilityLabel({ mine, name, durationMs: totalMs })}`}
      >
        <Icon name={status.playing ? 'pause' : 'play'} size={16} color={mine ? colors.onBrand : colors.onBrand} />
      </Pressable>
      <View style={[styles.track, mine ? styles.trackMine : styles.trackTheirs]}>
        <View
          style={[
            styles.fill,
            mine ? styles.fillMine : styles.fillTheirs,
            { width: `${Math.round(Math.min(1, progress) * 100)}%` },
          ]}
        />
      </View>
      <Text style={[styles.time, mine && styles.timeMine]} importantForAccessibility="no">
        {formatDuration(shown)}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minWidth: 190 },
  button: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonMine: { backgroundColor: 'rgba(255,255,255,0.22)' },
  buttonTheirs: { backgroundColor: colors.brand },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  trackMine: { backgroundColor: 'rgba(255,255,255,0.3)' },
  trackTheirs: { backgroundColor: colors.border },
  fill: { height: '100%', borderRadius: 2 },
  fillMine: { backgroundColor: colors.onBrand },
  fillTheirs: { backgroundColor: colors.brand },
  time: { fontSize: fontSize.labelSm, color: colors.fgMuted, minWidth: 34, textAlign: 'right' },
  timeMine: { color: colors.onBrandMuted },
}));
