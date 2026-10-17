import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';

import { colors } from '@shared/design/tokens';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import {
  createQuoteItem,
  decideQuote,
  deleteQuoteItem,
  fetchManagedQuoteItems,
  fetchManagedQuotes,
  setQuoteItemActive,
} from '../api';
import { shareQuotePdf } from '../quotePdf';
import { parsePriceCents, QUOTE_STATUS_LABEL, UNIT_LABEL } from '../businessTime';
import type { Quote, QuoteItem, QuoteUnit } from '../types';
import { Card, errorMessage, Field, manageStyles as ms, Section } from './ui';

const UNITS: QuoteUnit[] = ['person', 'unit', 'hour'];

/**
 * Catálogo de artículos y cotizaciones recibidas (ADR-040 fase 10). El precio se escribe en
 * dólares y se convierte a centavos ENTEROS con texto (nunca con coma flotante); el servidor
 * calcula todos los totales.
 */
export function ManageQuotes({ placeId }: { placeId: string }) {
  const [items, setItems] = useState<QuoteItem[] | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<QuoteUnit>('person');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [catalog, received] = await Promise.all([
          fetchManagedQuoteItems(placeId, signal),
          fetchManagedQuotes(placeId, signal),
        ]);
        setItems(catalog);
        setQuotes(received);
        setLoadError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setLoadError(errorMessage(e, 'No pudimos cargar el cotizador.'));
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

  async function add() {
    if (busy) return;
    const cents = parsePriceCents(price);
    if (!name.trim()) return setError('Ponle un nombre al artículo.');
    if (cents === null) return setError('Precio inválido. Usá un número como 12 o 12.50 (hasta 1 000 000).');
    setBusy(true);
    setError(null);
    try {
      await createQuoteItem(placeId, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        unit,
        unit_price_cents: cents,
      });
      setName('');
      setDescription('');
      setPrice('');
      await load();
    } catch (e) {
      setError(errorMessage(e, 'No pudimos agregar el artículo.'));
    } finally {
      setBusy(false);
    }
  }

  function toggle(item: QuoteItem, active: boolean) {
    setQuoteItemActive(placeId, item.id, active)
      .then(() => load())
      .catch((e: unknown) => Alert.alert('No pudimos cambiarlo', errorMessage(e, 'Intentá de nuevo.')));
  }

  function decide(quote: Quote, decision: 'accepted' | 'rejected') {
    if (busy) return;
    setBusy(true);
    decideQuote(placeId, quote.id, decision)
      .then(() => load())
      .catch((e: unknown) => Alert.alert('No pudimos decidir', errorMessage(e, 'Intentá de nuevo.')))
      .finally(() => setBusy(false));
  }

  function confirmDelete(item: QuoteItem) {
    Alert.alert('¿Eliminar el artículo?', 'Las cotizaciones ya emitidas no cambian.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          deleteQuoteItem(placeId, item.id)
            .then(() => load())
            .catch((e: unknown) => Alert.alert('No pudimos eliminarlo', errorMessage(e, 'Intentá de nuevo.')));
        },
      },
    ]);
  }

  return (
    <Section title="Cotizador">
      {loadError ? <Banner tone="error">{loadError}</Banner> : null}

      <Card>
        <Text style={ms.strong}>Nuevo artículo</Text>
        <Field label="Nombre" value={name} onChangeText={setName} maxLength={120} />
        <Field label="Descripción (opcional)" value={description} onChangeText={setDescription} maxLength={300} />
        <Field
          label="Precio en dólares"
          value={price}
          onChangeText={setPrice}
          placeholder="12.50"
          maxLength={10}
          keyboardType="decimal-pad"
        />
        <View style={ms.row}>
          {UNITS.map((u) => (
            <Pressable
              key={u}
              onPress={() => setUnit(u)}
              style={[
                { flex: 1, padding: 10, borderRadius: 999, borderWidth: 1, alignItems: 'center' },
                { borderColor: unit === u ? colors.brand : colors.borderStrong },
                unit === u && { backgroundColor: colors.brand },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: unit === u }}
            >
              <Text style={{ color: unit === u ? colors.onBrand : colors.fg, fontWeight: '600' }}>
                {UNIT_LABEL[u]}
              </Text>
            </Pressable>
          ))}
        </View>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Button label="Agregar artículo" onPress={() => void add()} loading={busy} />
      </Card>

      {items?.map((item) => (
        <Card key={item.id}>
          <View style={ms.rowBetween}>
            <View style={ms.flex}>
              <Text style={ms.strong}>{item.name}</Text>
              <Text style={ms.muted}>
                {item.unit_price.amount} {item.unit_price.currency} {UNIT_LABEL[item.unit]}
              </Text>
            </View>
            <Switch
              value={item.is_active}
              onValueChange={(active) => toggle(item, active)}
              trackColor={{ true: colors.brand, false: colors.borderStrong }}
              accessibilityLabel={`${item.name} activo`}
            />
          </View>
          <Pressable onPress={() => confirmDelete(item)} accessibilityRole="button">
            <Text style={[ms.link, { color: colors.dangerFg }]}>Eliminar</Text>
          </Pressable>
        </Card>
      ))}
      {items && items.length === 0 ? <Text style={ms.muted}>Aún no cargaste artículos.</Text> : null}

      <Text style={ms.strong}>Cotizaciones recibidas</Text>
      {quotes.length === 0 ? <Text style={ms.muted}>Todavía nadie pidió una cotización.</Text> : null}
      {quotes.map((quote) => (
        <Card key={quote.id}>
          <Text style={ms.strong}>
            {quote.user?.name || quote.user?.username || 'Alguien'} · {quote.total.amount}{' '}
            {quote.total.currency}
          </Text>
          {quote.lines.map((line, index) => (
            <Text key={`${line.name}-${index}`} style={ms.muted}>
              {line.quantity} × {line.name} — {line.line_total.amount}
            </Text>
          ))}
          {quote.note ? <Text style={ms.muted}>Nota: {quote.note}</Text> : null}
          <Text style={ms.muted}>
            {QUOTE_STATUS_LABEL[quote.status]}
            {quote.status === 'pending' && new Date(quote.valid_until) <= new Date() ? ' · Vencida' : ''}
          </Text>
          <Pressable
            onPress={() =>
              shareQuotePdf(quote.id).catch((e: unknown) =>
                Alert.alert('No pudimos abrir el PDF', errorMessage(e, 'Intentá de nuevo.')),
              )
            }
            accessibilityRole="button"
          >
            <Text style={ms.link}>Descargar PDF</Text>
          </Pressable>
          {quote.status === 'pending' && new Date(quote.valid_until) > new Date() ? (
            <View style={ms.row}>
              <Button label="Aceptar" onPress={() => decide(quote, 'accepted')} disabled={busy} style={{ flex: 1 }} />
              <Button
                label="Rechazar"
                variant="secondary"
                onPress={() => decide(quote, 'rejected')}
                disabled={busy}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
        </Card>
      ))}
    </Section>
  );
}
