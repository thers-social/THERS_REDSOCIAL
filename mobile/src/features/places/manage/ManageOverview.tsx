import { useState } from 'react';
import { Text, View } from 'react-native';

import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import { updateManagedPlace } from '../api';
import type { ManageStats, PlaceDetail } from '../types';
import { Card, errorMessage, Field, Section } from './ui';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Cifras del lugar y datos de contacto editables (ADR-040 fase 7). Un gestor solo cambia
 * descripción, dirección, teléfono y sitio web; nombre, categoría y ubicación son de moderación.
 */
export function ManageOverview({
  place,
  stats,
  onSaved,
}: {
  place: PlaceDetail;
  stats: ManageStats;
  onSaved: (place: PlaceDetail) => void;
}) {
  const [description, setDescription] = useState(place.description ?? '');
  const [address, setAddress] = useState(place.address ?? '');
  const [phone, setPhone] = useState(place.phone ?? '');
  const [website, setWebsite] = useState(place.website ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateManagedPlace(place.id, {
        description: description.trim() || null,
        address: address.trim() || null,
        phone: phone.trim() || null,
        website: website.trim() || null,
      });
      onSaved(updated);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e, 'No pudimos guardar los cambios. Intentá de nuevo.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="Resumen">
        <View style={styles.stats}>
          <Stat label="Guardados" value={String(stats.saves)} />
          <Stat label="Reseñas" value={String(stats.reviews)} />
          <Stat
            label="Calificación"
            value={stats.rating_average === null ? '—' : stats.rating_average.toFixed(1)}
          />
          <Stat label="Sin responder" value={String(stats.reviews_without_reply)} />
          <Stat label="Planes próximos" value={String(stats.upcoming_plans)} />
        </View>
        <Text style={styles.note}>Solo cifras agregadas: nunca quién guardó el lugar ni quién va a un plan.</Text>
      </Section>

      <Section title="Datos de contacto">
        <Card>
          <Field
            label="Descripción"
            value={description}
            onChangeText={setDescription}
            maxLength={2000}
            multiline
          />
          <Field label="Dirección" value={address} onChangeText={setAddress} maxLength={255} />
          <Field
            label="Teléfono"
            value={phone}
            onChangeText={setPhone}
            maxLength={40}
            keyboardType="phone-pad"
          />
          <Field
            label="Sitio web"
            value={website}
            onChangeText={setWebsite}
            maxLength={255}
            keyboardType="url"
            autoCapitalize="none"
            placeholder="https://"
          />
          {error ? <Banner tone="error">{error}</Banner> : null}
          {saved ? <Banner tone="success">Cambios guardados.</Banner> : null}
          <Button label="Guardar cambios" onPress={() => void save()} loading={busy} />
        </Card>
      </Section>
    </>
  );
}

const styles = themedStyles(() => ({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  stat: {
    minWidth: '30%',
    flexGrow: 1,
    padding: space[3],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statValue: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg },
  statLabel: { fontSize: fontSize.labelLg, color: colors.fgMuted, textAlign: 'center' },
  note: { fontSize: fontSize.labelLg, color: colors.fgMuted },
}));
