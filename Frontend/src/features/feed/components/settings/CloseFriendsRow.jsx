import { useEffect, useMemo, useState } from "react";
import Avatar from "@shared/components/Avatar";
import Spinner from "@shared/components/Spinner";
import { getErrorMessage } from "@shared/lib/api";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import { fetchConnections } from "../../lib/socialApi";
import { addCloseFriend, fetchCloseFriends, removeCloseFriend } from "../../lib/closeFriendsApi";

// Lista de mejores amigos (GET/POST/DELETE /api/close-friends — ADR-054). Solo estas personas ven
// las historias y publicaciones marcadas «Mejores amigos». Nadie recibe aviso al añadirla ni al quitarla.
// Vive en Configuración › Privacidad, junto a la cuenta privada, que es el otro control de quién ve qué.

export default function CloseFriendsRow({ currentUser }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [friends, setFriends] = useState(null);
  const [followers, setFollowers] = useState([]);
  const [limit, setLimit] = useState(null);
  const [disabled, setDisabled] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchCloseFriends();
        if (cancelled) return;
        setFriends(data.friends);
        setLimit(data.limit);
        // Seguidores a quienes añadir: solo se pide si el módulo está encendido.
        if (currentUser?.id) {
          const page = await fetchConnections(currentUser.id, "followers", 0);
          if (!cancelled) setFollowers(page.users);
        }
      } catch (error) {
        if (cancelled) return;
        // 404 = el módulo (STORIES_ENABLED) está apagado en el servidor: la fila no aplica.
        if (error?.response?.status === 404) setDisabled(true);
        else toast.error(getErrorMessage(error, t));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const memberIds = useMemo(() => new Set((friends ?? []).map((friend) => friend.id)), [friends]);
  const needle = query.trim().toLowerCase();
  const matches = (person) =>
    !needle || person.name.toLowerCase().includes(needle) || person.username.toLowerCase().includes(needle);
  const addable = followers.filter((person) => !memberIds.has(person.id) && matches(person));
  const listed = (friends ?? []).filter(matches);
  const full = limit !== null && (friends ?? []).length >= limit;

  async function toggle(person, add) {
    if (busyId) return;
    setBusyId(person.id);
    try {
      if (add) {
        await addCloseFriend(person.id);
        setFriends((current) => [{ ...person, added_at: new Date().toISOString() }, ...(current ?? [])]);
      } else {
        await removeCloseFriend(person.id);
        setFriends((current) => (current ?? []).filter((friend) => friend.id !== person.id));
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setBusyId(null);
    }
  }

  if (disabled) return null;

  if (friends === null) {
    return (
      <div className="flex items-center gap-2 py-4 text-th-fg-muted" role="status">
        <Spinner size={16} />
        <span className="text-body-sm">{t("closeFriends.loading")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex flex-col gap-1">
        <span className="text-label-lg font-semibold text-th-fg-strong">
          {t("closeFriends.title")} ({friends.length})
        </span>
        <p className="text-body-sm text-th-fg-muted">{t("closeFriends.intro")}</p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("closeFriends.search")}
        aria-label={t("closeFriends.search")}
        className="min-h-[40px] rounded-th-input border border-th-border bg-th-surface-subtle px-3 py-2 text-body-md text-th-fg th-focus-ring"
      />

      <PersonList
        title={t("closeFriends.yourList")}
        empty={friends.length === 0 ? t("closeFriends.empty") : t("closeFriends.noMatches")}
        people={listed}
        busyId={busyId}
        actionLabel={t("closeFriends.remove")}
        actionAria={(person) => t("closeFriends.removeAria", { name: person.name })}
        onAction={(person) => toggle(person, false)}
      />

      <PersonList
        title={t("closeFriends.followers")}
        empty={followers.length === 0 ? t("closeFriends.followersEmpty") : null}
        people={addable}
        busyId={busyId}
        actionLabel={t("closeFriends.add")}
        actionAria={(person) => t("closeFriends.addAria", { name: person.name })}
        onAction={(person) => toggle(person, true)}
        primary
        disableAction={full}
        note={full ? t("closeFriends.full", { limit }) : null}
      />
    </div>
  );
}

function PersonList({ title, empty, people, busyId, actionLabel, actionAria, onAction, primary, disableAction, note }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-label-md font-bold uppercase tracking-wide text-th-fg-subtle">{title}</h4>
      {note && <p className="text-body-sm text-th-fg-muted">{note}</p>}
      {people.length === 0 && empty && <p className="text-body-sm text-th-fg-muted">{empty}</p>}
      <ul className="flex flex-col gap-2">
        {people.map((person) => (
          <li
            key={person.id}
            className="flex items-center gap-3 rounded-th-card bg-th-surface-subtle px-3 py-2.5"
          >
            <Avatar name={person.name} photo={person.avatar_url} size="w-9 h-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-label-md font-bold text-th-fg-strong">{person.name}</p>
              <p className="truncate text-body-sm text-th-fg-muted">@{person.username}</p>
            </div>
            <button
              type="button"
              onClick={() => onAction(person)}
              disabled={busyId !== null || disableAction}
              aria-label={actionAria(person)}
              className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-th-pill px-3.5 py-1.5 text-label-md font-bold transition-colors th-focus-ring disabled:opacity-40 ${
                primary
                  ? "bg-th-brand text-th-on-brand hover:bg-th-brand-hover"
                  : "border border-th-border text-th-fg-muted hover:bg-th-surface-raised"
              }`}
            >
              {busyId === person.id ? <Spinner size={14} /> : actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
