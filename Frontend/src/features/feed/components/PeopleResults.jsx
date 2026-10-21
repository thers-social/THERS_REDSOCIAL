import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@shared/components/Avatar";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { followLabel, searchUsers, setFollow } from "../lib/socialApi";

/**
 * Personas que coinciden con la búsqueda, por nombre o por @usuario, hayan publicado o no.
 * Viene del servidor (`GET /api/users/search`, API_CONTRACT.md §4.15): a diferencia de las
 * publicaciones, no se filtra sobre lo ya cargado. `limit` recorta la lista en el ámbito «Todos».
 */
export default function PeopleResults({ query, limit = 20, showEmpty = false }) {
  const toast = useToast();
  const needle = query.trim();
  const [people, setPeople] = useState(null); // null = cargando
  const [failed, setFailed] = useState(false);
  // `accepted`/`pending` por id; ausente = no sigue (la búsqueda no trae la relación).
  const [following, setFollowing] = useState({});

  useEffect(() => {
    if (!needle) return undefined;
    const controller = new AbortController();
    setPeople(null);
    setFailed(false);
    searchUsers(needle, limit, controller.signal)
      .then(setPeople)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [needle, limit]);

  async function toggle(person) {
    const current = following[person.id];
    try {
      const result = await setFollow(person.id, !current);
      setFollowing((state) => {
        const next = { ...state };
        if (result.follow_status) next[person.id] = result.follow_status;
        else delete next[person.id];
        return next;
      });
    } catch {
      toast.error("No se pudo actualizar el seguimiento");
    }
  }

  if (!needle) return null;
  if (failed) {
    return <p role="alert" className="text-body-sm text-th-fg-muted">No pudimos buscar personas ahora.</p>;
  }
  if (people === null) {
    return (
      <div className="flex items-center gap-2 text-th-fg-muted" role="status">
        <Spinner size={16} />
        <span className="text-body-sm">Buscando personas…</span>
      </div>
    );
  }
  if (people.length === 0) {
    return showEmpty ? (
      <p className="rounded-th-card border border-dashed border-th-border bg-th-surface px-6 py-10 text-center text-body-md text-th-fg-muted">
        No encontramos personas con «{needle}».
      </p>
    ) : null;
  }

  return (
    <section aria-label="Personas" className="flex flex-col gap-3">
      <h2 className="text-headline-sm text-th-fg-strong">Personas</h2>
      <ul className="flex flex-col gap-2">
        {people.map((person) => (
          <li
            key={person.id}
            className="flex items-center gap-3 rounded-th-card border border-th-border bg-th-surface p-3 shadow-th-card"
          >
            <Link to={`/user/${person.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={person.name || person.username} photo={person.avatar_url} size="w-11 h-11" />
              <span className="min-w-0">
                <span className="block truncate text-label-lg font-bold text-th-fg-strong">{person.name}</span>
                <span className="block truncate text-body-sm text-th-fg-muted">@{person.username}</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => toggle(person)}
              className={`shrink-0 rounded-th-pill border px-4 py-1.5 text-label-md font-bold th-focus-ring ${
                following[person.id]
                  ? "border-th-border bg-th-surface-subtle text-th-fg-muted"
                  : "border-th-brand text-th-brand-fg hover:bg-th-brand-soft"
              }`}
            >
              {followLabel(following[person.id], person.is_private)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
