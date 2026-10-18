import { useCallback, useEffect, useState } from "react";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { fetchManagePanel, updateManagedPlace } from "../lib/placesApi";
import ManageAnalytics from "./ManageAnalytics";
import ManageImage from "./ManageImage";
import ManageReservations from "./ManageReservations";

const STAT_KEYS = ["saves", "reviews", "reviews_without_reply", "upcoming_plans"];

/**
 * Panel de negocio (ADR-040 fase 7): cifras del lugar y edición de descripción, dirección,
 * teléfono y sitio web. Solo se muestra a quien gestiona el lugar; el servidor lo vuelve a
 * comprobar. Nombre, categoría y ubicación siguen siendo de moderación.
 */
export default function PlaceManagePanel({ placeId, onUpdated }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [state, setState] = useState({ status: "loading" });
  const [form, setForm] = useState({ description: "", address: "", phone: "", website: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    (signal) =>
      fetchManagePanel(placeId, signal)
        .then((panel) => {
          setState({ status: "ready", stats: panel.stats, imageUrl: panel.place.cover_image_url ?? null });
          setForm({
            description: panel.place.description ?? "",
            address: panel.place.address ?? "",
            phone: panel.place.phone ?? "",
            website: panel.place.website ?? "",
          });
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

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateManagedPlace(placeId, form);
      toast.success(t("places.manage.saved"));
      onUpdated?.();
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") return <Spinner className="mt-4" />;
  if (state.status === "error") {
    return (
      <p role="alert" className="mt-4 text-sm text-th-danger-fg">
        {state.error}
      </p>
    );
  }

  const field = "mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 dark:border-line-dark";
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <section className="mt-6 border-t border-line pt-4 dark:border-line-dark" aria-labelledby="place-manage-title">
      <h2 id="place-manage-title" className="text-base font-semibold text-ink dark:text-ink-dark">
        {t("places.manage.title")}
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        {STAT_KEYS.map((key) => (
          <div key={key} className="rounded-lg border border-line p-2 dark:border-line-dark">
            <dt className="text-xs text-muted">{t(`places.manage.stats.${key}`)}</dt>
            <dd className="font-semibold text-ink dark:text-ink-dark">{state.stats[key]}</dd>
          </div>
        ))}
      </dl>
      <ManageImage
        placeId={placeId}
        imageUrl={state.imageUrl}
        onChanged={() => {
          onUpdated?.();
          load();
        }}
      />
      <form onSubmit={submit} className="mt-3 space-y-3">
        <label className="block text-sm text-ink dark:text-ink-dark">
          {t("places.manage.description")}
          <textarea value={form.description} onChange={set("description")} maxLength={2000} rows={3} className={field} />
        </label>
        <label className="block text-sm text-ink dark:text-ink-dark">
          {t("places.manage.address")}
          <input value={form.address} onChange={set("address")} maxLength={255} className={field} />
        </label>
        <label className="block text-sm text-ink dark:text-ink-dark">
          {t("places.manage.phone")}
          <input value={form.phone} onChange={set("phone")} maxLength={40} inputMode="tel" className={field} />
        </label>
        <label className="block text-sm text-ink dark:text-ink-dark">
          {t("places.manage.website")}
          <input value={form.website} onChange={set("website")} maxLength={255} inputMode="url" className={field} />
        </label>
        <p className="text-xs text-muted">{t("places.manage.moderationNote")}</p>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-th-brand px-4 py-2 text-sm font-semibold text-th-on-brand hover:bg-th-brand-hover disabled:opacity-50"
        >
          {saving ? t("places.manage.saving") : t("places.manage.save")}
        </button>
      </form>
      <ManageAnalytics placeId={placeId} />
      <ManageReservations placeId={placeId} onChanged={onUpdated} />
    </section>
  );
}
