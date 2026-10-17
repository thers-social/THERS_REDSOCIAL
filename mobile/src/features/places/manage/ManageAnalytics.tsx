import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { StateMessage } from '@shared/ui/StateMessage';

import { fetchManageAnalytics } from '../api';
import {
  axisLabels,
  changeTone,
  chartBars,
  formatChange,
  hiddenNote,
  isHidden,
  METRIC_LABEL,
  METRIC_ORDER,
  PERIODS,
  shortDay,
} from '../analyticsFormat';
import type { AnalyticsMetric } from '../analyticsFormat';
import type { ManageAnalytics as Analytics } from '../types';
import { errorMessage, Section } from './ui';

const CHART_HEIGHT = 120;

function Tile({ label, value, change }: { label: string; value: string; change?: number | null }) {
  const tone = changeTone(change);
  const text = formatChange(change);
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {text ? (
        <Text style={[styles.change, tone === 'up' && styles.up, tone === 'down' && styles.down]}>
          {text} vs. periodo anterior
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Estadísticas del lugar (ADR-040 §31): conteos por día en hora de El Salvador, la variación
 * frente al periodo anterior y un gráfico de barras. Solo cifras agregadas; guardados y planes
 * se ocultan si el periodo suma menos del mínimo que fija el servidor.
 */
export function ManageAnalytics({ placeId }: { placeId: string }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [metric, setMetric] = useState<AnalyticsMetric>('views');
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setData(await fetchManageAnalytics(placeId, days, signal));
        setError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setError(errorMessage(e, 'No pudimos cargar las estadísticas.'));
      }
    },
    [placeId, days],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (error && !data) {
    return (
      <Section title="Estadísticas">
        <StateMessage kind="error" title="No pudimos cargarlas" message={error} actionLabel="Reintentar" onAction={() => void load()} />
      </Section>
    );
  }
  if (!data) {
    return (
      <Section title="Estadísticas">
        <StateMessage kind="loading" message="Cargando estadísticas…" />
      </Section>
    );
  }

  const { totals, change, series } = data;
  const bars = chartBars(series, metric);
  const metricHidden = isHidden(data.hidden, metric);
  const visits = totals.visits;
  const labels = axisLabels(series);
  const quiet = totals.reservations.requested + totals.quotes.requested + totals.reviews + totals.posts === 0;

  return (
    <Section title="Estadísticas">
      <View style={styles.row}>
        {PERIODS.map((period) => (
          <Pressable
            key={period}
            onPress={() => setDays(period)}
            style={[styles.chip, period === days && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: period === days }}
          >
            <Text style={[styles.chipText, period === days && styles.chipTextActive]}>{period} días</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.muted}>
        Del {shortDay(data.range.from)} al {shortDay(data.range.to)} · horas de El Salvador
      </Text>

      {quiet ? <Banner tone="info">Todavía no hay actividad en este periodo.</Banner> : null}

      <View style={styles.grid}>
        <Tile label="Visitas a la ficha" value={visits ? String(visits.views) : '—'} change={change.views} />
        <Tile
          label="De la visita a la solicitud"
          value={visits && visits.conversion_percent !== null ? `${visits.conversion_percent} %` : '—'}
        />
        <Tile label="Reservas pedidas" value={String(totals.reservations.requested)} change={change.reservations} />
        <Tile label="Cotizaciones pedidas" value={String(totals.quotes.requested)} change={change.quotes} />
        <Tile
          label="Reseñas"
          value={totals.rating_average === null ? String(totals.reviews) : `${totals.reviews} · ${totals.rating_average.toFixed(1)} ★`}
          change={change.reviews}
        />
        <Tile label="Publicaciones" value={String(totals.posts)} change={change.posts} />
        <Tile label="Guardados" value={totals.saves === null ? '—' : String(totals.saves)} change={change.saves} />
        <Tile label="Planes creados" value={totals.plans === null ? '—' : String(totals.plans)} change={change.plans} />
      </View>

      <View style={styles.card}>
        <Text style={styles.strong}>Visitas</Text>
        <Text style={styles.muted}>
          {visits
            ? `${visits.phone} toques en el teléfono · ${visits.website} en el sitio web · ${visits.directions} en «Cómo llegar». Visitas anónimas: no sabemos quién fue.`
            : hiddenNote(data.min_count)}
        </Text>
        <Text style={[styles.strong, styles.gap]}>Reservas</Text>
        <Text style={styles.muted}>
          {totals.reservations.confirmed} confirmadas ({totals.reservations.people_confirmed} personas) ·{' '}
          {totals.reservations.pending} pendientes · {totals.reservations.declined} rechazadas ·{' '}
          {totals.reservations.cancelled} canceladas
        </Text>
        <Text style={[styles.strong, styles.gap]}>Cotizaciones</Text>
        <Text style={styles.muted}>
          {totals.quotes.accepted} aceptadas por {totals.quotes.accepted_value.amount} {totals.quotes.accepted_value.currency} ·{' '}
          {totals.quotes.pending} pendientes · {totals.quotes.rejected} rechazadas
        </Text>
      </View>

      <View style={styles.row}>
        {METRIC_ORDER.map((key) => (
          <Pressable
            key={key}
            onPress={() => setMetric(key)}
            style={[styles.chip, key === metric && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: key === metric }}
          >
            <Text style={[styles.chipText, key === metric && styles.chipTextActive]}>{METRIC_LABEL[key]}</Text>
          </Pressable>
        ))}
      </View>

      {metricHidden ? (
        <Banner tone="info">{`${METRIC_LABEL[metric]}: ${hiddenNote(data.min_count)}`}</Banner>
      ) : (
        <View style={styles.card} accessible accessibilityLabel={`Gráfico de ${METRIC_LABEL[metric]} por día`}>
          <View style={[styles.chart, { height: CHART_HEIGHT }]}>
            {bars.map((bar) => (
              <View key={bar.date} style={styles.barSlot}>
                <View style={[styles.bar, { height: `${bar.heightPercent}%` }]} />
              </View>
            ))}
          </View>
          <View style={styles.axis}>
            {labels.map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.axisLabel}>
                {label}
              </Text>
            ))}
          </View>
        </View>
      )}
    </Section>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    paddingHorizontal: space[3],
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.fg },
  chipTextActive: { color: '#ffffff' },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tile: {
    width: '48%',
    gap: 2,
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileValue: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg },
  tileLabel: { fontSize: fontSize.labelMd, color: colors.fgMuted },
  change: { fontSize: fontSize.labelSm, color: colors.fgMuted },
  up: { color: colors.successFg },
  down: { color: colors.dangerFg },
  card: {
    gap: 2,
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  strong: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  gap: { marginTop: space[2] },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', minHeight: 0, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: colors.brand },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[1] },
  axisLabel: { fontSize: fontSize.labelSm, color: colors.fgMuted },
}));
