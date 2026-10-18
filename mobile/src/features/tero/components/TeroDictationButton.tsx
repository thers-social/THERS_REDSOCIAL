import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';

import { colors, radius } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Icon } from '@shared/ui/Icon';

import {
  DICTATION_MESSAGES,
  RECOGNITION_LANG,
  dictationErrorKind,
  dictationPermissionProblem,
  joinDictation,
} from '../lib/teroVoice';

type Props = {
  /** Texto que ya hay en el campo: dictar se lo AÑADE, nunca lo borra. */
  draft: string;
  /** Pone el texto dictado en el campo. NUNCA se envía solo: enviar es un acto aparte de la persona. */
  onDraft: (text: string) => void;
  /** Mensaje para la persona (escuchando, error…); `null` lo quita. */
  onMessage: (message: string | null) => void;
  /** Avisa de si está escuchando (la pantalla puede mostrar a Tero atento). */
  onListening?: (listening: boolean) => void;
  disabled?: boolean;
};

/**
 * Botón de dictado para Tero (`ADR-042` §1.2). Solo existe con `EXPO_PUBLIC_TERO_VOICE_ENABLED`.
 * El reconocimiento lo hace el teléfono (en Android, el servicio de Google): THERS no recibe el audio.
 * El permiso del micrófono se pide SOLO al pulsar, nunca al abrir la pantalla.
 */
export function TeroDictationButton({ draft, onDraft, onMessage, onListening, disabled }: Props) {
  const [listening, setListening] = useState(false);
  const baseRef = useRef('');

  const setState = useCallback(
    (next: boolean) => {
      setListening(next);
      onListening?.(next);
    },
    [onListening],
  );

  useSpeechRecognitionEvent('start', () => setState(true));
  useSpeechRecognitionEvent('end', () => {
    setState(false);
    onMessage(null);
  });
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript ?? '';
    onDraft(joinDictation(baseRef.current, transcript));
  });
  useSpeechRecognitionEvent('error', (event) => {
    const kind = dictationErrorKind(event.error);
    setState(false);
    onMessage(kind ? DICTATION_MESSAGES[kind] : null);
  });

  // Soltar el micrófono si la pantalla se cierra a mitad de un dictado.
  useEffect(
    () => () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // no estaba escuchando
      }
    },
    [],
  );

  async function toggle() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    onMessage(null);
    try {
      // El permiso se pide AQUÍ, al pulsar dictar: nunca al abrir la pantalla.
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      const problem = dictationPermissionProblem(permission);
      if (problem) {
        onMessage(DICTATION_MESSAGES[problem]);
        return;
      }
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        onMessage(DICTATION_MESSAGES.unavailable);
        return;
      }
      baseRef.current = draft;
      ExpoSpeechRecognitionModule.start({
        lang: RECOGNITION_LANG,
        interimResults: true,
        continuous: false,
      });
    } catch {
      onMessage(DICTATION_MESSAGES.generic);
    }
  }

  return (
    <Pressable
      onPress={() => void toggle()}
      disabled={disabled}
      style={[styles.button, listening && styles.listening, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityState={{ selected: listening, disabled: Boolean(disabled) }}
      accessibilityLabel={listening ? 'Dejar de dictar' : 'Dictarle a Tero'}
    >
      <Icon name={listening ? 'stop' : 'mic'} size={20} color={listening ? colors.dangerFg : colors.fg} />
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listening: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerSurface },
  disabled: { opacity: 0.4 },
}));
