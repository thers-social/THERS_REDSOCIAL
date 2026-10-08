import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { TeroAvatar } from '@features/tero/components/TeroAvatar';
import { TeroGate } from '@features/tero/components/TeroGate';
import { TeroPreviewNotice } from '@features/tero/components/TeroPreviewNotice';
import { useTero } from '@features/tero/context/TeroContext';
import { teroClient } from '@features/tero/lib/teroClient';
import { useReducedMotion } from '@features/tero/lib/useReducedMotion';
import type { TeroSummary } from '@features/tero/types';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; summary: TeroSummary };

/** Resumen de actividad. Fase 1: métricas de ejemplo, marcadas como tales. */
export default function TeroSummaryScreen() {
  return (
    <TeroGate>
      <TeroSummaryContent />
    </TeroGate>
  );
}

function TeroSummaryContent() {
  const { preferences } = useTero();
  const reducedMotion = useReducedMotion();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchSummary = useCallback((signal?: AbortSignal) => {
    setLoad({ status: 'loading' });
    teroClient
      .summary(signal)
      .then((summary) => setLoad({ status: 'ready', summary }))
      .catch(() => {
        if (!signal?.aborted) setLoad({ status: 'error' });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSummary(controller.signal);
    return () => controller.abort();
  }, [fetchSummary]);

  return (
    <Screen title="Resumen" back>
      <View style={styles.hero}>
        <TeroAvatar
          size={64}
          mood={load.status === 'loading' ? 'thinking' : load.status === 'error' ? 'error' : 'happy'}
          animated={preferences.animations && !reducedMotion}
        />
        <Text style={styles.heroText}>
          {load.status === 'ready' ? load.summary.periodLabel : 'Preparando tu resumen…'}
        </Text>
      </View>

      {load.status === 'loading' ? <StateMessage kind="loading" message="Cargando resumen…" /> : null}
      {load.status === 'error' ? (
        <StateMessage
          kind="error"
          title="No pudimos preparar el resumen"
          actionLabel="Reintentar"
          onAction={() => fetchSummary()}
        />
      ) : null}

      {load.status === 'ready' ? (
        <>
          {load.summary.isMock ? (
            <TeroPreviewNotice message="Estas cifras son de ejemplo: todavía no reflejan tu actividad real." />
          ) : null}
          <View style={styles.grid}>
            {load.summary.metrics.map((metric) => (
              <View
                key={metric.id}
                style={styles.metric}
                accessible
                accessibilityLabel={`${metric.label}: ${metric.value}, ${metric.delta >= 0 ? 'sube' : 'baja'} ${Math.abs(metric.delta)} por ciento`}
              >
                <Text style={styles.metricValue}>{metric.value}</Text>
                <Text style={styles.metricLabel}>{metric.label}</Text>
                <Text style={[styles.delta, metric.delta >= 0 ? styles.up : styles.down]}>
                  {metric.delta >= 0 ? '▲' : '▼'} {Math.abs(metric.delta)}%
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.section} accessibilityRole="header">
            Lo destacado
          </Text>
          {load.summary.highlights.map((text) => (
            <View key={text} style={styles.highlight}>
              <Text style={styles.highlightText}>{text}</Text>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  hero: { alignItems: 'center', marginBottom: space[4] },
  heroText: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginTop: space[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  metric: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: space[4],
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  metricValue: { fontSize: fontSize.headlineMd, fontWeight: '700', color: colors.fg },
  metricLabel: { fontSize: fontSize.bodySm, color: colors.fgSecondary, marginTop: 2 },
  delta: { fontSize: fontSize.labelMd, fontWeight: '600', marginTop: space[2] },
  up: { color: colors.successFg },
  down: { color: colors.dangerFg },
  section: { fontSize: fontSize.headlineSm, fontWeight: '700', color: colors.fg, marginTop: space[6], marginBottom: space[3] },
  highlight: {
    padding: space[3],
    borderRadius: radius.input,
    backgroundColor: colors.bgSubtle,
    marginBottom: space[2],
  },
  highlightText: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 21 },
}));
