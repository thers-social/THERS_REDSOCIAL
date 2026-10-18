import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@shared/components/Avatar";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { fetchSuggestions, followLabel, setFollow } from "../lib/socialApi";

/**
 * Barra horizontal de cuentas sugeridas (ADR-052), la que se abre desde el perfil como en Instagram.
 * Cada tarjeta lleva al perfil, permite seguir y se puede descartar con la ✕ (solo aquí: el servidor no
 * guarda descartes).
 */
export default function SuggestedBar({ onClose }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [people, setPeople] = useState(null);
  const [failed, setFailed] = useState(false);
  const [statuses, setStatuses] = useState({});

  useEffect(() => {
    const controller = new AbortController();
    fetchSuggestions(15, controller.signal)
      .then(setPeople)
      .catch(() => !controller.signal.aborted && setFailed(true));
    return () => controller.abort();
  }, []);

  async function toggle(person) {
    const current = statuses[person.id] ?? null;
    try {
      const result = await setFollow(person.id, current === null);
      setStatuses((previous) => ({ ...previous, [person.id]: result.follow_status ?? null }));
    } catch (err) {
      toast.error(getErrorMessage(err, t));
    }
  }

  return (
    <section
      aria-label="Sugerencias para ti"
      className="rounded-th-card border border-th-border bg-th-surface p-4 shadow-th-card"
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-label-lg font-bold text-th-fg-strong">Sugerencias para ti</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar sugerencias"
          className="rounded-th-pill p-1 text-th-fg-muted th-focus-ring hover:bg-th-surface-subtle"
        >
          <Icon name="close" size={18} />
        </button>
      </header>

      {people === null && !failed && (
        <div className="flex justify-center py-6" role="status">
          <Spinner />
        </div>
      )}
      {failed && <p className="text-body-sm text-th-fg-muted">No pudimos cargar las sugerencias.</p>}
      {people && people.length === 0 && (
        <p className="text-body-sm text-th-fg-muted">Por ahora no hay cuentas para sugerirte. Vuelve más tarde.</p>
      )}

      {people && people.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto pb-2">
          {people.map((person) => {
            const status = statuses[person.id] ?? null;
            return (
              <li
                key={person.id}
                className="relative flex w-40 shrink-0 flex-col items-center gap-2 rounded-th-card border border-th-border bg-th-surface-subtle px-3 pb-3 pt-5"
              >
                <button
                  type="button"
                  onClick={() => setPeople((current) => current.filter((p) => p.id !== person.id))}
                  aria-label={`Descartar a ${person.name}`}
                  className="absolute right-2 top-2 rounded-th-pill p-0.5 text-th-fg-muted th-focus-ring hover:bg-th-surface"
                >
                  <Icon name="close" size={14} />
                </button>
                <Link to={`/user/${person.id}`} className="flex w-full flex-col items-center gap-1 th-focus-ring">
                  <Avatar name={person.name} photo={person.avatar_url} size="w-16 h-16 text-xl" />
                  <span className="w-full truncate text-center text-body-sm font-semibold text-th-fg-strong">
                    {person.name}
                  </span>
                  <span className="w-full truncate text-center text-label-md text-th-fg-muted">@{person.username}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => toggle(person)}
                  className={`w-full rounded-th-pill border px-3 py-1.5 text-label-md font-bold th-focus-ring ${
                    status
                      ? "border-th-border bg-th-surface text-th-fg-muted"
                      : "border-th-brand bg-th-brand text-th-on-brand hover:bg-th-brand-hover"
                  }`}
                >
                  {followLabel(status, person.is_private)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
