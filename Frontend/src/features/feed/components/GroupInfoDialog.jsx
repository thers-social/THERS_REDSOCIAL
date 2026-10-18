import { useEffect, useState } from "react";
import Avatar from "@shared/components/Avatar";
import ConfirmDialog from "@shared/components/ConfirmDialog";
import Spinner from "@shared/components/Spinner";
import { useToast } from "@shared/components/Toast";
import { getErrorMessage } from "@shared/lib/api";
import { useLanguage } from "@shared/i18n";
import {
  addGroupMembers,
  fetchGroup,
  leaveGroup,
  promoteGroupMember,
  removeGroupMember,
  renameGroup,
} from "../lib/groupsApi";

/**
 * Información y gestión de un chat grupal (ADR-048): miembros y roles, y -- para administradores --
 * renombrar, añadir, quitar y nombrar administradores. Cualquier miembro puede salir. Todo se
 * comprueba otra vez en el servidor; aquí solo se ocultan los controles que no corresponden.
 */
export default function GroupInfoDialog({ groupId, currentUserId, people, onClose, onChanged, onLeft }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [group, setGroup] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchGroup(groupId, controller.signal)
      .then((g) => {
        setGroup(g);
        setName(g.name);
      })
      .catch((err) => !controller.signal.aborted && toast.error(getErrorMessage(err, t)));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && !busy && !confirmLeave && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy, confirmLeave]);

  const isAdmin = group?.my_role === "admin";
  const memberIds = new Set((group?.members ?? []).map((m) => m.id));
  const addable = (people ?? []).filter((p) => !memberIds.has(p.id));

  async function run(action) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await action();
      if (updated) {
        setGroup(updated);
        setName(updated.name);
        onChanged();
      }
    } catch (err) {
      toast.error(getErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setConfirmLeave(false);
    setBusy(true);
    try {
      await leaveGroup(groupId);
      toast.success(t("groups.left"));
      onLeft();
    } catch (err) {
      toast.error(getErrorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-info-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-[24px] bg-surface p-6 shadow-soft dark:bg-surface-dark"
      >
        <h2 id="group-info-title" className="text-base font-semibold text-ink dark:text-ink-dark">
          {t("groups.info")}
        </h2>
        {!group && <Spinner />}
        {group && (
          <>
            {isAdmin && (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim() && name.trim() !== group.name) run(() => renameGroup(groupId, name.trim()));
                }}
              >
                <label className="sr-only" htmlFor="group-name">{t("groups.nameLabel")}</label>
                <input
                  id="group-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={60}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
                />
                <button
                  type="submit"
                  disabled={busy || !name.trim() || name.trim() === group.name}
                  className="rounded-full px-3 py-2 text-sm font-semibold text-pulse-600 disabled:opacity-40"
                >
                  {t("groups.save")}
                </button>
              </form>
            )}
            {!isAdmin && <p className="text-lg font-semibold text-ink dark:text-ink-dark">{group.name}</p>}

            <ul className="space-y-1" aria-label={t("groups.membersLabel")}>
              {group.members.map((member) => (
                <li key={member.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <Avatar name={member.name} photo={member.avatar_url} size="w-9 h-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink dark:text-ink-dark">
                      {member.name}
                      {member.id === currentUserId && <span className="text-muted"> ({t("groups.you")})</span>}
                    </p>
                    {member.role === "admin" && <p className="text-xs text-pulse-600">{t("groups.admin")}</p>}
                  </div>
                  {isAdmin && member.role !== "admin" && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => promoteGroupMember(groupId, member.id))}
                        className="text-xs font-semibold text-pulse-600 disabled:opacity-40"
                      >
                        {t("groups.makeAdmin")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => removeGroupMember(groupId, member.id))}
                        className="text-xs font-semibold text-th-danger-fg disabled:opacity-40"
                      >
                        {t("groups.remove")}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {isAdmin && (
              <section className="space-y-1">
                <h3 className="text-sm font-medium text-ink dark:text-ink-dark">{t("groups.addPeople")}</h3>
                {addable.length === 0 ? (
                  <p className="text-sm text-muted">{t("groups.noOneToAdd")}</p>
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {addable.map((person) => (
                      <li key={person.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                        <Avatar name={person.name} photo={person.avatar_url} size="w-8 h-8" />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-ink-dark">{person.name}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => addGroupMembers(groupId, [person.id]))}
                          className="text-xs font-semibold text-pulse-600 disabled:opacity-40"
                        >
                          {t("groups.add")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setConfirmLeave(true)}
                disabled={busy}
                className="rounded-full px-3 py-2 text-sm font-semibold text-th-danger-fg disabled:opacity-40"
              >
                {t("groups.leave")}
              </button>
              <button type="button" onClick={onClose} disabled={busy} className="rounded-full px-4 py-2 text-sm font-semibold text-ink dark:text-ink-dark">
                {t("groups.close")}
              </button>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmLeave}
        icon="delete"
        destructive
        title={t("groups.leaveConfirmTitle")}
        description={t("groups.leaveConfirmText")}
        confirmLabel={t("groups.leave")}
        cancelLabel={t("groups.cancel")}
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
