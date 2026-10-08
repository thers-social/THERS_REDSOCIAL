import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "@shared/components/Icon";
import Avatar from "@shared/components/Avatar";
import Spinner from "@shared/components/Spinner";
import ConfirmDialog from "@shared/components/ConfirmDialog";
import ImageGrid from "@shared/components/ImageGrid";
import MentionText from "./MentionText";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import { api, getErrorMessage } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";
import { formatRelativeTime } from "../lib/formatRelativeTime";

// Tarjeta de publicación del stream — sección 4 de REF-FEED-01.
//
// Composición de la referencia: cabecera (avatar, nombre, distintivo,
// control de seguir, handle · tiempo, menú), cuerpo de texto, chip de
// ubicación y barra social con favorite / chat_bubble / bookmark_add / share.
// Superficie blanca, borde 1px, radio 16px, padding 24px.
//
// QUÉ ES REAL Y QUÉ NO (archivo maestro §8.1 y §9.4):
//  · Like (favorite): REAL — POST/DELETE /api/posts/<id>/like, ADR-005.
//    Actualización optimista con rollback, gestionada por AppShell.
//  · Comentarios (chat_bubble): REAL — GET/POST /api/posts/<id>/comments,
//    ADR-006. El hilo se pide bajo demanda al abrir el panel, no de antemano.
//  · Seguir al autor: REAL — POST/DELETE /api/users/<id>/follow, ADR-007.
//  · Eliminar publicación: REAL — DELETE /api/posts/<id>, ADR-019. Solo
//    aparece sobre una publicación propia; pide confirmación (ConfirmDialog,
//    no el cuadro nativo del navegador) porque el borrado no se puede
//    deshacer y arrastra likes y comentarios.
//  · Eliminar comentario: REAL — DELETE /api/comments/<id>, ADR-020. Solo
//    aparece sobre un comentario propio, con la misma confirmación.
//  · Editar publicación y comentario: REAL — PATCH /api/posts/<id> y
//    PATCH /api/comments/<id>, ADR-021. Solo sobre contenido propio. Edición
//    en línea (el cuerpo de la tarjeta se vuelve formulario), sin
//    confirmación previa: una edición se puede volver a editar, a diferencia
//    de un borrado. Una vez editado se muestra la marca «editado» junto a la
//    hora — el contrato expone `edited` como booleano, nunca la hora de la
//    edición, así que no se inventa un «editado hace 5 min».
//  · Menciones: REAL — `mentions` viaja con cada post/comentario (ADR-023).
//    Solo se enlazan las que el servidor autorizó; un @username inexistente o
//    no autorizado queda como texto plano, nunca como enlace.
//  · Seguir una cuenta privada: REAL — el botón tiene tres estados según
//    `author.follow_status` (ADR-022): Seguir / Solicitado / Siguiendo.
//  · Bloquear / restringir al autor: REAL — POST /api/users/me/blocks y
//    /api/users/me/restrictions, ADR-029. Solo sobre publicaciones ajenas, con
//    confirmación. Tras bloquear, la tarjeta se oculta de inmediato (el
//    servidor ya no devuelve sus publicaciones); restringir no cambia lo que
//    ves, solo lo que ven los demás de sus comentarios en tus publicaciones.
//  · Contenido sensible: REAL — `is_sensitive` lo declara el autor al publicar
//    (ADR-030). Quien activó el filtro de contenido sensible ni siquiera
//    recibe la publicación; quien no, la ve con el texto oculto tras «Mostrar
//    de todos modos». El autor siempre ve la suya.
//  · Guardar (bookmark_add) y compartir (share): SIN ENDPOINT. Se dibujan
//    como en la referencia pero deshabilitados y con explicación accesible;
//    no se simula que funcionen.
//  · Distintivo «verified»: NO se reproduce. El contrato no expone
//    verificación y el archivo maestro §8.4 prohíbe otorgarla por fixture.
//  · Chip de ubicación: NO se reproduce. `post` no tiene campo de lugar
//    (ADR-004); inventarlo sería fabricar un dato.
export default function CapsuleCard({
  capsule,
  currentUserId,
  onToggleLike,
  onLoadComments,
  onPostComment,
  onToggleFollowAuthor,
  onDeleteCapsule,
  onDeleteComment,
  onEditCapsule,
  onEditComment,
}) {
  const toast = useToast();
  const { t } = useLanguage();

  const [isOpen, setOpen] = useState(false);
  const [comments, setComments] = useState(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Comentario pendiente de confirmar para borrar (`null` = diálogo cerrado)
  // y comentario con la petición en vuelo (para deshabilitar su papelera).
  const [pendingCommentId, setPendingCommentId] = useState(null);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  // Edición en línea (ADR-021). La publicación y los comentarios se editan de
  // forma independiente: `editing` es el formulario de la publicación;
  // `editingCommentId` dice qué comentario del panel está en edición (`null`
  // = ninguno). Cada uno con su borrador y su propia petición en vuelo.
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [commentEditDraft, setCommentEditDraft] = useState("");
  const [savingCommentEdit, setSavingCommentEdit] = useState(false);
  // Menú de la cuenta del autor (ADR-029): `menuOpen` es el desplegable,
  // `pendingRestriction` el diálogo de confirmación ('block' | 'restrict' |
  // null) y `hidden` oculta la tarjeta tras bloquear.
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingRestriction, setPendingRestriction] = useState(null);
  const [applyingRestriction, setApplyingRestriction] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Contenido sensible (ADR-030): el texto de una publicación ajena marcada así
  // queda oculto hasta que la persona decide mostrarlo.
  const [revealed, setRevealed] = useState(false);

  const isOwnCapsule = capsule.author.id === currentUserId;
  // `follow_status` (ADR-022): null | 'pending' | 'accepted'. Se lee tal cual
  // del servidor -- es él quien sabe si seguir a esta persona crea una
  // relación o una solicitud.
  const followState = capsule.author.follow_status ?? null;

  // DELETE /api/posts/<id> (ADR-019). La petición y el estado del feed los
  // gobierna AppShell (optimistic update + rollback, mismo reparto que
  // onToggleLike); acá solo vive la confirmación previa -- un borrado no se
  // puede deshacer, mismo criterio que el borrado de un mensaje (ADR-014).
  // El diálogo se cierra antes de mandar la petición: la tarjeta desaparece
  // de inmediato (actualización optimista) y, si falla, vuelve con un Toast.
  const handleConfirmDelete = async () => {
    setConfirmingDelete(false);
    if (deleting) return;

    setDeleting(true);
    try {
      await onDeleteCapsule?.(capsule.id);
    } finally {
      setDeleting(false);
    }
  };

  // DELETE /api/comments/<id> (ADR-020). A diferencia de la publicación, acá no
  // hay actualización optimista: el comentario sale del panel recién cuando el
  // servidor confirma, igual que publicarlo (handleSubmit). Si falla, queda
  // donde estaba y se avisa con un Toast.
  const handleConfirmDeleteComment = async () => {
    const commentId = pendingCommentId;
    setPendingCommentId(null);
    if (!commentId || deletingCommentId) return;

    setDeletingCommentId(commentId);
    try {
      await onDeleteComment?.(capsule.id, commentId);
      setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setDeletingCommentId(null);
    }
  };

  // PATCH /api/posts/<id> (ADR-021). La petición y el estado del feed los
  // gobierna AppShell (reemplaza la publicación con la respuesta del
  // servidor, que ya trae `edited` y los contadores reales); acá solo vive el
  // formulario. Sin confirmación previa, a diferencia de borrar.
  const handleStartEdit = () => {
    setEditDraft(capsule.content);
    setEditing(true);
  };

  const handleSubmitEdit = async (event) => {
    event.preventDefault();
    const content = editDraft.trim();
    // Un guardado sin cambios no se manda: marcaría la publicación como
    // «editado» sin que nada hubiera cambiado.
    if (!content || content === capsule.content || savingEdit) return;

    setSavingEdit(true);
    try {
      await onEditCapsule?.(capsule.id, content);
      setEditing(false);
    } catch (error) {
      // El editor queda abierto con lo que se escribió para poder reintentar,
      // mismo criterio que el formulario de comentario (handleSubmit).
      toast.error(getErrorMessage(error, t));
    } finally {
      setSavingEdit(false);
    }
  };

  // PATCH /api/comments/<id> (ADR-021). AppShell devuelve el comentario ya
  // editado y acá se reemplaza en la lista del panel -- mismo reparto que
  // handleConfirmDeleteComment.
  const handleStartCommentEdit = (comment) => {
    setCommentEditDraft(comment.content);
    setEditingCommentId(comment.id);
  };

  const handleSubmitCommentEdit = async (event) => {
    event.preventDefault();
    const commentId = editingCommentId;
    const content = commentEditDraft.trim();
    const original = comments?.find((c) => c.id === commentId);
    if (!commentId || !content || content === original?.content || savingCommentEdit) return;

    setSavingCommentEdit(true);
    try {
      const updated = await onEditComment?.(commentId, content);
      setComments((prev) => (prev ?? []).map((c) => (c.id === commentId ? updated : c)));
      setEditingCommentId(null);
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setSavingCommentEdit(false);
    }
  };

  // POST /api/users/me/blocks | /api/users/me/restrictions (ADR-029). El
  // servidor decide el efecto real; acá solo se confirma y se refleja.
  const handleConfirmRestriction = async () => {
    const kind = pendingRestriction;
    setPendingRestriction(null);
    if (!kind || applyingRestriction) return;

    setApplyingRestriction(true);
    try {
      await api.post(
        kind === "block" ? "/users/me/blocks" : "/users/me/restrictions",
        { user_id: capsule.author.id },
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      if (kind === "block") {
        toast.success(`Bloqueaste a @${capsule.author.username}`);
        setHidden(true);
      } else {
        toast.success(
          `Restringiste a @${capsule.author.username}. Sus comentarios en tus publicaciones quedan ocultos para los demás.`
        );
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setApplyingRestriction(false);
    }
  };

  const handleToggleComments = async () => {
    const willOpen = !isOpen;
    setOpen(willOpen);

    if (willOpen && comments === null) {
      setLoading(true);
      try {
        const loaded = await onLoadComments(capsule.id);
        setComments(loaded);
      } catch (error) {
        toast.error(getErrorMessage(error, t));
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || posting) return;

    setPosting(true);
    try {
      const comment = await onPostComment(capsule.id, content);
      setComments((prev) => [...(prev ?? []), comment]);
      setDraft("");
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setPosting(false);
    }
  };

  if (hidden) return null;

  return (
    <article className="flex flex-col gap-4 rounded-th-card border border-th-border bg-th-surface p-6 shadow-th-card transition-colors hover:border-th-border-strong">
      <header className="flex items-start gap-3">
        <Avatar name={capsule.author.name} photo={capsule.author.avatar_url} size="w-10 h-10" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-label-lg font-bold text-th-fg-strong">
              {capsule.author.name}
            </p>

            {!isOwnCapsule && (
              // Tres estados (ADR-022): sin relación, solicitud pendiente
              // (solo posible hacia una cuenta privada) y follow aceptado.
              // `follow_status` viene del servidor; no se infiere de
              // `is_followed_by_me`, que solo distingue dos.
              <button
                type="button"
                onClick={() => onToggleFollowAuthor?.(capsule.author.id)}
                aria-pressed={capsule.author.is_followed_by_me}
                title={
                  followState === "pending"
                    ? "Tu solicitud está esperando aprobación. Tocá para cancelarla."
                    : undefined
                }
                className={`shrink-0 rounded-th-pill border px-2.5 py-0.5 text-label-md font-bold transition-colors th-focus-ring ${
                  followState === "accepted"
                    ? "border-th-border bg-th-surface-subtle text-th-fg-muted hover:bg-th-surface-raised"
                    : followState === "pending"
                      ? "border-th-border bg-th-surface text-th-fg-muted hover:bg-th-surface-subtle"
                      : "border-th-brand bg-th-brand text-th-on-brand hover:bg-th-brand-hover"
                }`}
              >
                {followState === "accepted"
                  ? "Siguiendo"
                  : followState === "pending"
                    ? "Solicitado"
                    : capsule.author.is_private
                      ? "Solicitar"
                      : "Seguir"}
              </button>
            )}

            {!isOwnCapsule && (
              // GET /api/conversations (ADR-013) solo lista gente con la que
              // ya hay al menos un mensaje -- este es el punto de entrada
              // real para empezar una conversación nueva. Messages.jsx lee
              // estos mismos parámetros para abrir un hilo vacío listo para
              // escribir, sin inventar un endpoint de búsqueda de usuarios
              // (no existe todavía, DATABASE_ARCHITECTURE.md §4.B).
              <Link
                to={`/messages?to=${capsule.author.id}&name=${encodeURIComponent(capsule.author.name)}&username=${encodeURIComponent(capsule.author.username)}`}
                aria-label={`Mandarle un mensaje a ${capsule.author.name}`}
                className="shrink-0 rounded-th-pill border border-th-border bg-th-surface p-1.5 text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle"
              >
                <Icon name="mail" size={16} />
              </Link>
            )}
          </div>

          <p className="mt-0.5 truncate text-body-sm text-th-fg-muted">
            @{capsule.author.username} · {formatRelativeTime(capsule.created_at)}
            {/* `edited` es un booleano en el contrato (ADR-021): se puede
                decir QUE se editó, no cuándo. */}
            {capsule.edited && <> · editado</>}
          </p>
        </div>

        {!isOwnCapsule && (
          <div className="relative -mr-1 -mt-1 shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              disabled={applyingRestriction}
              aria-label={`Más opciones sobre @${capsule.author.username}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-9 w-9 items-center justify-center rounded-th-pill text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle disabled:opacity-40"
            >
              {applyingRestriction ? <Spinner size={16} /> : <Icon name="more_horiz" size={20} />}
            </button>

            {menuOpen && (
              <>
                {/* Capa transparente: un clic fuera cierra el menú. */}
                <button
                  type="button"
                  aria-label="Cerrar menú"
                  tabIndex={-1}
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div
                  role="menu"
                  className="absolute right-0 top-10 z-20 flex w-56 flex-col rounded-th-card border border-th-border bg-th-surface p-1 shadow-th-card"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setPendingRestriction("restrict");
                    }}
                    className="flex items-center gap-2 rounded-th-input px-3 py-2 text-left text-label-lg text-th-fg th-focus-ring hover:bg-th-surface-subtle"
                  >
                    <Icon name="visibility_off" size={18} />
                    Restringir a @{capsule.author.username}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setPendingRestriction("block");
                    }}
                    className="flex items-center gap-2 rounded-th-input px-3 py-2 text-left text-label-lg text-th-danger-accent th-focus-ring hover:bg-th-danger-surface"
                  >
                    <Icon name="block" size={18} />
                    Bloquear a @{capsule.author.username}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {isOwnCapsule && onEditCapsule && !editing && (
          <button
            type="button"
            onClick={handleStartEdit}
            aria-label="Editar publicación"
            className="-mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-th-pill text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle hover:text-th-brand"
          >
            <Icon name="edit" size={20} />
          </button>
        )}

        {isOwnCapsule && onDeleteCapsule && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={deleting}
            aria-label="Eliminar publicación"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-th-pill text-th-fg-muted transition-colors th-focus-ring hover:bg-th-danger-surface hover:text-th-danger-accent disabled:opacity-40"
          >
            {deleting ? <Spinner size={16} /> : <Icon name="delete" size={20} />}
          </button>
        )}
      </header>

      <ConfirmDialog
        open={confirmingDelete}
        icon="delete"
        destructive
        title="¿Eliminar esta publicación?"
        description="También se borrarán sus me gusta y comentarios. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />

      <ConfirmDialog
        open={pendingRestriction !== null}
        icon={pendingRestriction === "block" ? "block" : "visibility_off"}
        destructive={pendingRestriction === "block"}
        title={
          pendingRestriction === "block"
            ? `¿Bloquear a @${capsule.author.username}?`
            : `¿Restringir a @${capsule.author.username}?`
        }
        description={
          pendingRestriction === "block"
            ? "No verá tu contenido ni podrá interactuar contigo, y tú dejarás de ver lo suyo. Se cancelan los seguimientos entre ustedes. Puedes desbloquearla en Configuración."
            : "Podrá seguir viendo tus publicaciones, pero sus comentarios en ellas quedarán ocultos para los demás. No se entera. Puedes quitarlo en Configuración."
        }
        confirmLabel={pendingRestriction === "block" ? "Bloquear" : "Restringir"}
        onConfirm={handleConfirmRestriction}
        onCancel={() => setPendingRestriction(null)}
      />

      <ConfirmDialog
        open={pendingCommentId !== null}
        icon="delete"
        destructive
        title="¿Eliminar este comentario?"
        description="Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={handleConfirmDeleteComment}
        onCancel={() => setPendingCommentId(null)}
      />

      {editing ? (
        <form onSubmit={handleSubmitEdit} className="flex flex-col gap-2">
          <label htmlFor={`edit-capsule-${capsule.id}`} className="sr-only">
            Editar la publicación
          </label>
          <textarea
            id={`edit-capsule-${capsule.id}`}
            value={editDraft}
            onChange={(event) => setEditDraft(event.target.value)}
            rows={4}
            maxLength={2000}
            disabled={savingEdit}
            className="w-full resize-y rounded-th-card border border-th-border bg-th-surface-subtle px-4 py-3 text-body-lg text-th-fg transition-colors th-focus-ring disabled:opacity-60"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={savingEdit}
              className="min-h-[44px] rounded-th-pill px-4 py-2 text-label-lg text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!editDraft.trim() || editDraft.trim() === capsule.content || savingEdit}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-th-pill bg-th-brand px-4 py-2 text-label-lg font-bold text-th-on-brand transition-colors th-focus-ring hover:bg-th-brand-hover disabled:opacity-40 disabled:hover:bg-th-brand"
            >
              {savingEdit && <Spinner size={16} />}
              Guardar
            </button>
          </div>
        </form>
      ) : capsule.is_sensitive && !isOwnCapsule && !revealed ? (
        // Marcada como sensible por su autor (ADR-030). Quien no activó el
        // filtro la ve en el feed, pero el texto queda oculto hasta que lo pide.
        <div className="flex flex-col items-start gap-2 rounded-th-input border border-dashed border-th-border bg-th-surface-subtle p-4">
          <p className="flex items-center gap-2 text-label-lg font-bold text-th-fg-strong">
            <Icon name="visibility_off" size={18} />
            Contenido sensible
          </p>
          <p className="text-body-sm text-th-fg-muted">
            Su autor marcó esta publicación como sensible.
          </p>
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="rounded-th-pill border border-th-border bg-th-surface px-3 py-1 text-label-md font-bold text-th-fg th-focus-ring hover:bg-th-surface-raised"
          >
            Mostrar de todos modos
          </button>
        </div>
      ) : (
        <>
          {capsule.is_sensitive && (
            <p className="flex items-center gap-1.5 text-label-md font-bold text-th-fg-muted">
              <Icon name="visibility_off" size={16} />
              Contenido sensible
            </p>
          )}
          {/* Una publicación de solo imágenes tiene `content` vacío (ADR-039). */}
          {capsule.content && (
            <p className="whitespace-pre-wrap break-words text-body-lg text-th-fg">
              <MentionText content={capsule.content} mentions={capsule.mentions} />
            </p>
          )}
          <ImageGrid images={capsule.images} alt={`Imagen de ${capsule.author.name}`} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-th-border-subtle pt-3">
        <button
          type="button"
          onClick={() => onToggleLike?.(capsule.id)}
          aria-pressed={capsule.liked_by_me}
          aria-label={capsule.liked_by_me ? "Quitar me gusta" : "Me gusta"}
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-th-pill px-3 py-1.5 text-label-lg transition-colors th-focus-ring ${
            capsule.liked_by_me
              ? "text-th-danger-accent"
              : "text-th-fg-muted hover:bg-th-surface-subtle hover:text-th-danger-accent"
          }`}
        >
          <Icon name="favorite" size={20} fill={capsule.liked_by_me ? 1 : 0} />
          {capsule.likes_count > 0 && <span>{capsule.likes_count}</span>}
        </button>

        <button
          type="button"
          onClick={handleToggleComments}
          aria-expanded={isOpen}
          aria-label="Comentarios"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-th-pill px-3 py-1.5 text-label-lg text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle hover:text-th-brand"
        >
          <Icon name="chat_bubble" size={20} />
          {capsule.comments_count > 0 && <span>{capsule.comments_count}</span>}
        </button>

        {/* Presentes en la referencia, sin endpoint que los respalde. */}
        <PendingAction id={`save-${capsule.id}`} icon="bookmark_add" label="Guardar" />
        <PendingAction id={`share-${capsule.id}`} icon="share" label="Compartir" />
      </div>

      {isOpen && (
        <div className="flex flex-col gap-4 border-t border-th-border-subtle pt-4">
          {loading ? (
            <div className="flex items-center gap-2 py-2 text-th-fg-muted" role="status">
              <Spinner size={16} />
              <span className="text-body-sm">Cargando comentarios...</span>
            </div>
          ) : comments && comments.length === 0 ? (
            <p className="text-body-sm text-th-fg-muted">
              Todavía no hay comentarios. Sé el primero en comentar.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments?.map((comment) => (
                <li key={comment.id} className="flex items-start gap-2.5">
                  <Avatar name={comment.author.name} photo={comment.author.avatar_url} size="w-7 h-7" />
                  <div className="min-w-0 flex-1 rounded-th-card bg-th-surface-subtle px-3.5 py-2">
                    <p className="text-label-md font-bold text-th-fg-strong">
                      {comment.author.name}{" "}
                      <span className="font-normal text-th-fg-muted">
                        · {formatRelativeTime(comment.created_at)}
                        {comment.edited && <> · editado</>}
                      </span>
                    </p>

                    {editingCommentId === comment.id ? (
                      <form onSubmit={handleSubmitCommentEdit} className="mt-1 flex flex-col gap-2">
                        <label htmlFor={`edit-comment-${comment.id}`} className="sr-only">
                          Editar el comentario
                        </label>
                        <input
                          id={`edit-comment-${comment.id}`}
                          type="text"
                          value={commentEditDraft}
                          onChange={(event) => setCommentEditDraft(event.target.value)}
                          maxLength={1000}
                          disabled={savingCommentEdit}
                          className="min-h-[40px] w-full rounded-th-pill border border-th-border bg-th-surface px-3.5 py-1.5 text-body-sm text-th-fg transition-colors th-focus-ring disabled:opacity-60"
                        />
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingCommentId(null)}
                            disabled={savingCommentEdit}
                            className="rounded-th-pill px-3 py-1.5 text-label-md text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface disabled:opacity-40"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            disabled={
                              !commentEditDraft.trim() ||
                              commentEditDraft.trim() === comment.content ||
                              savingCommentEdit
                            }
                            className="inline-flex items-center gap-1.5 rounded-th-pill bg-th-brand px-3 py-1.5 text-label-md font-bold text-th-on-brand transition-colors th-focus-ring hover:bg-th-brand-hover disabled:opacity-40 disabled:hover:bg-th-brand"
                          >
                            {savingCommentEdit && <Spinner size={14} />}
                            Guardar
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-body-sm text-th-fg">
                        <MentionText content={comment.content} mentions={comment.mentions} />
                      </p>
                    )}
                  </div>

                  {comment.author.id === currentUserId &&
                    onEditComment &&
                    editingCommentId !== comment.id && (
                      <button
                        type="button"
                        onClick={() => handleStartCommentEdit(comment)}
                        aria-label="Editar comentario"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-th-pill text-th-fg-muted transition-colors th-focus-ring hover:bg-th-surface-subtle hover:text-th-brand"
                      >
                        <Icon name="edit" size={18} />
                      </button>
                    )}

                  {comment.author.id === currentUserId && onDeleteComment && (
                    <button
                      type="button"
                      onClick={() => setPendingCommentId(comment.id)}
                      disabled={deletingCommentId === comment.id}
                      aria-label="Eliminar comentario"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-th-pill text-th-fg-muted transition-colors th-focus-ring hover:bg-th-danger-surface hover:text-th-danger-accent disabled:opacity-40"
                    >
                      {deletingCommentId === comment.id ? (
                        <Spinner size={14} />
                      ) : (
                        <Icon name="delete" size={18} />
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <label htmlFor={`comment-${capsule.id}`} className="sr-only">
              Escribir un comentario
            </label>
            <input
              id={`comment-${capsule.id}`}
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Escribí un comentario..."
              disabled={posting}
              maxLength={1000}
              className="min-h-[44px] flex-1 rounded-th-pill border border-th-border bg-th-surface-subtle px-4 py-2 text-body-sm text-th-fg placeholder:text-th-fg-muted transition-colors th-focus-ring disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!draft.trim() || posting}
              aria-label="Publicar comentario"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-th-pill bg-th-brand text-th-on-brand transition-colors th-focus-ring hover:bg-th-brand-hover disabled:opacity-40 disabled:hover:bg-th-brand"
            >
              {posting ? <Spinner size={16} /> : <Icon name="send" size={18} />}
            </button>
          </form>
        </div>
      )}
    </article>
  );
}

/** Acción dibujada en la referencia que todavía no tiene soporte de servidor. */
function PendingAction({ id, icon, label }) {
  return (
    <button
      type="button"
      disabled
      aria-describedby={`${id}-hint`}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-th-pill px-3 py-1.5 text-label-lg text-th-fg-subtle opacity-60"
    >
      <Icon name={icon} size={20} />
      <span className="sr-only">{label}</span>
      <span id={`${id}-hint`} className="sr-only">
        {label}: todavía no disponible, falta soporte en el servidor
      </span>
    </button>
  );
}
