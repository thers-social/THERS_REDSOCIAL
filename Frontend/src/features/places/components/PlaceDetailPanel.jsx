import { useEffect, useState } from "react";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { useAuth } from "@features/auth/context/AuthContext";
import { savePlace, unsavePlace } from "../lib/placesApi";
import PlacePlans from "./PlacePlans";
import PlacePulse from "./PlacePulse";
import PlaceRoute from "./PlaceRoute";
import { trackPlaceVisit } from "../lib/placeVisits";
import PlaceClaim from "./PlaceClaim";
import PlaceManagePanel from "./PlaceManagePanel";
import PlaceReservations from "./PlaceReservations";
import PlaceQuote from "./PlaceQuote";
import PlacePosts from "./PlacePosts";
import PlaceReviews from "./PlaceReviews";
import ReportPlaceDialog from "./ReportPlaceDialog";
import SharePlaceDialog from "./SharePlaceDialog";

// El backend ya solo guarda http(s), pero un enlace que se pinta como <a href> se valida
// también aquí: nunca confiar en el dato.
function safeWebsite(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

function Row({ icon, children }) {
  return (
    <li className="flex items-start gap-3 text-sm text-ink dark:text-ink-dark">
      <Icon name={icon} size={18} className="mt-0.5 shrink-0 text-muted dark:text-muted-dark" />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

/**
 * Ficha del lugar. Solo muestra lo que el backend respalda (reseñas reales; nada de horarios o
 * fotos inventados). `status` viene de `usePlaceDetail`.
 */
export default function PlaceDetailPanel({ status, place, error, onBack, onRetry, onSavedChange, onRouteChange, onStepFocus }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const placeId = place?.id;

  // Visita anónima (ADR-040 §33): una vez por lugar y carga de página. No guarda quién.
  useEffect(() => {
    if (placeId) trackPlaceVisit(placeId, "view");
  }, [placeId]);

  async function toggleSaved() {
    if (saving) return;
    const next = !place.is_saved;
    setSaving(true);
    onSavedChange(next); // optimista: se revierte si falla
    try {
      await (next ? savePlace(place.id) : unsavePlace(place.id));
      toast.success(next ? t("places.saved.added") : t("places.saved.removed"));
    } catch (err) {
      onSavedChange(!next);
      toast.error(getErrorMessage(err, t));
    } finally {
      setSaving(false);
    }
  }

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-th-brand-fg hover:underline"
    >
      <Icon name="arrow_back" size={18} />
      {t("places.detail.back")}
    </button>
  );

  if (status === "loading" || status === "idle" || !place) {
    return (
      <div>
        {back}
        <div role="status" className="flex items-center justify-center gap-3 py-10 text-sm text-muted dark:text-muted-dark">
          <Spinner />
          {t("places.state.loading")}
        </div>
      </div>
    );
  }

  if (status === "not_found" || status === "error") {
    return (
      <div>
        {back}
        <div role="alert" className="py-8 text-center">
          <Icon name={status === "not_found" ? "location_off" : "error"} size={36} className="text-muted dark:text-muted-dark" />
          <p className="mt-2 text-sm font-semibold text-ink dark:text-ink-dark">
            {status === "not_found" ? t("places.detail.notFound") : error}
          </p>
          {status === "error" && (
            <button type="button" onClick={onRetry} className="mt-3 rounded-full bg-th-brand px-4 py-2 text-xs font-semibold text-th-on-brand">
              {t("places.state.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const website = safeWebsite(place.website);
  const area = [place.municipality, place.department].filter(Boolean).join(", ");

  return (
    <article>
      {back}
      {place.cover_image_url && (
        // Imagen que identifica al lugar (ADR-046).
        <img
          src={place.cover_image_url}
          alt={t("places.detail.imageAlt", { name: place.name })}
          loading="lazy"
          decoding="async"
          className="mb-3 max-h-56 w-full rounded-2xl border border-line object-cover dark:border-line-dark"
        />
      )}
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-ink dark:text-ink-dark">{place.name}</h2>
        <p className="text-sm text-muted dark:text-muted-dark">{place.category.name}</p>
        {place.verification_status === "unverified" && (
          <p className="text-xs text-muted dark:text-muted-dark">
            {t("places.unverifiedNotice")}
            {place.source === "osm" && ` ${t("places.osmAttribution")}`}
          </p>
        )}
        {place.verification_status === "verified" && (
          <p className="inline-flex items-center gap-1 text-xs font-semibold text-th-success-fg">
            <Icon name="verified" size={16} fill={1} />
            {t("places.verified")}
            {place.last_verified_at && (
              <span className="font-normal text-muted dark:text-muted-dark">
                {" · "}
                {t("places.detail.verifiedOn", {
                  date: new Date(place.last_verified_at).toLocaleDateString(),
                })}
              </span>
            )}
          </p>
        )}
        <PlacePulse placeId={place.id} />
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggleSaved}
          disabled={saving}
          aria-pressed={place.is_saved}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            place.is_saved
              ? "bg-th-brand text-th-on-brand hover:bg-th-brand-hover"
              : "border border-line text-ink hover:border-th-brand dark:border-line-dark dark:text-ink-dark"
          }`}
        >
          <Icon name="bookmark" size={18} fill={place.is_saved ? 1 : 0} />
          {place.is_saved ? t("places.saved.saved") : t("places.saved.save")}
        </button>
        {user && (
          <button
            type="button"
            onClick={() => setSharing(true)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-th-brand dark:border-line-dark dark:text-ink-dark"
          >
            <Icon name="send" size={18} />
            {t("places.share.open")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setReporting(true)}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-th-brand dark:border-line-dark dark:text-ink-dark"
        >
          <Icon name="flag" size={18} />
          {t("places.report.open")}
        </button>
      </div>

      {place.description && (
        <p className="mt-4 whitespace-pre-wrap break-words text-sm text-ink dark:text-ink-dark">{place.description}</p>
      )}

      <ul className="mt-4 space-y-3">
        {place.address && <Row icon="location_on">{place.address}</Row>}
        {area && <Row icon="map">{area}</Row>}
        {place.phone && (
          <Row icon="call">
            <a
              href={`tel:${place.phone.replace(/[^0-9+]/g, "")}`}
              onClick={() => trackPlaceVisit(place.id, "phone")}
              className="text-th-brand-fg hover:underline"
            >
              {place.phone}
            </a>
          </Row>
        )}
        {website && (
          <Row icon="language">
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackPlaceVisit(place.id, "website")}
              className="text-th-brand-fg hover:underline"
            >
              {website.replace(/^https?:\/\//i, "")}
            </a>
          </Row>
        )}
      </ul>

      <PlaceRoute place={place} onRouteChange={onRouteChange} onStepFocus={onStepFocus} />
      <PlacePlans placeId={place.id} />
      <PlaceReservations place={place} />
      <PlaceQuote placeId={place.id} />
      <PlaceClaim place={place} />
      {place.managed_by_me && <PlaceManagePanel placeId={place.id} />}

      <PlacePosts placeId={place.id} />

      <PlaceReviews placeId={place.id} canReply={Boolean(place.managed_by_me)} />

      {sharing && (
        <SharePlaceDialog
          place={place}
          onClose={() => setSharing(false)}
          onShared={(person) => {
            setSharing(false);
            toast.success(t("places.share.done", { name: person.name }));
          }}
        />
      )}

      {reporting && (
        <ReportPlaceDialog
          place={place}
          onClose={() => setReporting(false)}
          onReported={() => {
            setReporting(false);
            toast.success(t("places.report.thanks"));
          }}
        />
      )}
    </article>
  );
}
