import { useCallback, useEffect, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { useAuth } from "@features/auth/context/AuthContext";
import { cancelReservation, createReservation, fetchAvailability, fetchMyReservations } from "../lib/placesApi";

// `datetime-local` entrega la hora LOCAL sin zona; el servidor exige zona, así que se envía en UTC.
function toIso(localValue) {
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Reservar en un lugar que las acepta (ADR-040 fase 8). Muestra las reservas de la persona en
 * ESTE lugar y deja pedir una nueva. El servidor decide el cupo; aquí no se calcula nada.
 */
export default function PlaceReservations({ place }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const [state, setState] = useState({ status: "loading", items: [] });
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const enabled = Boolean(user) && place.accepts_reservations;

  const load = useCallback(
    (signal) =>
      fetchMyReservations(signal)
        .then((all) =>
          setState({
            status: "ready",
            items: all.filter((item) => item.place?.id === place.id && ["pending", "confirmed"].includes(item.status)),
          })
        )
        .catch((error) => {
          if (!signal?.aborted) setState({ status: "error", items: [], error: getErrorMessage(error, t) });
        }),
    [place.id, t]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [enabled, load]);

  if (!enabled) return null;

  async function cancel(item) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await cancelReservation(item.id);
      toast.success(t("places.reservations.cancelled"));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-reservations-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="place-reservations-title" className="text-base font-semibold text-ink dark:text-ink-dark">
          {t("places.reservations.title")}
        </h2>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand hover:bg-th-brand-hover"
          >
            {t("places.reservations.book")}
          </button>
        )}
      </div>
      {!place.is_claimed && (
        <p className="mt-2 text-xs text-muted dark:text-muted-dark">{t("places.reservations.unclaimed")}</p>
      )}
      {open && (
        <BookingForm
          placeId={place.id}
          onCancel={() => setOpen(false)}
          onBooked={async () => {
            setOpen(false);
            toast.success(t("places.reservations.sent"));
            await load();
          }}
        />
      )}
      {state.status === "loading" && <Spinner className="mt-3" />}
      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-th-danger-fg">
          {state.error}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {state.items.map((item) => (
          <li key={item.id} className="rounded-xl border border-line p-3 text-sm dark:border-line-dark">
            <p className="font-semibold text-ink dark:text-ink-dark">
              {new Date(item.starts_at).toLocaleString()} · {t("places.reservations.people", { count: item.party_size })}
            </p>
            <p className="text-xs text-muted">{t(`places.reservations.status.${item.status}`)}</p>
            {item.decision_note && (
              <p className="mt-1 whitespace-pre-wrap break-words text-ink dark:text-ink-dark">{item.decision_note}</p>
            )}
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => cancel(item)}
              className="mt-1 text-xs font-semibold text-th-danger-fg hover:underline disabled:opacity-50"
            >
              {t("places.reservations.cancel")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BookingForm({ placeId, onCancel, onBooked }) {
  const { t } = useLanguage();
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState(null); // null = aún sin consultar
  const [slot, setSlot] = useState("");
  const [fallbackWhen, setFallbackWhen] = useState("");
  const [party, setParty] = useState(2);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Al elegir el día se piden los horarios libres. Si el negocio no cargó su horario el servidor
  // devuelve una lista vacía y se ofrece elegir fecha y hora a mano (el servidor valida igual).
  useEffect(() => {
    if (!day) return undefined;
    const controller = new AbortController();
    setSlots(null);
    setSlot("");
    fetchAvailability(placeId, day, controller.signal)
      .then((data) => setSlots(data.slots))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setSlots([]);
          setError(getErrorMessage(err, t));
        }
      });
    return () => controller.abort();
  }, [placeId, day, t]);

  async function submit(event) {
    event.preventDefault();
    if (sending) return;
    const startsAt = slots && slots.length > 0 ? slot : toIso(fallbackWhen);
    if (!startsAt) return setError(t("places.reservations.whenRequired"));
    setSending(true);
    setError("");
    try {
      await createReservation(placeId, { startsAt, partySize: Number(party), note: note.trim() });
      await onBooked();
    } catch (err) {
      setError(getErrorMessage(err, t));
      setSending(false);
    }
  }

  const field = "mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 dark:border-line-dark";
  const hasSlots = slots && slots.length > 0;
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl border border-line p-3 dark:border-line-dark">
      <label className="block text-sm text-ink dark:text-ink-dark">
        {t("places.schedule.pickDay")}
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={field} />
      </label>
      {hasSlots && (
        <label className="block text-sm text-ink dark:text-ink-dark">
          {t("places.schedule.pickSlot")}
          <select value={slot} onChange={(e) => setSlot(e.target.value)} className={field}>
            <option value="">—</option>
            {slots.map((item) => (
              <option key={item.starts_at} value={item.starts_at} disabled={item.seats_left < 1}>
                {new Date(item.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
                {t("places.schedule.seatsLeft", { count: item.seats_left })}
              </option>
            ))}
          </select>
        </label>
      )}
      {day && slots && slots.length === 0 && (
        <>
          <p className="text-xs text-muted">{t("places.schedule.noSlots")}</p>
          <label className="block text-sm text-ink dark:text-ink-dark">
            {t("places.reservations.when")}
            <input
              type="datetime-local"
              step={900}
              value={fallbackWhen}
              onChange={(e) => setFallbackWhen(e.target.value)}
              className={field}
            />
          </label>
        </>
      )}
      <label className="block text-sm text-ink dark:text-ink-dark">
        {t("places.reservations.party")}
        <input type="number" min={1} max={50} value={party} onChange={(e) => setParty(e.target.value)} className={field} />
      </label>
      <label className="block text-sm text-ink dark:text-ink-dark">
        {t("places.reservations.note")}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} className={field} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-th-danger-fg">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand disabled:opacity-50"
        >
          {sending ? t("places.reservations.sending") : t("places.reservations.submit")}
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-sm font-semibold text-ink dark:text-ink-dark"
        >
          {t("places.reservations.back")}
        </button>
      </div>
    </form>
  );
}
