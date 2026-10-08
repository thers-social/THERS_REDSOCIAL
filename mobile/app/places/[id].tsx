import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { savePlace, unsavePlace } from '@features/places/api';
import { ReportPlaceModal } from '@features/places/ReportPlaceModal';
import { usePlaceDetail } from '@features/places/usePlaceDetail';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Button } from '@shared/ui/Button';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

// El servidor ya solo guarda http(s), pero un enlace que se abre desde la app se valida
// también aquí: nunca confiar en el dato.
function safeWebsite(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** Ficha de un lugar: solo muestra lo que el backend respalda (nada de reseñas ni horarios). */
export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = usePlaceDetail(id);
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);

  const place = detail.place;

  async function toggleSaved() {
    if (!place || saving) return;
    const next = !place.is_saved;
    setSaving(true);
    detail.setSaved(next); // optimista: se revierte si falla
    try {
      await (next ? savePlace(place.id) : unsavePlace(place.id));
    } catch (error) {
      detail.setSaved(!next);
      Alert.alert(
        'No pudimos guardar el cambio',
        error instanceof ApiError ? error.message : 'Intentá de nuevo.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (detail.status === 'loading') {
    return (
      <Screen title="Lugar" back>
        <StateMessage kind="loading" message="Cargando el lugar…" />
      </Screen>
    );
  }

  if (detail.status === 'not_found' || detail.status === 'error' || !place) {
    return (
      <Screen title="Lugar" back>
        {detail.status === 'error' ? (
          <StateMessage
            kind="error"
            title="No pudimos cargar este lugar"
            message={detail.error ?? undefined}
            actionLabel="Reintentar"
            onAction={detail.reload}
          />
        ) : (
          <StateMessage
            kind="empty"
            title="Lugar no disponible"
            message="Este lugar no existe o ya no está disponible."
          />
        )}
      </Screen>
    );
  }

  const website = safeWebsite(place.website);
  const area = [place.municipality, place.department].filter(Boolean).join(', ');

  return (
    <Screen title="Lugar" back>
      <View style={styles.header}>
        <Text style={styles.name} accessibilityRole="header">
          {place.name}
        </Text>
        <Text style={styles.category}>{place.category.name}</Text>
        {place.verification_status === 'verified' ? (
          <Text style={styles.verified}>
            Verificado
            {place.last_verified_at
              ? ` · el ${new Date(place.last_verified_at).toLocaleDateString()}`
              : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button
          label={place.is_saved ? 'Guardado' : 'Guardar'}
          variant={place.is_saved ? 'primary' : 'secondary'}
          onPress={toggleSaved}
          loading={saving}
          style={styles.flex}
        />
        <Button label="Reportar" variant="secondary" onPress={() => setReporting(true)} style={styles.flex} />
      </View>

      {place.description ? <Text style={styles.description}>{place.description}</Text> : null}

      <View style={styles.rows}>
        {place.address ? <Row icon="pin" text={place.address} /> : null}
        {area ? <Row icon="globe" text={area} /> : null}
        {place.phone ? (
          <Row
            icon="phone"
            text={place.phone}
            onPress={() => void Linking.openURL(`tel:${place.phone?.replace(/[^0-9+]/g, '')}`)}
          />
        ) : null}
        {website ? (
          <Row
            icon="link"
            text={website.replace(/^https?:\/\//i, '')}
            onPress={() => void Linking.openURL(website)}
          />
        ) : null}
      </View>

      <ReportPlaceModal
        visible={reporting}
        placeId={place.id}
        placeName={place.name}
        onClose={() => setReporting(false)}
      />
    </Screen>
  );
}

function Row({
  icon,
  text,
  onPress,
}: {
  icon: 'pin' | 'globe' | 'link' | 'phone';
  text: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.row}>
      <Icon name={icon} size={18} color={colors.fgMuted} />
      <Text style={[styles.rowText, onPress && styles.rowLink]}>{text}</Text>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="link">
      {content}
    </Pressable>
  ) : (
    content
  );
}

const styles = themedStyles(() => ({
  header: { gap: space[1], marginBottom: space[3] },
  name: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg },
  category: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  verified: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.successFg },
  actions: { flexDirection: 'row', gap: space[2], marginBottom: space[4] },
  flex: { flex: 1 },
  description: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 22, marginBottom: space[4] },
  rows: { gap: space[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.input,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.fg },
  rowLink: { color: colors.brandText },
}));
