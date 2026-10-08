import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { useLanguage } from "@shared/i18n";

const ICONS = { offline: "cloud_off", error: "error", empty: "search_off" };

/**
 * Estados vacíos de la lista (encargo §25): loading, offline, error y empty.
 * `success` no pasa por aquí: la página pinta las tarjetas.
 */
export default function PlacesStateView({ state, message, isSearch, onRetry }) {
  const { t } = useLanguage();

  if (state === "loading") {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-10 text-sm text-muted dark:text-muted-dark">
        <Spinner />
        {t("places.state.loading")}
      </div>
    );
  }

  const title =
    state === "offline"
      ? t("places.state.offlineTitle")
      : state === "error"
        ? t("places.state.errorTitle")
        : isSearch
          ? t("places.state.emptySearchTitle")
          : t("places.state.emptyTitle");
  const body =
    state === "offline"
      ? t("places.state.offlineBody")
      : state === "error"
        ? message
        : isSearch
          ? t("places.state.emptySearchBody")
          : t("places.state.emptyBody");

  return (
    <div role={state === "empty" ? "status" : "alert"} className="flex flex-col items-center gap-2 py-10 text-center">
      <Icon name={ICONS[state]} size={36} className="text-muted dark:text-muted-dark" />
      <h3 className="text-sm font-semibold text-ink dark:text-ink-dark">{title}</h3>
      {body && <p className="max-w-xs text-xs text-muted dark:text-muted-dark">{body}</p>}
      {(state === "error" || state === "offline") && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-on-brand hover:bg-brand-hover"
        >
          {t("places.state.retry")}
        </button>
      )}
    </div>
  );
}
