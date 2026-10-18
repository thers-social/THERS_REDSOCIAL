import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { teroColors } from '../design/teroColors';
import { useTero } from '../context/TeroContext';
import { VOICE_SAMPLES } from '../lib/teroSpeech';
import type { SpeechFamily, SpeechVoice } from '../lib/teroSpeech';
import { loadVoices, useTeroSpeech } from '../lib/useTeroSpeech';

const MAX_VOICES = 10;

const TEXTS: Record<SpeechFamily, { title: string; auto: string; autoDetail: string; none: string }> = {
  es: {
    title: 'Voz de Tero en español',
    auto: 'Automática (recomendada)',
    autoDetail: 'Tero elige la mejor voz en español que tenga tu teléfono.',
    none: 'Tu teléfono no tiene voces en español. Instálalas en Ajustes de Android, «Salida de texto a voz».',
  },
  en: {
    title: 'Voz de Tero en inglés (English)',
    auto: 'Automática (recomendada)',
    autoDetail: 'Tero elige la mejor voz en inglés que tenga tu teléfono.',
    none: 'Tu teléfono no tiene voces en inglés. Instálalas en Ajustes de Android, «Salida de texto a voz».',
  },
};

/**
 * Selector de la voz de Tero (ADR-045), una sección por idioma: Tero lee en inglés cuando contesta en
 * inglés. Lista las voces del teléfono, de la mejor a la peor; al tocar una, se elige y suena una frase
 * de prueba en ese idioma. «Automática» deja que Tero escoja la mejor.
 */
export function TeroVoicePicker() {
  return (
    <View>
      <Text style={styles.description}>
        Toca una voz para elegirla y oírla. Las marcadas «mejor calidad» suenan menos robóticas.
      </Text>
      <VoiceSection family="es" />
      <VoiceSection family="en" />
    </View>
  );
}

function VoiceSection({ family }: { family: SpeechFamily }) {
  const { preferences, update } = useTero();
  const { speak, stop } = useTeroSpeech({ es: preferences.voiceId, en: preferences.voiceIdEn });
  const [voices, setVoices] = useState<SpeechVoice[] | null>(null);
  const selected = family === 'en' ? preferences.voiceIdEn : preferences.voiceId;
  const texts = TEXTS[family];

  useEffect(() => {
    let alive = true;
    void loadVoices(family).then((list) => alive && setVoices(list.slice(0, MAX_VOICES)));
    return () => {
      alive = false;
      stop();
    };
  }, [family, stop]);

  function choose(voiceId: string | null) {
    update(family === 'en' ? { voiceIdEn: voiceId } : { voiceId });
    void speak(VOICE_SAMPLES[family], voiceId, family);
  }

  return (
    <View style={styles.box}>
      <Text style={styles.label}>{texts.title}</Text>
      <VoiceOption
        label={texts.auto}
        detail={texts.autoDetail}
        selected={selected === null}
        onPress={() => choose(null)}
      />
      {voices === null ? <Text style={styles.description}>Buscando voces…</Text> : null}
      {voices?.length === 0 ? <Text style={styles.description}>{texts.none}</Text> : null}
      {voices?.map((voice, index) => (
        <VoiceOption
          key={voice.id}
          label={`Voz ${index + 1}${voice.premium ? ' · mejor calidad' : ''}`}
          detail={`${voice.lang} · ${voice.name}`}
          selected={selected === voice.id}
          onPress={() => choose(voice.id)}
        />
      ))}
    </View>
  );
}

function VoiceOption({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint="Elige esta voz y reproduce una frase de prueba"
    >
      <Text style={styles.optionLabel}>{label}</Text>
      <Text style={styles.optionDetail}>{detail}</Text>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  box: { gap: space[2], paddingVertical: space[3] },
  label: { fontSize: fontSize.bodyMd, fontWeight: '600', color: colors.fg },
  description: { fontSize: fontSize.bodySm, color: colors.fgMuted, lineHeight: 18 },
  option: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.card,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  optionSelected: { borderColor: teroColors.blue, borderWidth: 2 },
  optionLabel: { fontSize: fontSize.bodyMd, color: colors.fg },
  optionDetail: { fontSize: fontSize.labelMd, color: colors.fgMuted },
}));
