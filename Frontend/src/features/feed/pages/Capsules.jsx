import { useMemo } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import Icon from "@shared/components/Icon";
import Spinner from "@shared/components/Spinner";
import CapsuleCard from "../components/CapsuleCard";
import { COLLECTIONS, filterCapsules, isCollection } from "../lib/capsuleCollections";

/**
 * Cápsulas — colección de publicaciones reales.
 *
 * «Cápsula» es el nombre de producto de una publicación (ADR-004), confirmado por el propietario
 * del proyecto: esta vista no es un tipo de contenido distinto sino una colección de posts. Se
 * filtra en el cliente sobre lo ya cargado (no hay endpoint de colecciones) y la colección vive
 * en la URL (`?tab=`), así que se puede compartir y recargar.
 */

const EMPTY = {
  all: {
    icon: "layers",
    title: "Todavía no hay cápsulas",
    description: "Cuando alguien publique, aparecerá aquí.",
  },
  following: {
    icon: "group",
    title: "Nadie a quien sigues ha publicado",
    description: "Sigue a más personas para ver sus cápsulas en esta pestaña.",
  },
  mine: {
    icon: "edit_note",
    title: "Aún no has publicado",
    description: "Tus cápsulas aparecerán aquí en cuanto publiques la primera.",
  },
};

export default function Capsules() {
  const {
    currentUser,
    capsules,
    capsulesLoading,
    onToggleLike,
    onLoadComments,
    onPostComment,
    onDeleteComment,
    onEditComment,
    onToggleFollowAuthor,
    onDeleteCapsule,
    onEditCapsule,
    onOpenComposer,
  } = useOutletContext();

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = isCollection(searchParams.get("tab")) ? searchParams.get("tab") : "all";

  const items = useMemo(
    () => filterCapsules(capsules, tab, currentUser?.id),
    [capsules, tab, currentUser?.id]
  );

  function selectTab(id) {
    const next = new URLSearchParams(searchParams);
    if (id === "all") next.delete("tab");
    else next.set("tab", id);
    setSearchParams(next, { replace: true });
  }

  const empty = EMPTY[tab];

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 py-4">
      <header className="flex flex-col gap-4 rounded-th-card border border-th-border bg-th-surface p-6 shadow-th-card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <h1 className="text-headline-sm text-th-fg-strong">Cápsulas</h1>
            <p className="text-body-sm text-th-fg-muted">Las publicaciones de THERS, en colecciones.</p>
          </div>
          {onOpenComposer && (
            <button
              type="button"
              onClick={onOpenComposer}
              className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-th-pill bg-th-brand px-4 py-2 text-label-lg font-bold text-th-on-brand th-focus-ring"
            >
              <Icon name="add" size={18} />
              Nueva cápsula
            </button>
          )}
        </div>

        <div role="tablist" aria-label="Colección de cápsulas" className="flex items-center gap-2 border-t border-th-border-subtle pt-3">
          {COLLECTIONS.map((collection) => {
            const active = collection.id === tab;
            return (
              <button
                key={collection.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(collection.id)}
                className={`flex min-h-[40px] items-center gap-1.5 rounded-th-sm px-3.5 py-1.5 text-body-sm transition-colors th-focus-ring ${
                  active
                    ? "border border-th-brand-soft-strong bg-th-brand-soft font-bold text-th-brand-fg"
                    : "font-medium text-th-fg-muted hover:bg-th-surface-raised hover:text-th-fg-strong"
                }`}
              >
                <Icon name={collection.icon} size={18} />
                {collection.label}
              </button>
            );
          })}
        </div>
      </header>

      {capsulesLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-th-fg-muted" role="status">
          <Spinner size={20} />
          <span className="text-body-md">Cargando cápsulas…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-th-card border border-dashed border-th-border bg-th-surface px-6 py-16 text-center">
          <Icon name={empty.icon} size={28} className="text-th-fg-subtle" />
          <p className="text-label-lg font-bold text-th-fg-strong">{empty.title}</p>
          <p className="max-w-md text-body-md text-th-fg-muted">{empty.description}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {items.map((capsule) => (
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
    </div>
  );
}
