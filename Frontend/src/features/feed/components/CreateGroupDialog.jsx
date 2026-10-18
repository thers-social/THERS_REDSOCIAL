import { useEffect, useState } from "react";
import Avatar from "@shared/components/Avatar";
import Spinner from "@shared/components/Spinner";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import { createGroup } from "../lib/groupsApi";

const MAX_NAME = 60;

/**
 * Crear un chat grupal (ADR-048). Se elige entre las personas con las que ya hay una conversación
 * (`people`); el servidor vuelve a comprobar bloqueos y quién acepta mensajes de quién.
 */
export default function CreateGroupDialog({ people, onClose, onCreated }) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canCreate = name.trim().length > 0 && selected.size > 0 && !saving;

  async function submit(event) {
    event.preventDefault();
    if (!canCreate) return;
    setSaving(true);
    setError("");
    try {
      const group = await createGroup(name.trim(), [...selected]);
      onCreated(group);
    } catch (err) {
      setError(getErrorMessage(err, t));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => !saving && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-[24px] bg-surface p-6 shadow-soft dark:bg-surface-dark"
      >
        <h2 id="create-group-title" className="text-base font-semibold text-ink dark:text-ink-dark">
          {t("groups.createTitle")}
        </h2>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-ink dark:text-ink-dark">{t("groups.nameLabel")}</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_NAME}
            autoFocus
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          />
        </label>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-ink dark:text-ink-dark">{t("groups.membersLabel")}</legend>
          {people === null && <Spinner />}
          {people && people.length === 0 && <p className="text-sm text-muted">{t("groups.noPeople")}</p>}
          {people && people.length > 0 && (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {people.map((person) => (
                <li key={person.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-canvas dark:hover:bg-canvas-dark">
                    <input
                      type="checkbox"
                      checked={selected.has(person.id)}
                      onChange={() => toggle(person.id)}
                      className="h-4 w-4"
                    />
                    <Avatar name={person.name} photo={person.avatar_url} size="w-9 h-9" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink dark:text-ink-dark">{person.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-th-danger-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full px-4 py-2 text-sm font-semibold text-ink dark:text-ink-dark">
            {t("groups.cancel")}
          </button>
          <button
            type="submit"
            disabled={!canCreate}
            className="rounded-full bg-pulse-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? t("groups.creating") : t("groups.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
