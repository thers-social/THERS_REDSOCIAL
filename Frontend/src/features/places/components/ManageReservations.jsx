import { useCallback, useEffect, useState } from "react";
import Spinner from "@shared/components/Spinner";
import ManageQuotes from "./ManageQuotes";
import ManageSchedule from "./ManageSchedule";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import {
  decideReservation,
  fetchManagedReservations,
  fetchReservationSettings,
  saveReservationSettings,
} from "../lib/placesApi";

/**
 * Reservas del lado del negocio (ADR-040 fase 8): activar y fijar el cupo por horario, y
 * confirmar o rechazar las solicitudes pendientes. Solo dentro del panel de quien gestiona.
 */
export default function ManageReservations({ placeId, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [state, setState] = useState({ status: "loading" });
  const [form, setForm] = useState({ enabled: false, capacity: 10, max_party_size: 8 });
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (signal) =>
      Promise.all([fetchReservationSettings(placeId, signal), fetchManagedReservations(placeId, "pending", signal)])
        .then(([settings, reservations]) => {
          setForm(settings);
          setPending(reservations);
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
      onChanged?.();
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

  const field = "mt-1 w-24 rounded-lg border border-line bg-transparent px-3 py-2 dark:border-line-dark";
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-ink dark:text-ink-dark">{t("places.reservations.manage.title")}</h3>
      <form
        className="mt-2 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () =>
              saveReservationSettings(placeId, {
                enabled: form.enabled,
                capacity: Number(form.capacity),
                max_party_size: Number(form.max_party_size),
              }),
            "places.reservations.manage.saved"
          );
        }}
      >
        <label className="flex items-center gap-2 text-sm text-ink dark:text-ink-dark">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((c) => ({ ...c, enabled: e.target.checked }))}
          />
          {t("places.reservations.manage.enabled")}
        </label>
        <div className="flex gap-4">
          <label className="text-sm text-ink dark:text-ink-dark">
            {t("places.reservations.manage.capacity")}
            <input
              type="number"
              min={1}
              max={500}
              value={form.capacity}
              onChange={(e) => setForm((c) => ({ ...c, capacity: e.target.value }))}
              className={field}
            />
          </label>
          <label className="text-sm text-ink dark:text-ink-dark">
            {t("places.reservations.manage.maxParty")}
            <input
              type="number"
              min={1}
              max={50}
              value={form.max_party_size}
              onChange={(e) => setForm((c) => ({ ...c, max_party_size: e.target.value }))}
              className={field}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand disabled:opacity-50"
        >
          {t("places.manage.save")}
        </button>
      </form>

      <h3 className="mt-4 text-sm font-semibold text-ink dark:text-ink-dark">{t("places.reservations.manage.pending")}</h3>
      {pending.length === 0 && <p className="mt-1 text-sm text-muted">{t("places.reservations.manage.none")}</p>}
      <ul className="mt-2 space-y-2">
        {pending.map((item) => (
          <li key={item.id} className="rounded-xl border border-line p-3 text-sm dark:border-line-dark">
            <p className="font-semibold text-ink dark:text-ink-dark">
              {item.user.name || item.user.username} · {t("places.reservations.people", { count: item.party_size })}
            </p>
            <p className="text-xs text-muted">{new Date(item.starts_at).toLocaleString()}</p>
            {item.note && <p className="mt-1 whitespace-pre-wrap break-words text-ink dark:text-ink-dark">{item.note}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => decideReservation(placeId, item.id, true), "places.reservations.manage.confirmed")}
                className="rounded-full bg-th-brand px-3 py-1.5 text-xs font-semibold text-th-on-brand disabled:opacity-50"
              >
                {t("places.reservations.manage.confirm")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => decideReservation(placeId, item.id, false), "places.reservations.manage.declined")}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-th-danger-fg disabled:opacity-50"
              >
                {t("places.reservations.manage.decline")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ManageSchedule placeId={placeId} />
      <ManageQuotes placeId={placeId} />
    </div>
  );
}
