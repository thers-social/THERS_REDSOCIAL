import Icon from "@shared/components/Icon";
import { useLanguage } from "@shared/i18n";
import { formatDistance } from "../lib/coordinates";

/** Tarjeta de resultado. Toda la tarjeta es un botón: seleccionar centra el mapa y abre la ficha. */
export default function PlaceCard({ place, selected, onSelect }) {
  const { t } = useLanguage();
  const distance = Number.isFinite(place.distance_meters) ? formatDistance(place.distance_meters) : "";

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(place.id)}
        aria-pressed={selected}
        className={`w-full text-left rounded-[20px] border p-4 transition-colors bg-surface dark:bg-surface-dark ${
          selected
            ? "border-brand shadow-soft"
            : "border-line dark:border-line-dark hover:border-brand-soft-strong"
        }`}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-fg">
            <Icon name="location_on" size={20} fill={selected ? 1 : 0} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-ink dark:text-ink-dark">{place.name}</h3>
              {place.is_saved && (
                <Icon name="bookmark" size={18} fill={1} className="shrink-0 text-brand" label={t("places.saved.badge")} />
              )}
            </div>
            <p className="text-xs text-muted dark:text-muted-dark">{place.category.name}</p>
            {place.address && (
              <p className="mt-1 truncate text-xs text-muted dark:text-muted-dark">{place.address}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {distance && (
                <span className="font-semibold text-ink dark:text-ink-dark">{distance}</span>
              )}
              {place.verification_status === "verified" && (
                <span className="inline-flex items-center gap-1 text-success-fg">
                  <Icon name="verified" size={14} fill={1} />
                  {t("places.verified")}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}
