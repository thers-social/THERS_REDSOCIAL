import { useCallback, useEffect, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { fetchManageAnalytics } from "../lib/placesApi";
import {
  ANALYTICS_METRICS,
  ANALYTICS_PERIODS,
  axisLabels,
  changeLabel,
  chartBars,
  isHidden,
  shortDay,
} from "../lib/analyticsFormat";

const SIGN_CLASS = { up: "text-th-success-fg", down: "text-th-danger-fg", flat: "text-muted dark:text-muted-dark" };

function Tile({ label, value, change, t }) {
  const delta = changeLabel(change);
  return (
    <div className="rounded-xl border border-line p-3 dark:border-line-dark">
      <p className="text-xl font-semibold text-ink dark:text-ink-dark">{value}</p>
      <p className="text-xs text-muted dark:text-muted-dark">{label}</p>
      {delta && (
        <p className={`text-xs ${SIGN_CLASS[delta.sign]}`}>
          {delta.text} {t("places.analytics.vsPrevious")}
        </p>
      )}
    </div>
  );
}

/**
 * Estadísticas del lugar (ADR-040 §31): conteos por día en hora de El Salvador, la variación
 * frente al periodo anterior y un gráfico de barras. Solo cifras agregadas; guardados y planes
 * se ocultan si el periodo suma menos del mínimo que fija el servidor.
 */
export default function ManageAnalytics({ placeId }) {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState("views");
  const [state, setState] = useState({ status: "loading" });

  const load = useCallback(
    (signal) =>
      fetchManageAnalytics(placeId, days, signal)
        .then((data) => setState({ status: "ready", data }))
        .catch((error) => {
          if (!signal?.aborted) setState({ status: "error", error: getErrorMessage(error, t) });
        }),
    [placeId, days, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.status === "loading") return <Spinner className="mt-4" />;
  if (state.status === "error") {
    return (
      <p role="alert" className="mt-4 text-sm text-th-danger-fg">
        {state.error}
      </p>
    );
  }

  const { data } = state;
  const { totals, change, series } = data;
  const bars = chartBars(series, metric);
  const hidden = isHidden(data.hidden, metric);
  const visits = totals.visits;
  const labels = axisLabels(series);
  const quiet = totals.reservations.requested + totals.quotes.requested + totals.reviews + totals.posts === 0;
  const chip = (active) =>
    `rounded-full border px-3 py-1 text-xs font-semibold ${
      active ? "border-transparent bg-th-brand text-th-on-brand" : "border-line text-ink dark:border-line-dark dark:text-ink-dark"
    }`;
  const dash = (value) => (value === null ? "—" : String(value));

  return (
    <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-analytics-title">
      <h3 id="place-analytics-title" className="text-base font-semibold text-ink dark:text-ink-dark">
        {t("places.analytics.title")}
      </h3>

      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("places.analytics.period")}>
        {ANALYTICS_PERIODS.map((period) => (
          <button key={period} type="button" aria-pressed={period === days} onClick={() => setDays(period)} className={chip(period === days)}>
            {t("places.analytics.days", { n: period })}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted dark:text-muted-dark">
        {t("places.analytics.range", { from: shortDay(data.range.from), to: shortDay(data.range.to) })}
      </p>
      {quiet && (
        <p role="status" className="mt-2 text-sm text-muted dark:text-muted-dark">
          {t("places.analytics.quiet")}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tile t={t} label={t("places.analytics.metrics.views")} value={visits ? visits.views : "—"} change={change.views} />
        <Tile
          t={t}
          label={t("places.analytics.conversion")}
          value={visits && visits.conversion_percent !== null ? `${visits.conversion_percent} %` : "—"}
        />
        <Tile t={t} label={t("places.analytics.metrics.reservations")} value={totals.reservations.requested} change={change.reservations} />
        <Tile t={t} label={t("places.analytics.metrics.quotes")} value={totals.quotes.requested} change={change.quotes} />
        <Tile
          t={t}
          label={t("places.analytics.metrics.reviews")}
          value={totals.rating_average === null ? totals.reviews : `${totals.reviews} · ${totals.rating_average.toFixed(1)} ★`}
          change={change.reviews}
        />
        <Tile t={t} label={t("places.analytics.metrics.posts")} value={totals.posts} change={change.posts} />
        <Tile t={t} label={t("places.analytics.metrics.saves")} value={dash(totals.saves)} change={change.saves} />
        <Tile t={t} label={t("places.analytics.metrics.plans")} value={dash(totals.plans)} change={change.plans} />
      </div>

      <div className="mt-3 rounded-xl border border-line p-3 text-sm text-ink dark:border-line-dark dark:text-ink-dark">
        <p>
          <span className="font-semibold">{t("places.analytics.metrics.views")}:</span>{" "}
          {visits
            ? t("places.analytics.visitsDetail", { phone: visits.phone, website: visits.website, directions: visits.directions })
            : t("places.analytics.hidden", { min: data.min_count })}
        </p>
        <p>
          <span className="font-semibold">{t("places.analytics.metrics.reservations")}:</span>{" "}
          {t("places.analytics.reservationsDetail", {
            confirmed: totals.reservations.confirmed,
            people: totals.reservations.people_confirmed,
            pending: totals.reservations.pending,
            declined: totals.reservations.declined,
            cancelled: totals.reservations.cancelled,
          })}
        </p>
        <p className="mt-1">
          <span className="font-semibold">{t("places.analytics.metrics.quotes")}:</span>{" "}
          {t("places.analytics.quotesDetail", {
            accepted: totals.quotes.accepted,
            value: `${totals.quotes.accepted_value.amount} ${totals.quotes.accepted_value.currency}`,
            pending: totals.quotes.pending,
            rejected: totals.quotes.rejected,
          })}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("places.analytics.chart")}>
        {ANALYTICS_METRICS.map((key) => (
          <button key={key} type="button" aria-pressed={key === metric} onClick={() => setMetric(key)} className={chip(key === metric)}>
            {t(`places.analytics.metrics.${key}`)}
          </button>
        ))}
      </div>

      {hidden ? (
        <p role="status" className="mt-2 text-sm text-muted dark:text-muted-dark">
          {t("places.analytics.hidden", { min: data.min_count })}
        </p>
      ) : (
        <figure className="mt-2" aria-label={t("places.analytics.chartOf", { metric: t(`places.analytics.metrics.${metric}`) })}>
          <div className="flex h-32 items-end gap-px">
            {bars.map((bar) => (
              <div key={bar.date} className="flex h-full flex-1 items-end" title={`${shortDay(bar.date)}: ${bar.value}`}>
                <div className="w-full rounded-t-sm bg-th-brand" style={{ height: `${bar.heightPercent}%` }} />
              </div>
            ))}
          </div>
          <figcaption className="mt-1 flex justify-between text-[11px] text-muted dark:text-muted-dark">
            {labels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
