import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import { deleteReviewReply, fetchReviews, replyToReview } from '../api';
import type { PlaceReview } from '../types';
import { Card, errorMessage, Field, manageStyles as ms, Section } from './ui';

function ReplyBox({
  placeId,
  review,
  onChanged,
}: {
  placeId: string;
  review: PlaceReview;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await replyToReview(placeId, review.id, text.trim());
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(errorMessage(e, 'No pudimos publicar la respuesta.'));
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove() {
    Alert.alert('¿Quitar la respuesta?', 'Dejará de verse en la reseña.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: () => {
          deleteReviewReply(placeId, review.id)
            .then(onChanged)
            .catch((e: unknown) => Alert.alert('No pudimos quitarla', errorMessage(e, 'Intentá de nuevo.')));
        },
      },
    ]);
  }

  if (editing) {
    return (
      <View style={{ gap: 8 }}>
        <Field label="Tu respuesta pública" value={text} onChangeText={setText} maxLength={500} multiline />
        {error ? <Banner tone="error">{error}</Banner> : null}
        <View style={ms.row}>
          <Button label="Publicar" onPress={() => void save()} loading={busy} disabled={!text.trim()} style={ms.flex} />
          <Button label="Cancelar" variant="ghost" onPress={() => setEditing(false)} disabled={busy} style={ms.flex} />
        </View>
      </View>
    );
  }

  return review.reply ? (
    <View style={{ gap: 4 }}>
      <Text style={ms.link}>Tu respuesta</Text>
      <Text style={ms.muted}>{review.reply.body}</Text>
      <View style={ms.row}>
        <Button label="Editar" variant="secondary" onPress={() => setEditing(true)} style={ms.flex} />
        <Button label="Quitar" variant="danger" onPress={confirmRemove} style={ms.flex} />
      </View>
    </View>
  ) : (
    <Button label="Responder" variant="secondary" onPress={() => setEditing(true)} />
  );
}

/** Reseñas del lugar con la respuesta pública del negocio (ADR-040 fase 7). Texto plano. */
export function ManageReviews({ placeId, onChanged }: { placeId: string; onChanged: () => void }) {
  const [reviews, setReviews] = useState<PlaceReview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await fetchReviews(placeId, signal);
        setReviews(data.reviews);
        setLoadError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setLoadError(errorMessage(e, 'No pudimos cargar las reseñas.'));
        setReviews((current) => current ?? []);
      }
    },
    [placeId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <Section title="Reseñas">
      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {reviews && reviews.length === 0 && !loadError ? (
        <Text style={ms.muted}>Todavía no hay reseñas.</Text>
      ) : null}
      {reviews?.map((review) => (
        <Card key={review.id}>
          <Text style={ms.strong}>
            {review.author.name || review.author.username} · {review.rating}/5
          </Text>
          {review.body ? <Text style={ms.muted}>{review.body}</Text> : null}
          <ReplyBox
            placeId={placeId}
            review={review}
            onChanged={() => {
              void load();
              onChanged();
            }}
          />
        </Card>
      ))}
    </Section>
  );
}
