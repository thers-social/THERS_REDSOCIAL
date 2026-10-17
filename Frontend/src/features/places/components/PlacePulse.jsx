import { useEffect, useState } from "react";
import Icon from "@shared/components/Icon";
import { useLanguage } from "@shared/i18n";
import { fetchPlacePulse } from "../lib/placesApi";

const LEVELS = new Set(["moving", "active", "buzzing"]);

/**
 * Pulse del lugar (ADR-040 §32): una etiqueta de actividad reciente, nunca una cifra ni quién.
 * Si el servidor no devuelve nivel (poca actividad) o falla, no se pinta nada: el Pulse es un
 * extra, no una condición de la ficha.
 */
export default function PlacePulse({ placeId }) {
  const { t } = useLanguage();
  const [level, setLevel] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setLevel(null);
    fetchPlacePulse(placeId, controller.signal)
      .then((pulse) => setLevel(LEVELS.has(pulse?.level) ? pulse.level : null))
      .catch(() => {});
    return () => controller.abort();
  }, [placeId]);

  if (!level) return null;
  return (
    <p
      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-th-brand"
      title={t("places.pulse.hint")}
    >
      <Icon name="local_fire_department" size={16} fill={1} />
      {t("places.pulse.title")}: {t(`places.pulse.${level}`)}
    </p>
  );
}
