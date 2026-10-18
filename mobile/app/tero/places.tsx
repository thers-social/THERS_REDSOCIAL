import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { fetchCategories, fetchTopPlaces } from '@features/places/api';
import { PlaceCard } from '@features/places/PlaceCard';
import type { PlaceCategory, PlaceSummary } from '@features/places/types';
import { messageOf } from '@features/posts/PostsContext';
import { TeroAvatar } from '@features/tero/components/TeroAvatar';
import { TeroGate } from '@features/tero/components/TeroGate';
import { useTero } from '@features/tero/context/TeroContext';
import { useReducedMotion } from '@features/tero/lib/useReducedMotion';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * «Places» de Tero: lugares recomendados por categoría (los mejor valorados de THERS Places) y atajos para
 * pedirle a Tero que busque, cuente detalles o prepare una reserva en el chat. No usa tu ubicación: para
 * lugares cercanos está el mapa de Places.
 */
export default function TeroPlaces() {
  return (
    <TeroGate>
      <TeroPlacesContent />
    </TeroGate>
  );
}

const PROMPTS = [
  'Recomiéndame un lugar para comer',
  'Busca un café tranquilo',
  'Quiero reservar una mesa',
];

function TeroPlacesContent() {
  const router = useRouter();
  const { preferences } = useTero();
  const reducedMotion = useReducedMotion();
  const [categories, setCategories] = useState<PlaceCategory[]>([]);
  const [category, setCategory] = useState('');
  const [places, setPlaces] = useState<PlaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal).then(setCategories).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setPlaces(null);
    setError(null);
    fetchTopPlaces(category || undefined, controller.signal)
      .then(setPlaces)
      .catch((e) => {
        if (!controller.signal.aborted) setError(messageOf(e));
      });
    return () => controller.abort();
  }, [category]);

  const top = places ?? [];

  function ask(prompt: string) {
    router.push({ pathname: '/tero/chat', params: { prompt } });
  }

  return (
    <Screen title="Places" back>
      <View style={styles.hero}>
        <TeroAvatar size={72} mood="happy" animated={preferences.animations && !reducedMotion} />
        <Text style={styles.intro}>Te enseño los lugares mejor valorados. ¿Algo en particular?</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {[{ slug: '', name: 'Todos' }, ...categories].map((c) => (
          <Pressable
            key={c.slug || 'all'}
            onPress={() => setCategory(c.slug)}
            style={[styles.chip, category === c.slug && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: category === c.slug }}
          >
            <Text style={[styles.chipText, category === c.slug && styles.chipTextOn]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {places === null && !error ? <StateMessage kind="loading" /> : null}
      {error ? <StateMessage kind="error" message={error} /> : null}
      {places && top.length === 0 ? (
        <StateMessage kind="empty" title="No encontré lugares en esta categoría" />
      ) : null}
      {top.map((place) => (
        <PlaceCard
          key={place.id}
          place={place}
          onPress={(id) => router.push({ pathname: '/places/[id]', params: { id } })}
        />
      ))}

      <Text style={styles.sectionTitle}>Pídeselo a Tero</Text>
      <View style={styles.prompts}>
        {PROMPTS.map((prompt) => (
          <Button key={prompt} label={prompt} variant="secondary" onPress={() => ask(prompt)} />
        ))}
      </View>
      <Button label="Ver el mapa de Places" variant="ghost" onPress={() => router.push('/places')} />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  hero: { alignItems: 'center', paddingVertical: space[4], gap: space[2] },
  intro: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, textAlign: 'center' },
  chips: { gap: space[2], paddingBottom: space[3] },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: fontSize.labelLg, color: colors.fgSecondary, fontWeight: '600' },
  chipTextOn: { color: colors.onBrand },
  sectionTitle: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginTop: space[6], marginBottom: space[2] },
  prompts: { gap: space[2], marginBottom: space[2] },
}));
