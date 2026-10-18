import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { Banner } from '@shared/ui/Banner';
import { space } from '@shared/design/tokens';

import { useVoiceRecorder } from './useVoiceRecorder';
import { VoiceRecordButton, VoiceRecorderBar } from './VoiceRecorderBar';
import { VOICE_MESSAGES } from './voice';
import type { VoiceRecording } from './voice';

type Props = {
  /** Estilo del contenedor del compositor, para que la barra de voz ocupe su lugar. */
  containerStyle: StyleProp<ViewStyle>;
  /** `false` mientras el chat no admite escribir (cargando, bloqueado…). */
  enabled: boolean;
  /** Muestra el micrófono (se oculta cuando ya hay texto escrito). */
  showMic: boolean;
  /** Entrega la grabación al chat. El archivo pasa a ser suyo: se borra al confirmarse el envío. */
  onSend: (recording: VoiceRecording) => void;
  /** El compositor de texto normal; recibe el botón de micrófono para ponerlo donde quiera. */
  children: (mic: ReactNode) => ReactNode;
};

/**
 * Compositor con notas de voz (`ADR-042`). Solo existe con `EXPO_PUBLIC_VOICE_ENABLED`: con el
 * interruptor apagado el chat ni siquiera crea un grabador. Mientras se graba o se revisa una nota,
 * la barra de voz sustituye al campo de texto; el resto del tiempo se dibuja el compositor normal.
 */
export function VoiceComposer({ containerStyle, enabled, showMic, onSend, children }: Props) {
  const voice = useVoiceRecorder();
  const busy = voice.status !== 'idle';

  function send() {
    const recording = voice.recording;
    if (!recording) return;
    onSend(recording);
    // La grabación ya es del chat (que la reproduce y puede reintentar el envío): se suelta
    // el estado SIN borrar el archivo.
    voice.release();
  }

  return (
    <>
      {voice.error ? (
        <View style={{ paddingHorizontal: space[3] }}>
          <Banner tone="error">{VOICE_MESSAGES[voice.error]}</Banner>
        </View>
      ) : null}
      {busy ? (
        <View style={containerStyle}>
          <VoiceRecorderBar voice={voice} sending={false} onSend={send} />
        </View>
      ) : (
        children(
          showMic ? <VoiceRecordButton onPress={() => void voice.start()} disabled={!enabled} /> : null,
        )
      )}
    </>
  );
}
