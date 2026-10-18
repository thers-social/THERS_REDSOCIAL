import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";
import Avatar from "@shared/components/Avatar";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import CapsuleCard from "../components/CapsuleCard";
import ConnectionsDialog from "../components/ConnectionsDialog";
import { websiteHref } from "../lib/profileStorage";
import { fetchPostsByAuthor, fetchPublicProfile, followLabel, profileUrl, setFollow } from "../lib/socialApi";

// Perfil de OTRA persona (ADR-049): se llega tocando su foto o su nombre en una publicación, en una
// lista de seguidores o en una sugerencia. Muestra lo público (nunca correo, teléfono ni fecha de
// nacimiento) y la relación con quien mira: Seguir, Mensaje y Compartir, como en Instagram.
// En una cuenta privada que no sigues se ve el perfil pero no sus publicaciones; el servidor lo aplica.
export default function UserProfile() {
  const { userId } = useParams();
  const {
    currentUser,
    allCapsules,
    adoptCapsules,
    onToggleLike,
    onLoadComments,
    onPostComment,
    onDeleteComment,
    onEditComment,
    onToggleFollowAuthor,
    onDeleteCapsule,
    onEditCapsule,
  } = useOutletContext();
  const toast = useToast();
  const { t } = useLanguage();

  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState(null); // null | "followers" | "following"

  const load = useCallback(
    async (signal) => {
      try {
        const loaded = await fetchPublicProfile(userId, signal);
        setProfile(loaded);
        setError(null);
        const list = loaded.can_view_posts ? await fetchPostsByAuthor(userId, signal) : [];
        setPosts(list);
        adoptCapsules(list);
      } catch (err) {
        if (signal?.aborted) return;
        setError({ notFound: err?.response?.status === 404, message: getErrorMessage(err, t) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, t]
  );

  useEffect(() => {
    setProfile(null);
    setPosts(null);
    setError(null);
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Estado "vivo" de cada publicación (me gusta, comentarios) desde la lista del AppShell.
  const live = useMemo(() => new Map(allCapsules.map((c) => [c.id, c])), [allCapsules]);
  const shown = useMemo(() => (posts ?? []).map((p) => live.get(p.id) ?? p), [posts, live]);

  if (userId === currentUser.id) return <Navigate to="/profile" replace />;

  async function toggleFollow() {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await setFollow(profile.id, profile.follow_status === null);
      // Recarga: seguir una cuenta privada solo la solicita, y una pública deja ver más.
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const url = profileUrl(profile.id);
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile.name} (@${profile.username}) en THERS`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Enlace del perfil copiado");
    } catch (err) {
      if (err?.name !== "AbortError") toast.error("No se pudo compartir el perfil");
    }
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2 py-20 text-center">
        <Icon name="person_off" size={28} className="text-th-fg-subtle" />
        <p className="text-label-lg font-bold text-th-fg-strong">
          {error.notFound ? "Este perfil no está disponible" : "No se pudo cargar el perfil"}
        </p>
        {!error.notFound && <p className="text-body-md text-th-fg-muted">{error.message}</p>}
        <Link to="/feed" className="mt-2 text-label-lg font-semibold text-th-brand-fg hover:underline">
          Volver al inicio
        </Link>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex justify-center py-20" role="status">
        <Spinner />
      </div>
    );
  }

  const href = websiteHref(profile.website);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-4">
      <div className="h-40 overflow-hidden rounded-th-card border border-th-border bg-th-surface-subtle sm:h-52">
        {profile.cover_url && (
          <img src={profile.cover_url} alt={`Portada de ${profile.name}`} className="h-full w-full object-cover" />
        )}
      </div>

      <div className="relative z-10 -mt-16 px-2 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-end">
            <div className="shrink-0 rounded-th-pill ring-4 ring-th-bg">
              <Avatar name={profile.name} photo={profile.avatar_url} size="w-28 h-28 text-3xl" />
            </div>
            <div className="flex min-w-0 flex-col gap-1 pb-1">
              <h1 className="truncate text-headline-md text-th-fg-strong sm:text-headline-lg">{profile.name}</h1>
              <p className="truncate text-body-md text-th-fg-muted">
                @{profile.username}
                {profile.is_private ? " · Cuenta privada" : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={toggleFollow}
              disabled={busy}
              aria-pressed={profile.follow_status === "accepted"}
              className={`inline-flex min-h-[44px] items-center justify-center rounded-th-input px-5 py-2.5 text-label-lg font-bold transition-colors th-focus-ring disabled:opacity-60 ${
                profile.follow_status
                  ? "border border-th-border bg-th-surface text-th-fg hover:bg-th-surface-subtle"
                  : "bg-th-brand text-th-on-brand hover:bg-th-brand-hover"
              }`}
            >
              {followLabel(profile.follow_status, profile.is_private)}
            </button>
            <Link
              to={`/messages?to=${profile.id}&name=${encodeURIComponent(profile.name)}&username=${encodeURIComponent(profile.username)}`}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-th-input border border-th-border bg-th-surface px-5 py-2.5 text-label-lg font-semibold text-th-fg th-focus-ring hover:bg-th-surface-subtle"
            >
              <Icon name="mail" size={18} />
              Mensaje
            </Link>
            <button
              type="button"
              onClick={share}
              aria-label="Compartir perfil"
              className="inline-flex h-11 w-11 items-center justify-center rounded-th-input border border-th-border bg-th-surface text-th-fg-muted th-focus-ring hover:bg-th-surface-subtle"
            >
              <Icon name="ios_share" size={18} />
            </button>
          </div>
        </div>

        <div className="mt-5 flex max-w-3xl flex-col gap-3">
          {profile.bio && <p className="text-body-lg text-th-fg">{profile.bio}</p>}
          {(profile.location || href) && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm text-th-fg-muted">
              {profile.location && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="location_on" size={16} />
                  {profile.location}
                </span>
              )}
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1.5 text-th-brand-fg th-focus-ring hover:underline"
                >
                  <Icon name="link" size={16} />
                  <span className="[overflow-wrap:anywhere]">{profile.website}</span>
                </a>
              )}
            </div>
          )}

          <dl className="mt-1 flex flex-wrap items-center gap-x-8 gap-y-3">
            <Stat value={profile.can_view_posts ? shown.length : "–"} label="Publicaciones" />
            <Stat
              value={profile.followers_count}
              label="Seguidores"
              onClick={() => setConnections("followers")}
            />
            <Stat
              value={profile.following_count}
              label="Siguiendo"
              onClick={() => setConnections("following")}
            />
          </dl>
        </div>
      </div>

      {!profile.can_view_posts ? (
        <div className="flex flex-col items-center gap-2 rounded-th-card border border-dashed border-th-border bg-th-surface px-6 py-14 text-center">
          <Icon name="lock" size={26} className="text-th-fg-subtle" />
          <p className="text-label-lg font-bold text-th-fg-strong">Esta cuenta es privada</p>
          <p className="max-w-md text-body-md text-th-fg-muted">Sigue a esta cuenta para ver sus publicaciones.</p>
        </div>
      ) : posts === null ? (
        <div className="flex justify-center py-10" role="status">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-th-card border border-dashed border-th-border bg-th-surface px-6 py-14 text-center">
          <Icon name="auto_awesome" size={26} className="text-th-fg-subtle" />
          <p className="text-label-lg font-bold text-th-fg-strong">Todavía no ha publicado nada reciente</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {shown.map((capsule) => (
            <CapsuleCard
              key={capsule.id}
              capsule={capsule}
              currentUserId={currentUser.id}
              onToggleLike={onToggleLike}
              onLoadComments={onLoadComments}
              onPostComment={onPostComment}
              onDeleteComment={onDeleteComment}
              onEditComment={onEditComment}
              onToggleFollowAuthor={onToggleFollowAuthor}
              onDeleteCapsule={onDeleteCapsule}
              onEditCapsule={onEditCapsule}
            />
          ))}
        </div>
      )}

      {connections && (
        <ConnectionsDialog
          userId={profile.id}
          username={profile.username}
          initialTab={connections}
          onClose={() => setConnections(null)}
        />
      )}
    </div>
  );
}

function Stat({ value, label, onClick }) {
  const body = (
    <>
      <span className="text-headline-sm font-bold tabular-nums text-th-fg-strong">
        {typeof value === "number" ? value.toLocaleString("es") : value}
      </span>
      <span className="text-body-sm text-th-fg-muted">{label}</span>
    </>
  );
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd>
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            aria-label={`Ver ${label.toLowerCase()}, ${value}`}
            className="flex items-baseline gap-1.5 rounded-th-sm th-focus-ring hover:underline"
          >
            {body}
          </button>
        ) : (
          <span className="flex items-baseline gap-1.5">{body}</span>
        )}
      </dd>
    </div>
  );
}
