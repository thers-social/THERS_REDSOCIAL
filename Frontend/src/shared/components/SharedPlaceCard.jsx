import { Link } from "react-router-dom";
import Icon from "@shared/components/Icon";
import { useLanguage } from "@shared/i18n";

/**
 * Tarjeta de un lugar compartido en el chat (ADR-040 fase 4c). `place` es el objeto
 * `message.place` del contrato: nunca trae coordenadas ni teléfono. Si el lugar ya no es
 * público (`available: false`) solo se dice eso. El texto del lugar se pinta como texto
 * de React, nunca como HTML. `mine` solo cambia los colores para la burbuja propia.
 */
export default function SharedPlaceCard({ place, mine = false }) {
  const { t } = useLanguage();
  const tone = mine ? "border-white/30 bg-white/10 text-white" : "border-line bg-surface text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark";

  if (!place.available) {
    return (
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}>
        <Icon name="location_off" size={18} />
        {t("places.share.unavailable")}
      </div>
    );
  }

  const area = [place.municipality, place.department].filter(Boolean).join(", ");
  return (
    <Link
      to={`/places/${place.id}`}
      className={`flex items-center gap-3 rounded-xl border px-3 py-2 no-underline hover:opacity-90 ${tone}`}
    >
      <Icon name="location_on" size={22} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{place.name}</span>
        <span className="block truncate text-xs opacity-80">
          {[place.category?.name, area].filter(Boolean).join(" · ")}
        </span>
      </span>
    </Link>
  );
}
