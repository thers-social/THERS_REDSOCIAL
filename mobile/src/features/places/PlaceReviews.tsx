import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, Text, TextInput, View } from 'react-native';

import { ApiError } from '@shared/lib/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Icon } from '@shared/ui/Icon';
import { ProfileLink } from '@features/profile/ProfileLink';
import { useOpenProfile } from '@features/profile/useOpenProfile';
import { ReportModal } from '@features/safety/ReportModal';

import type { ReviewImage, ReviewReply } from './types';
import { usePlaceReviews } from './usePlaceReviews';

const MAX_BODY = 1000;
const STARS = [1, 2, 3, 4, 5];

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <View style={styles.stars} accessible accessibilityLabel={`${value} de 5 estrellas`}>
      {STARS.map((star) => (
        <Icon
          key={star}
          name="star"
          size={size}
          filled={star <= Math.round(value)}
          color={star <= Math.round(value) ? colors.brandText : colors.fgDisabled}
        />
      ))}
    </View>
  );
}

function Photos({ images }: { images: ReviewImage[] }) {
  if (images.length === 0) return null;
  return (
    <View style={styles.photos}>
      {images.map((image, index) => (
        <Image
          key={image.id}
          source={{ uri: image.url }}
          style={styles.photo}
          accessibilityIgnoresInvertColors
          accessibilityLabel={`Foto ${index + 1} de la reseña`}
        />
      ))}
    </View>
  );
}

/** Respuesta pública del negocio (ADR-040 fase 7); texto plano. */
export function Reply({ reply }: { reply: ReviewReply | null | undefined }) {
  if (!reply) return null;
  return (
    <View style={styles.reply}>
      <Text style={styles.replyLabel}>Respuesta del negocio</Text>
      <Text style={styles.body}>{reply.body}</Text>
    </View>
  );
}

type FormProps = {
  initialRating: number;
  initialBody: string;
  editing: boolean;
  onSave: (values: { rating: number; body: string | null }) => Promise<void>;
  onDelete: () => void;
  onCancel: (() => void) | null;
};

