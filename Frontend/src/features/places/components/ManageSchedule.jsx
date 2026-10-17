import { useCallback, useEffect, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import {
  addClosure,
  fetchManageCalendar,
  fetchPlaceHours,
  removeClosure,
  saveHours,
} from "../lib/placesApi";

// weekday 0 = lunes … 6 = domingo (igual que el servidor).
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function emptyDay() {
  return { open: false, opens: "09:00", closes: "17:00" };
}

/**
 * Horario de apertura, cierres y calendario del negocio (ADR-040 fase 9). El horario se edita con
 * UN tramo por día (el servidor admite hasta 3); si ya hay más de uno se conservan al guardar sin
 * tocarlos. Hora local de El Salvador.
 */
export default function ManageSchedule({ placeId }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [state, setState] = useState({ status: "loading" });
  const [days, setDays] = useState(WEEKDAYS.map(emptyDay));
  const [extra, setExtra] = useState({}); // tramos adicionales por día que la UI no edita
  const [closures, setClosures] = useState([]);
  const [calendar, setCalendar] = useState([]);
  const [closureDate, setClosureDate] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (signal) =>
      Promise.all([fetchPlaceHours(placeId, signal), fetchManageCalendar(placeId, signal)])
        .then(([schedule, cal]) => {
          const next = WEEKDAYS.map(emptyDay);
          const rest = {};
          schedule.days.forEach((day) => {
            const [first, ...others] = day.intervals;
            if (first) next[day.weekday] = { open: true, opens: first.opens, closes: first.closes };
            if (others.length) rest[day.weekday] = others;
          });
          setDays(next);
          setExtra(rest);
          setClosures(schedule.closures);
          setCalendar(cal.days);
          setState({ status: "ready" });
        })
        .catch((error) => {
          if (!signal?.aborted) setState({ status: "error", error: getErrorMessage(error, t) });
        }),
    [placeId, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function run(action, successKey) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") return <Spinner className="mt-3" />;
  if (state.status === "error") {
    return (
      <p role="alert" className="mt-3 text-sm text-th-danger-fg">
        {state.error}
      </p>
    );
  }

  const update = (index, patch) => setDays((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const payload = () =>
    days.map((day, weekday) => ({
      weekday,
      intervals: day.open ? [{ opens: day.opens, closes: day.closes }, ...(extra[weekday] ?? [])] : [],
    }));
  const input = "rounded-lg border border-line bg-transparent px-2 py-1 dark:border-line-dark";

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-ink dark:text-ink-dark">{t("places.schedule.title")}</h3>
      <p className="text-xs text-muted">{t("places.schedule.hint")}</p>
      <ul className="mt-2 space-y-1">
        {days.map((day, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2 text-sm text-ink dark:text-ink-dark">
            <label className="flex w-28 items-center gap-2">
              <input type="checkbox" checked={day.open} onChange={(e) => update(index, { open: e.target.checked })} />
              {t(`places.schedule.weekday.${index}`)}
            </label>
            {day.open ? (
              <>
                <input
                  type="time"
                  step={900}
                  value={day.opens}
                  onChange={(e) => update(index, { opens: e.target.value })}
                  aria-label={t("places.schedule.opens")}
                  className={input}
                />
                <span>–</span>
                <input
                  type="time"
                  step={900}
                  value={day.closes}
                  onChange={(e) => update(index, { closes: e.target.value })}
                  aria-label={t("places.schedule.closes")}
                  className={input}
                />
              </>
            ) : (
              <span className="text-xs text-muted">{t("places.schedule.closed")}</span>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => saveHours(placeId, payload()), "places.schedule.saved")}
        className="mt-2 rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand disabled:opacity-50"
      >
        {t("places.manage.save")}
      </button>

      <h3 className="mt-4 text-sm font-semibold text-ink dark:text-ink-dark">{t("places.schedule.closuresTitle")}</h3>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!closureDate) return;
          run(async () => {
            await addClosure(placeId, closureDate, closureReason.trim());
            setClosureDate("");
            setClosureReason("");
          }, "places.schedule.closureAdded");
        }}
      >
        <input type="date" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} className={input} />
        <input
          value={closureReason}
          onChange={(e) => setClosureReason(e.target.value)}
          maxLength={120}
          placeholder={t("places.schedule.reason")}
          className={input}
        />
        <button type="submit" disabled={busy || !closureDate} className="rounded-full px-3 py-1.5 text-xs font-semibold text-th-brand disabled:opacity-50">
          {t("places.schedule.addClosure")}
        </button>
      </form>
      <ul className="mt-2 space-y-1">
        {closures.map((closure) => (
          <li key={closure.date} className="flex items-center gap-2 text-sm text-ink dark:text-ink-dark">
            <span>
              {closure.date}
              {closure.reason ? ` · ${closure.reason}` : ""}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => removeClosure(placeId, closure.date), "places.schedule.closureRemoved")}
              className="text-xs font-semibold text-th-danger-fg hover:underline disabled:opacity-50"
            >
              {t("places.schedule.removeClosure")}
            </button>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-semibold text-ink dark:text-ink-dark">{t("places.schedule.calendarTitle")}</h3>
      <ul className="mt-2 divide-y divide-line text-sm dark:divide-line-dark">
        {calendar.map((day) => (
          <li key={day.date} className="flex flex-wrap justify-between gap-2 py-1 text-ink dark:text-ink-dark">
            <span>{day.date}</span>
            <span className="text-xs text-muted">
              {day.closed
                ? t("places.schedule.closedDay")
                : t("places.schedule.dayCounts", {
                    pending: day.reservations.pending,
                    confirmed: day.reservations.confirmed,
                    people: day.reservations.people,
                  })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
