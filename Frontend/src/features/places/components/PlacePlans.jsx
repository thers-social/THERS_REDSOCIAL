import { useCallback, useEffect, useState } from "react";
import Avatar from "@shared/components/Avatar";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { useAuth } from "@features/auth/context/AuthContext";
import { cancelPlan, createPlan, fetchFriends, fetchPlans, leavePlan, respondToPlan } from "../lib/placesApi";

// `datetime-local` entrega la hora LOCAL sin zona; el servidor exige zona, así que se
// convierte a ISO-8601 en UTC antes de enviar.
function toIso(localValue) {
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Planes con amistades en un lugar (ADR-040 fase 5). Muestra los planes próximos de la
 * persona en ESTE lugar (el servidor ya limita la lista a los que integra) y permite crear
 * uno invitando a amistades. Los textos se pintan como texto de React; sin HTML.
 */
export default function PlacePlans({ placeId }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const [state, setState] = useState({ status: "loading", plans: [] });
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(
    (signal) =>
      fetchPlans("upcoming", signal)
        .then((plans) =>
          setState({ status: "ready", plans: plans.filter((plan) => plan.place?.id === placeId) })
        )
        .catch((error) => {
          if (!signal?.aborted) setState({ status: "error", plans: [], error: getErrorMessage(error, t) });
        }),
    [placeId, t]
  );

  useEffect(() => {
    if (!user) return undefined;
    setState({ status: "loading", plans: [] });
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [user, load]);

  if (!user) return null;

  async function act(plan, action, successKey) {
    if (busyId) return;
    setBusyId(plan.id);
    try {
      await action();
      toast.success(t(successKey));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-plans-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="place-plans-title" className="text-base font-semibold text-ink dark:text-ink-dark">
          {t("places.plans.title")}
        </h2>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand hover:bg-th-brand-hover"
          >
            {t("places.plans.create")}
          </button>
        )}
      </div>

      {creating && (
        <CreatePlanForm
          placeId={placeId}
          onCancel={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            toast.success(t("places.plans.created"));
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
      {state.status === "ready" && state.plans.length === 0 && !creating && (
        <p className="mt-3 text-sm text-muted">{t("places.plans.empty")}</p>
      )}

      <ul className="mt-3 space-y-3">
        {state.plans.map((plan) => {
          const mine = plan.creator.id === user.id;
          const busy = busyId === plan.id;
          return (
            <li key={plan.id} className="rounded-xl border border-line p-3 dark:border-line-dark">
              <p className="text-sm font-semibold text-ink dark:text-ink-dark">{plan.title}</p>
              <p className="text-xs text-muted">
                {new Date(plan.starts_at).toLocaleString()}
                {plan.status === "cancelled" && ` · ${t("places.plans.cancelled")}`}
              </p>
              {plan.note && (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink dark:text-ink-dark">{plan.note}</p>
              )}
              <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("places.plans.members")}>
                {plan.members.map((member) => (
                  <li key={member.id} className="flex items-center gap-1 text-xs text-muted">
                    <Avatar name={member.name} photo={member.avatar_url} size="w-6 h-6" />
                    <span>
                      {member.name} · {t(`places.plans.status.${member.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
              {plan.status === "active" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {!mine && plan.my_status !== "going" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(plan, () => respondToPlan(plan.id, "going"), "places.plans.going")}
                      className="rounded-full bg-th-brand px-3 py-1.5 text-xs font-semibold text-th-on-brand disabled:opacity-50"
                    >
                      {t("places.plans.accept")}
                    </button>
                  )}
                  {!mine && plan.my_status !== "declined" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(plan, () => respondToPlan(plan.id, "declined"), "places.plans.declined")}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink dark:text-ink-dark"
                    >
                      {t("places.plans.decline")}
                    </button>
                  )}
                  {!mine && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(plan, () => leavePlan(plan.id, user.id), "places.plans.left")}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-th-danger-fg disabled:opacity-50"
                    >
                      {t("places.plans.leave")}
                    </button>
                  )}
                  {mine && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(plan, () => cancelPlan(plan.id), "places.plans.cancelDone")}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-th-danger-fg disabled:opacity-50"
                    >
                      {t("places.plans.cancel")}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CreatePlanForm({ placeId, onCancel, onCreated }) {
  const { t } = useLanguage();
  const [friends, setFriends] = useState(null);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchFriends(controller.signal)
      .then(setFriends)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(getErrorMessage(err, t));
          setFriends([]);
        }
      });
    return () => controller.abort();
  }, [t]);

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  async function submit(event) {
    event.preventDefault();
    const startsAt = toIso(when);
    if (!title.trim() || !startsAt || sending) return;
    setSending(true);
    setError("");
    try {
      await createPlan(placeId, { title: title.trim(), startsAt, note: note.trim(), userIds: selected });
      await onCreated();
    } catch (err) {
      setError(getErrorMessage(err, t));
      setSending(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark";

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-ink dark:text-ink-dark">{t("places.plans.titleLabel")}</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required className={inputClass} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-ink dark:text-ink-dark">{t("places.plans.whenLabel")}</span>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required className={inputClass} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-ink dark:text-ink-dark">{t("places.plans.noteLabel")}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={inputClass} />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-ink dark:text-ink-dark">{t("places.plans.invite")}</legend>
        {friends === null && <Spinner />}
        {friends && friends.length === 0 && <p className="text-sm text-muted">{t("places.plans.noFriends")}</p>}
        {friends && friends.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {friends.map((friend) => (
              <li key={friend.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-canvas dark:hover:bg-canvas-dark">
                  <input type="checkbox" checked={selected.includes(friend.id)} onChange={() => toggle(friend.id)} />
                  <Avatar name={friend.name} photo={friend.avatar_url} size="w-7 h-7" />
                  <span className="truncate text-sm text-ink dark:text-ink-dark">{friend.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-th-danger-fg">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={sending} className="rounded-full px-4 py-2 text-sm font-semibold text-ink dark:text-ink-dark">
          {t("places.report.cancel")}
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !when || sending}
          className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand hover:bg-th-brand-hover disabled:opacity-50"
        >
          {sending ? t("places.plans.creating") : t("places.plans.submit")}
        </button>
      </div>
    </form>
  );
}