function ReviewForm({ initialRating, initialBody, editing, onSave, onDelete, onCancel }: FormProps) {
  const [rating, setRating] = useState(initialRating);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!rating || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ rating, body: body.trim() || null });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos guardar tu reseña. Intentá de nuevo.');
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Tu calificación</Text>
      <View style={styles.starPicker}>
        {STARS.map((star) => (
          <Pressable
            key={star}
            onPress={() => setRating(star)}
            hitSlop={4}
            style={styles.starButton}
            accessibilityRole="button"
            accessibilityLabel={`${star} de 5 estrellas`}
            accessibilityState={{ selected: rating === star }}
          >
            <Icon
              name="star"
              size={30}
              filled={star <= rating}
              color={star <= rating ? colors.brandText : colors.fgDisabled}
            />
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={body}
        onChangeText={setBody}
        placeholder="Contanos tu experiencia (opcional)"
        placeholderTextColor={colors.fgDisabled}
        multiline
        maxLength={MAX_BODY}
        textAlignVertical="top"
        accessibilityLabel="Tu opinión"
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <View style={styles.buttons}>
        <Button
          label={editing ? 'Guardar cambios' : 'Publicar reseña'}
          onPress={() => void submit()}
          loading={busy}
          disabled={!rating}
          style={styles.flex}
        />
        {editing ? (
          <Button label="Borrar" variant="danger" onPress={onDelete} disabled={busy} style={styles.flex} />
        ) : null}
      </View>
      {onCancel ? <Button label="Cancelar" variant="ghost" onPress={onCancel} disabled={busy} /> : null}
    </View>
  );
}

/**
 * Reseñas de la ficha (ADR-040 fase 4a). La app solo se usa con sesión, así que siempre se
 * puede reseñar. El texto de las reseñas se pinta SIEMPRE como `<Text>` (nunca como HTML).
 */
export function PlaceReviews({ placeId }: { placeId: string }) {
  const data = usePlaceReviews(placeId);
  const openProfile = useOpenProfile();
  const [editing, setEditing] = useState(false);
  const [reportingId, setReportingId] = useState<string | null>(null);

  // Si la lista se recarga con la reseña propia nueva o cambiada, se cierra el formulario.
  useEffect(() => {
    setEditing(false);
  }, [data.mine?.id, data.mine?.updated_at]);

  function confirmDelete() {
    Alert.alert('¿Borrar tu reseña?', 'Esta acción no se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => {
          data.remove().catch((e: unknown) =>
            Alert.alert(
              'No pudimos borrarla',
              e instanceof ApiError ? e.message : 'Intentá de nuevo.',
            ),
          );
        },
      },
    ]);
  }

  const { summary } = data;
  const others = data.reviews.filter((review) => !review.is_mine);

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        Reseñas
      </Text>

      {summary.count > 0 && summary.average !== null ? (
        <View style={styles.summary}>
          <Stars value={summary.average} />
          <Text style={styles.average}>{summary.average.toFixed(1)}</Text>
          <Text style={styles.count}>({summary.count})</Text>
        </View>
      ) : data.status === 'ready' ? (
        <Text style={styles.muted}>Aún no hay reseñas. Sé la primera persona en opinar.</Text>
      ) : null}

      {data.status === 'error' ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{data.error}</Text>
          <Button label="Reintentar" variant="secondary" onPress={data.reload} />
        </View>
      ) : null}

      {data.status !== 'loading' || data.reviews.length > 0 ? (
        data.mine && !editing ? (
          <View style={styles.mine}>
            <View style={styles.rowBetween}>
              <Text style={styles.mineLabel}>Tu reseña</Text>
              <Pressable onPress={() => setEditing(true)} accessibilityRole="button">
                <Text style={styles.link}>Editar</Text>
              </Pressable>
            </View>
            <Stars value={data.mine.rating} />
            {data.mine.body ? <Text style={styles.body}>{data.mine.body}</Text> : null}
            <Photos images={data.mine.images} />
            <Reply reply={data.mine.reply} />
            {data.mine.hidden ? (
              <Text style={styles.hidden}>La moderación ocultó tu reseña; solo vos la ves.</Text>
            ) : null}
          </View>
        ) : data.status === 'ready' ? (
          <ReviewForm
            key={data.mine?.updated_at ?? 'new'}
            initialRating={data.mine?.rating ?? 0}
            initialBody={data.mine?.body ?? ''}
            editing={!!data.mine}
            onSave={data.save}
            onDelete={confirmDelete}
            onCancel={data.mine ? () => setEditing(false) : null}
          />
        ) : null
      ) : null}

      {others.map((review) => (
        <View key={review.id} style={styles.review}>
          <ProfileLink
            userId={review.author.id}
            name={review.author.name || review.author.username}
            style={{ flex: 0, alignItems: 'flex-start' }}
          >
            <Avatar name={review.author.name || review.author.username} uri={review.author.avatar_url} size={32} />
          </ProfileLink>
          <View style={styles.reviewBody}>
            <Text style={styles.author} onPress={() => openProfile(review.author.id)}>
              {review.author.name || review.author.username}
              <Text style={styles.date}> · {new Date(review.created_at).toLocaleDateString()}</Text>
            </Text>
            <Stars value={review.rating} size={14} />
            {review.body ? <Text style={styles.body}>{review.body}</Text> : null}
            <Photos images={review.images} />
            <Reply reply={review.reply} />
            <Pressable onPress={() => setReportingId(review.id)} accessibilityRole="button">
              <Text style={styles.reportLink}>Reportar</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <ReportModal
        visible={reportingId !== null}
        targetType="review"
        targetId={reportingId ?? ''}
        targetLabel="esta reseña"
        onClose={() => setReportingId(null)}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginTop: space[6], gap: space[3] },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stars: { flexDirection: 'row' },
  average: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  count: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  errorBox: { gap: space[2] },
  errorText: { fontSize: fontSize.bodyMd, color: colors.dangerFg },
  form: {
    gap: space[3],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fgMuted },
  starPicker: { flexDirection: 'row', gap: space[1] },
  starButton: { padding: space[1] },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  buttons: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  mine: {
    gap: space[1],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mineLabel: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  link: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  reportLink: { fontSize: fontSize.labelLg, color: colors.fgMuted, marginTop: space[1] },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[1] },
  photo: { width: 80, height: 80, borderRadius: radius.input, backgroundColor: colors.surface },
  hidden: { fontSize: fontSize.labelLg, color: colors.fgMuted, marginTop: space[1] },
  reply: {
    gap: 2,
    marginTop: space[2],
    paddingLeft: space[3],
    borderLeftWidth: 2,
    borderLeftColor: colors.brand,
  },
  replyLabel: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  review: { flexDirection: 'row', gap: space[3] },
  reviewBody: { flex: 1, gap: 2 },
  author: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg },
  date: { fontWeight: '400', color: colors.fgMuted },
  body: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 21 },
}));
