import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import { api, getErrorMessage } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";

// «Personas que resuenan» -- cuentas REALES de GET /api/users/suggestions
// (ADR-030-content-preferences.md). Antes eran cinco personas de ejemplo
// rotuladas como tal; ahora el servidor sugiere cuentas que existen, que la
// persona todavía no sigue y con las que no hay un bloqueo.
//
// El botón de seguir actúa sobre el endpoint real (POST/DELETE
// /api/users/<id>/follow, ADR-007/ADR-022) y refleja lo que el servidor
// responde: «Siguiendo» o «Solicitado» si la cuenta es privada. Mantiene su
// propio estado en vez de reutilizar el de AppShell: ese Set en memoria existía
// para las personas de ejemplo.

function authHeaders() {
  return { Authorization: `Bearer ${getStoredToken()}` };
}

function initialsOf(user) {
  const source = user?.name || user?.username || "";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function SuggestedPeopleCard() {
  const toast = useToast();
  const { t } = useLanguage();

  const [people, setPeople] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await api.get("/users/suggestions", { headers: authHeaders() });
        if (!cancelled) setPeople(res.data.suggestions);
      } catch {
        // Un panel secundario: si falla no se interrumpe el feed con un Toast,
        // se muestra su estado vacío.
        if (!cancelled) setPeople([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(person) {
    if (busyId) return;
    setBusyId(person.id);

    try {
      const current = statuses[person.id] ?? null;
      const res = current
        ? await api.delete(`/users/${person.id}/follow`, { headers: authHeaders() })
        : await api.post(`/users/${person.id}/follow`, null, { headers: authHeaders() });
      setStatuses((previous) => ({ ...previous, [person.id]: res.data.follow_status }));
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-th-card border border-th-border bg-th-surface p-4 shadow-th-card">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-label-lg font-bold text-th-fg-strong">Personas que resuenan</h2>
        <Icon name="sync_alt" size={18} className="text-th-fg-subtle" />
      </header>

      {people === null ? (
        <div className="flex items-center gap-2 text-th-fg-muted" role="status">
          <Spinner size={16} />
          <span className="text-body-sm">Buscando personas...</span>
        </div>
      ) : people.length === 0 ? (
        <p className="text-body-sm text-th-fg-muted">
          Por ahora no hay cuentas nuevas que sugerirte.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {people.map((person) => {
            const status = statuses[person.id] ?? null;
            return (
              <li key={person.id} className="flex items-center justify-between gap-2">
                <Link
                  to={`/user/${person.id}`}
                  aria-label={`Ver el perfil de ${person.name}`}
                  className="flex min-w-0 items-center gap-2 rounded-th-card th-focus-ring"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-th-pill bg-th-surface-raised text-label-md font-bold text-th-fg-muted">
                    {initialsOf(person)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-semibold text-th-fg-strong">
                      {person.name}
                    </p>
                    <p className="truncate text-label-md text-th-fg-muted">@{person.username}</p>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={() => handleToggle(person)}
                  disabled={busyId === person.id}
                  aria-pressed={status === "accepted"}
                  className={`shrink-0 rounded-th-pill border px-3 py-1.5 text-label-md font-bold transition-colors th-focus-ring disabled:opacity-60 ${
                    status
                      ? "border-th-border bg-th-surface text-th-fg-muted hover:bg-th-surface-raised"
                      : "border-th-brand bg-th-brand text-th-on-brand hover:bg-th-brand-hover"
                  }`}
                >
                  {status === "accepted"
                    ? "Siguiendo"
                    : status === "pending"
                      ? "Solicitado"
                      : person.is_private
                        ? "Solicitar"
                        : "Seguir"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
