import { Link, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { TeroAvatar } from '@features/tero/components/TeroAvatar';
import { TeroGate } from '@features/tero/components/TeroGate';
import { TeroPreviewNotice } from '@features/tero/components/TeroPreviewNotice';
import { useTero } from '@features/tero/context/TeroContext';
import { checkMessage, MAX_TERO_MESSAGE_LENGTH } from '@features/tero/lib/teroChat';
import { useReducedMotion } from '@features/tero/lib/useReducedMotion';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { comingSoon } from '@shared/lib/comingSoon';
import { Icon } from '@shared/ui/Icon';
import type { IconName } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';

type Shortcut = { label: string; description: string; icon: IconName; href?: Href; soon?: string };

/**
 * «Novedades» reutiliza Avisos (datos reales). Places y Personas aún no existen
 * en la app móvil: avisan «Próximamente» en vez de mostrar datos inventados.
 */
const SHORTCUTS: Shortcut[] = [
  { label: 'Resumen', description: 'Tu semana', icon: 'activity', href: '/tero/summary' },
  { label: 'Novedades', description: 'Tus avisos', icon: 'bell', href: '/notifications' },
  { label: 'Places', description: 'Lugares cerca', icon: 'globe', soon: 'Places con Tero' },
  { label: 'Personas', description: 'A quién seguir', icon: 'group', soon: 'Las sugerencias de Tero' },
];

/** Inicio de Tero: saludo, una pregunta rápida y accesos. */
export default function TeroHome() {
  return (
    <TeroGate>
      <TeroHomeContent />
    </TeroGate>
  );
}

function TeroHomeContent() {
  const { user } = useAuth();
  const { preferences } = useTero();
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const firstName = user?.name.split(' ')[0] ?? '';

  function ask() {
    const check = checkMessage(draft);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    setDraft('');
    router.push({ pathname: '/tero/chat', params: { prompt: check.text } });
  }

  return (
    <Screen
      title="Tero"
      back
      headerRight={
        <Link href="/tero/settings" accessibilityRole="link" accessibilityLabel="Ajustes de Tero" style={styles.headerLink}>
          <Icon name="settings" color={colors.fg} />
        </Link>
      }
    >
      <View style={styles.hero}>
        <TeroAvatar size={96} mood="happy" animated={preferences.animations && !reducedMotion} />
        <Text style={styles.greeting} accessibilityRole="header">
          {firstName ? `Hola, ${firstName}` : 'Hola'}
        </Text>
        <Text style={styles.subtitle}>Soy Tero. ¿Qué quieres saber hoy?</Text>
      </View>

      <TeroPreviewNotice message="Tero todavía no está conectado a la IA. Sus respuestas y el resumen son de ejemplo." />

      <View style={styles.askRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (error) setError(null);
          }}
          placeholder="Pregúntale algo a Tero…"
          placeholderTextColor={colors.fgDisabled}
          accessibilityLabel="Pregunta para Tero"
          maxLength={MAX_TERO_MESSAGE_LENGTH}
          returnKeyType="send"
          onSubmitEditing={ask}
        />
        <Pressable
          onPress={ask}
          style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
          accessibilityRole="button"
          accessibilityLabel="Preguntar"
        >
          <Icon name="share" color={colors.onBrand} size={20} />
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={styles.grid}>
        {SHORTCUTS.map((item) => (
          <Pressable
            key={item.label}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => (item.href ? router.push(item.href) : comingSoon(item.soon))}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityHint={item.description}
          >
            <Icon name={item.icon} color={colors.brandText} />
            <Text style={styles.cardLabel}>{item.label}</Text>
            <Text style={styles.cardDescription}>{item.description}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  headerLink: { padding: space[2] },
  hero: { alignItems: 'center', paddingVertical: space[4] },
  greeting: { fontSize: fontSize.headlineMd, fontWeight: '700', color: colors.fg, marginTop: space[3] },
  subtitle: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginTop: space[1] },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space[4],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: { backgroundColor: colors.brandHover },
  error: { fontSize: fontSize.bodySm, color: colors.dangerFg, marginTop: space[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[6] },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 104,
    padding: space[4],
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cardPressed: { backgroundColor: colors.brandSoft },
  cardLabel: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginTop: space[3] },
  cardDescription: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: 2 },
}));
