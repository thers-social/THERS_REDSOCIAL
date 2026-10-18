import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import { createQuote, fetchMyQuotes, fetchQuoteItems } from './api';
import { QUOTE_STATUS_LABEL, UNIT_LABEL } from './businessTime';
import { shareQuotePdf } from './quotePdf';
import type { Quote, QuoteItem } from './types';

function message(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <View style={styles.card}>
      <Text style={styles.total}>Total {quote.total.amount} {quote.total.currency}</Text>
      <Text style={styles.muted}>Estado: {QUOTE_STATUS_LABEL[quote.status]}</Text>
      {quote.lines.map((line, index) => (
        <View key={`${line.name}-${index}`} style={styles.line}>
          <Text style={styles.lineName} numberOfLines={2}>
            {line.quantity} × {line.name}
          </Text>
          <Text style={styles.lineAmount}>{line.line_total.amount}</Text>
        </View>
      ))}
      {quote.note ? <Text style={styles.muted}>Nota: {quote.note}</Text> : null}
      <Text style={styles.muted}>
        Válida hasta el {new Date(quote.valid_until).toLocaleDateString('es')}. Es informativa: no
        reserva cupo ni genera un cobro.
      </Text>
      <Pressable
        onPress={() =>
          shareQuotePdf(quote.id).catch((e: unknown) =>
            Alert.alert('No pudimos abrir el PDF', message(e, 'Intentá de nuevo.')),
          )
        }
        accessibilityRole="button"
      >
        <Text style={styles.link}>Descargar PDF</Text>
      </Pressable>
    </View>
  );
}

/**
 * Cotizador en la ficha (ADR-040 fase 10). La app manda solo artículo y cantidad: el TOTAL
 * lo calcula el servidor con los precios vigentes, así que aquí no se suma nada.
 */
export function PlaceQuote({ placeId }: { placeId: string }) {
  const [items, setItems] = useState<QuoteItem[] | null>(null);
  const [mine, setMine] = useState<Quote[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [catalog, all] = await Promise.all([fetchQuoteItems(placeId, signal), fetchMyQuotes(signal)]);
        setItems(catalog);
        setMine(all.filter((q) => q.place.id === placeId));
        setLoadError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setLoadError(message(e, 'No pudimos cargar el cotizador.'));
        setItems((current) => current ?? []);
      }
    },
    [placeId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const lines = Object.entries(qty)
    .filter(([, quantity]) => quantity > 0)
    .map(([item_id, quantity]) => ({ item_id, quantity }));

  function change(id: string, delta: number) {
    setQty((current) => {
      const next = Math.max(0, Math.min(10_000, (current[id] ?? 0) + delta));
      return { ...current, [id]: next };
    });
  }

  async function submit() {
    if (busy || lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await createQuote(placeId, { lines, ...(note.trim() ? { note: note.trim() } : {}) });
      setOpen(false);
      setQty({});
      setNote('');
      await load();
    } catch (e) {
      setError(message(e, 'No pudimos pedir la cotización. Intentá de nuevo.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        Cotizador
      </Text>
      {loadError ? <Banner tone="error">{loadError}</Banner> : null}

      {items && items.length > 0 ? (
        open ? (
          <View style={styles.form}>
            {items.map((item) => (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemText}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.muted}>
                    {item.unit_price.amount} {item.unit_price.currency} {UNIT_LABEL[item.unit]}
                  </Text>
                  {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
                </View>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => change(item.id, -1)}
                    style={styles.stepButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar ${item.name}`}
                  >
                    <Text style={styles.stepText}>−</Text>
                  </Pressable>
                  <Text style={styles.stepValue}>{qty[item.id] ?? 0}</Text>
                  <Pressable
                    onPress={() => change(item.id, 1)}
                    style={styles.stepButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Agregar ${item.name}`}
                  >
                    <Text style={styles.stepText}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              maxLength={500}
              multiline
              textAlignVertical="top"
              placeholder="Nota (opcional)"
              placeholderTextColor={colors.fgDisabled}
              accessibilityLabel="Nota de la cotización"
            />
            {error ? <Banner tone="error">{error}</Banner> : null}
            <Text style={styles.muted}>El total lo calcula el lugar al pedir la cotización.</Text>
            <Button
              label="Pedir cotización"
              onPress={() => void submit()}
              loading={busy}
              disabled={lines.length === 0}
            />
            <Button label="Cancelar" variant="ghost" onPress={() => setOpen(false)} disabled={busy} />
          </View>
        ) : (
          <Button label="Pedir una cotización" variant="secondary" onPress={() => setOpen(true)} />
        )
      ) : null}

      {items !== null && items.length === 0 && !loadError ? (
        <Text style={styles.muted}>
          Este lugar todavía no publicó su lista de precios, así que aún no se puede pedir una cotización. Cuando
          la cargue, aparecerá aquí el botón para pedirla.
        </Text>
      ) : null}

      {mine.map((quote) => (
        <QuoteCard key={quote.id} quote={quote} />
      ))}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginTop: space[6], gap: space[3] },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  link: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  form: {
    gap: space[3],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  itemText: { flex: 1, gap: 2 },
  itemName: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  stepText: { fontSize: fontSize.headlineSm, color: colors.fg },
  stepValue: { minWidth: 24, textAlign: 'center', fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  input: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  card: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  total: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  lineName: { flex: 1, fontSize: fontSize.bodyMd, color: colors.fg },
  lineAmount: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
}));
