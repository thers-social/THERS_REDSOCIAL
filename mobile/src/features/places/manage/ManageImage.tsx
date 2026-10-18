import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { removePlaceImage, uploadPlaceImage } from '@features/places/api';
import type { PlaceDetail } from '@features/places/types';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { MediaSelectionError, pickImages } from '@shared/media/pickMedia';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import { errorMessage, Section } from './ui';

type Props = {
  place: PlaceDetail;
  /** Recibe el lugar ya actualizado, para que la pantalla refresque lo que muestra. */
  onChanged: (place: PlaceDetail) => void;
};

/**
 * Imagen que identifica al lugar (ADR-046): un logo o una foto. La ve y la cambia solo quien gestiona el
 * lugar; el servidor lo vuelve a comprobar. Se muestra en el mapa, las listas y la ficha.
 */
export function ManageImage({ place, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<PlaceDetail | null>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      if (updated) onChanged(updated);
    } catch (e) {
      setError(e instanceof MediaSelectionError ? e.message : errorMessage(e, 'No pudimos guardar la imagen.'));
    } finally {
      setBusy(false);
    }
  }

  const choose = () =>
    run(async () => {
      const [picked] = await pickImages(1);
      return picked ? uploadPlaceImage(place.id, picked) : null;
    });

  return (
    <Section title="Imagen del lugar">
      {error ? <Banner tone="error">{error}</Banner> : null}
      <View style={styles.row}>
        {place.cover_image_url ? (
          <Image source={{ uri: place.cover_image_url }} style={styles.thumb} accessibilityLabel="Imagen actual del lugar" />
        ) : (
          <View style={[styles.thumb, styles.empty]}>
            <Text style={styles.emptyText}>Sin imagen</Text>
          </View>
        )}
        <View style={styles.actions}>
          <Button
            label={place.cover_image_url ? 'Cambiar imagen' : 'Subir imagen'}
            variant="secondary"
            onPress={() => void choose()}
            loading={busy}
          />
          {place.cover_image_url ? (
            <Button
              label="Quitar imagen"
              variant="ghost"
              onPress={() => void run(() => removePlaceImage(place.id))}
              disabled={busy}
            />
          ) : null}
        </View>
      </View>
      <Text style={styles.hint}>
        Un logo o una foto que identifique tu negocio. Se muestra en el mapa, las listas y la ficha.
      </Text>
    </Section>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: { width: 88, height: 88, borderRadius: radius.card, backgroundColor: colors.bgSubtle },
  empty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong },
  emptyText: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  actions: { flex: 1, gap: space[1] },
  hint: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginTop: space[2] },
}));
