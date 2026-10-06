import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "@shared/hooks/useTheme";
import { useLanguage } from "@shared/i18n";
import { useAuth, getStoredToken } from "@features/auth";
import { api, getErrorMessage } from "@shared/lib/api";
import { useToast } from "@shared/components/Toast";
import ShellFrame from "./thers/ShellFrame";
import { shellVariantFor } from "./thers/navigation";
import CreateCapsuleFlow from "@features/feed/components/CreateCapsuleFlow";
import { mapNotification } from "@features/feed/lib/mapNotification";

function authHeaders() {
  return { Authorization: `Bearer ${getStoredToken()}` };
}

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  // AppShell ya no decide si hay sesión -- eso es responsabilidad exclusiva de
  // ProtectedRoute (app/router/ProtectedRoute.jsx), que envuelve esta rama de
  // rutas y solo renderiza AppShell cuando isAuthenticated es true. Acá solo
  // se consume el usuario ya resuelto por AuthProvider.
  const { user: currentUser, updateProfile, uploadProfileImage, removeProfileImage, logout } =
    useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const toast = useToast();

  // `capsules` = posts reales (GET/POST /api/posts, ADR-004-posts-minimal-model.md)
  // -- "Cápsula" sigue siendo el nombre de producto para un post, ya usado en
  // toda la UI (Home.jsx, Profile.jsx); ya no es mockCapsules.
  const [capsules, setCapsules] = useState([]);
  const [capsulesLoading, setCapsulesLoading] = useState(true);
  const [followingIds, setFollowingIds] = useState(() => new Set());
  // `notifications` = notificaciones reales (GET /api/notifications,
  // ADR-008-notifications-minimal-model.md) -- ya no mockNotifications.
  const [notifications, setNotifications] = useState([]);
  // `conversations` = conversaciones reales (GET /api/conversations,
  // ADR-013-messages-minimal-model.md) -- alimenta el badge de no-leídos de
  // Sidebar/Topbar y el panel de lista de Messages.jsx (vía contexto, mismo
  // criterio que `capsules`/`notifications`: se carga una vez acá, no en
  // cada página que la necesita).
  const [conversations, setConversations] = useState([]);
  const [isComposerOpen, setComposerOpen] = useState(false);
  // El drawer de navegación móvil sustituye al buscador/menú desplegable que
  // antes vivían en el header: ahora el buscador es un formulario real del
  // Topbar y el menú de perfil se gobierna dentro de ese componente.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPosts() {
      setCapsulesLoading(true);
      try {
        const res = await api.get("/posts", { headers: authHeaders() });
        if (!cancelled) setCapsules(res.data.posts);
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error, t));
      } finally {
        if (!cancelled) setCapsulesLoading(false);
      }
    }

    // GET /api/notifications (ADR-008). Sin estado de loading propio --
    // Notifications.jsx ya maneja bien una lista vacía mientras llega
    // (mismo criterio que unreadCount parte de [] hasta que resuelva). Un
    // error acá no bloquea el resto del shell -- se avisa por Toast, mismo
    // patrón que loadPosts.
    async function loadNotifications() {
      try {
        const res = await api.get("/notifications", { headers: authHeaders() });
        if (!cancelled) setNotifications(res.data.notifications.map(mapNotification));
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error, t));
      }
    }

    // GET /api/conversations (ADR-013). Mismo criterio que loadNotifications:
    // sin loading propio, un error no bloquea el resto del shell.
    async function loadConversations() {
      try {
        const res = await api.get("/conversations", { headers: authHeaders() });
        if (!cancelled) setConversations(res.data.conversations);
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error, t));
      }
    }

    loadPosts();
    loadNotifications();
    loadConversations();
    return () => {
      cancelled = true;
    };
  }, []);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const unreadMessages = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unread_count, 0),
    [conversations]
  );

  // Messages.jsx llama a esto después de mandar un mensaje o de abrir un
  // hilo (que marca como leído en el backend, ADR-013 §Opciones
  // consideradas) -- vuelve a pedir GET /api/conversations para que el
  // último mensaje/`unread_count` de la lista y el badge del shell queden
  // sincronizados, sin duplicar esa lógica de fetch en la propia página.
  const reloadConversations = async () => {
    try {
      const res = await api.get("/conversations", { headers: authHeaders() });
      setConversations(res.data.conversations);
    } catch {
      // Silencioso: no es una acción disparada por el usuario, es una
      // resincronización de fondo -- un fallo puntual no amerita un Toast.
    }
  };

  // Resincroniza GET /api/notifications. Hace falta tras borrar una
  // publicación (ADR-019): PostgreSQL borra en cascada las notificaciones
  // que apuntaban a ese post (ADR-008), así que la lista en memoria queda
  // con notificaciones que el backend ya no tiene. Mismo criterio silencioso
  // que reloadConversations -- es una resincronización de fondo, no una
  // acción del usuario.
  const reloadNotifications = async () => {
    try {
      const res = await api.get("/notifications", { headers: authHeaders() });
      setNotifications(res.data.notifications.map(mapNotification));
    } catch {
      // Silencioso, mismo motivo que reloadConversations.
    }
  };

  const handleToggleFollow = (id) => {
    setFollowingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // PATCH /api/notifications/<id>/read (ADR-008-notifications-minimal-model.md).
  // Optimistic update + rollback, mismo patrón que handleToggleLike
  // (ADR-005). Un no-op silencioso si ya estaba leída o el id no existe más
  // en el estado local -- evita una request de más al reabrir el panel.
  const handleMarkRead = async (id) => {
    const notification = notifications.find((n) => n.id === id);
    if (!notification || notification.read) return;

    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));

    try {
      await api.patch(`/notifications/${id}/read`, null, { headers: authHeaders() });
    } catch (error) {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
      toast.error(getErrorMessage(error, t));
    }
  };

  // Sin endpoint batch en el backend (ADR-008 §No objetivos) -- marca cada
  // notificación no leída individualmente, reutilizando handleMarkRead
  // (mismo optimistic update + rollback por ítem, sin duplicar esa lógica).
  const handleMarkAllRead = () => {
    notifications.filter((n) => !n.read).forEach((n) => handleMarkRead(n.id));
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  // POST /api/posts (ADR-004-posts-minimal-model.md). Sin try/catch acá --
  // se propaga a CreateCapsuleFlow, que ya maneja error/loading con el mismo
  // patrón que AuthContext.updateProfile()/Profile.jsx (getErrorMessage +
  // Toast, formulario abierto para reintentar).
  // `isSensitive` (ADR-030): lo que el autor declara al publicar.
  //
  // `images` (ADR-039): sin imágenes se manda JSON, como siempre; con ellas,
  // multipart/form-data (el navegador pone el boundary solo, por eso no se fija
  // `Content-Type` a mano).
  const handleCreateCapsule = async (content, isSensitive = false, images = []) => {
    let body = { content, is_sensitive: isSensitive };
    if (images.length > 0) {
      body = new FormData();
      body.append("content", content);
      body.append("is_sensitive", String(isSensitive));
      images.forEach((file) => body.append("images", file));
    }
    const res = await api.post("/posts", body, { headers: authHeaders() });
    setCapsules((prev) => [res.data.post, ...prev]);
    setComposerOpen(false);
  };

  // DELETE /api/posts/<id> (ADR-019-post-deletion.md). Solo el autor puede
  // borrar su propia publicación -- el backend lo verifica contra el JWT y
  // responde 404 si el post no existe o no es suyo, así que el Frontend no
  // decide permisos, solo evita ofrecer la acción donde no aplica
  // (CapsuleCard oculta el botón si el post no es propio).
  // Optimistic update + rollback, mismo patrón que handleToggleLike
  // (ADR-005): la tarjeta desaparece al instante y vuelve si la petición
  // falla. `previous` guarda la lista completa, no solo el post borrado --
  // así el rollback lo restituye en su posición original del feed.
  const handleDeleteCapsule = async (postId) => {
    const previous = capsules;
    setCapsules((prev) => prev.filter((c) => c.id !== postId));

    try {
      await api.delete(`/posts/${postId}`, { headers: authHeaders() });
      // Las notificaciones de ese post (like/comentario) se borran en
      // cascada en PostgreSQL (ADR-008) -- se recargan para que el panel y
      // el badge no queden mostrando notificaciones de un post que ya no
      // existe.
      reloadNotifications();
    } catch (error) {
      setCapsules(previous);
      toast.error(getErrorMessage(error, t));
    }
  };

  // PATCH /api/posts/<id> (ADR-021-content-editing.md). Solo el autor puede
  // editar su propia publicación -- el backend lo verifica contra el JWT y
  // responde 404 si no existe o no es suya; CapsuleCard solo ofrece la acción
  // sobre publicaciones propias.
  //
  // Sin actualización optimista, a diferencia de handleDeleteCapsule: el
  // servidor devuelve la publicación completa ya editada (con `edited` y los
  // contadores reales de likes/comentarios, que la edición no toca), así que
  // se reemplaza con su respuesta en vez de adivinarla. Sin try/catch acá --
  // CapsuleCard lo maneja (Toast + el editor queda abierto para reintentar),
  // mismo criterio que handlePostComment.
  const handleEditCapsule = async (postId, content) => {
    const res = await api.patch(`/posts/${postId}`, { content }, { headers: authHeaders() });
    setCapsules((prev) => prev.map((c) => (c.id === postId ? res.data.post : c)));
    return res.data.post;
  };

  // POST/DELETE /api/posts/<id>/like (ADR-005-likes-minimal-model.md).
  // Optimistic update -- el toggle se ve al instante; si la request falla,
  // se revierte y se avisa con el mismo patrón de error que el resto de
  // AppShell (getErrorMessage + Toast). Ambos endpoints son idempotentes
  // (ADR-005 §Decisión), así que un doble clic durante una request en vuelo
  // nunca deja el contador desincronizado.
  const handleToggleLike = async (postId) => {
    const capsule = capsules.find((c) => c.id === postId);
    if (!capsule) return;

    const wasLiked = capsule.liked_by_me;
    const previousCount = capsule.likes_count;

    setCapsules((prev) =>
      prev.map((c) =>
        c.id === postId
          ? { ...c, liked_by_me: !wasLiked, likes_count: previousCount + (wasLiked ? -1 : 1) }
          : c
      )
    );

    try {
      const res = wasLiked
        ? await api.delete(`/posts/${postId}/like`, { headers: authHeaders() })
        : await api.post(`/posts/${postId}/like`, null, { headers: authHeaders() });
      setCapsules((prev) => prev.map((c) => (c.id === postId ? { ...c, ...res.data } : c)));
    } catch (error) {
      setCapsules((prev) =>
        prev.map((c) => (c.id === postId ? { ...c, liked_by_me: wasLiked, likes_count: previousCount } : c))
      );
      toast.error(getErrorMessage(error, t));
    }
  };

  // GET /api/posts/<id>/comments (ADR-006-comments-minimal-model.md). A
  // diferencia de likes_count (que viaja con cada post), los comentarios se
  // piden bajo demanda cuando CapsuleCard abre su panel -- no tiene sentido
  // cargar el hilo completo de cada post del feed de antemano. Sin
  // try/catch acá -- CapsuleCard lo maneja (Toast + estado local del panel),
  // mismo criterio que handleCreateCapsule/CreateCapsuleFlow.
  const handleLoadComments = async (postId) => {
    const res = await api.get(`/posts/${postId}/comments`, { headers: authHeaders() });
    return res.data.comments;
  };

  // POST /api/posts/<id>/comments. El contador (`comments_count`) vive en
  // `capsules` (AppShell), no en CapsuleCard -- se actualiza acá para que
  // el número en la tarjeta quede sincronizado apenas el comentario se
  // publica, sin depender de que CapsuleCard vuelva a pedir el post entero.
  const handlePostComment = async (postId, content) => {
    const res = await api.post(
      `/posts/${postId}/comments`,
      { content },
      { headers: authHeaders() }
    );
    setCapsules((prev) =>
      prev.map((c) => (c.id === postId ? { ...c, comments_count: c.comments_count + 1 } : c))
    );
    return res.data.comment;
  };

  // DELETE /api/comments/<id> (ADR-020-comment-deletion.md). Solo el autor del
  // comentario puede borrarlo -- el backend lo verifica contra el JWT y
  // responde 404 si no existe o no es suyo; CapsuleCard solo ofrece la acción
  // sobre comentarios propios. Sin try/catch acá -- CapsuleCard lo maneja
  // (Toast + estado local del panel), mismo criterio que handlePostComment.
  // `comments_count` vive en `capsules` (AppShell), así que se baja acá para
  // que el número de la tarjeta quede sincronizado, espejo de
  // handlePostComment. No hay notificación que retirar: la de "comentó tu
  // publicación" no guarda a qué comentario corresponde (ADR-020 §Riesgos).
  const handleDeleteComment = async (postId, commentId) => {
    await api.delete(`/comments/${commentId}`, { headers: authHeaders() });
    setCapsules((prev) =>
      prev.map((c) =>
        c.id === postId ? { ...c, comments_count: Math.max(0, c.comments_count - 1) } : c
      )
    );
  };

  // PATCH /api/comments/<id> (ADR-021-content-editing.md). Mismo reparto que
  // handleDeleteComment: la petición vive acá, el hilo de comentarios abierto
  // es estado local de CapsuleCard, que recibe el comentario ya editado y lo
  // reemplaza en su lista. No toca `capsules`: editar no mueve
  // `comments_count` (a diferencia de crear/borrar). Sin try/catch acá --
  // CapsuleCard lo maneja, mismo criterio que handlePostComment.
  const handleEditComment = async (commentId, content) => {
    const res = await api.patch(
      `/comments/${commentId}`,
      { content },
      { headers: authHeaders() }
    );
    return res.data.comment;
  };

  // POST/DELETE /api/users/<id>/follow (ADR-007-follows-minimal-model.md,
  // extendido por ADR-022-private-accounts.md).
  //
  // No reutiliza followingIds/handleToggleFollow (ese Set en memoria sigue
  // siendo exclusivo del panel de sugerencias mock de Home.jsx -- esas
  // personas no existen en el backend, llamar a este endpoint con sus ids
  // daría 404 real). Actúa sobre `author.follow_status`, que ya viaja con cada
  // post -- y actualiza TODOS los posts de ese autor en `capsules`, no solo el
  // que disparó la acción, para que el estado quede consistente en toda la
  // tarjeta del feed.
  //
  // Tres estados desde ADR-022, no dos: seguir una cuenta privada crea una
  // solicitud ('pending'), no una relación. El mismo DELETE sirve para dejar
  // de seguir y para cancelar una solicitud, así que el botón es un toggle
  // igual que antes -- lo que cambia es a qué estado va.
  //
  // Optimistic update + rollback, mismo patrón que handleToggleLike (ADR-005).
  // El estado optimista se predice con `author.is_private` (que el contrato ya
  // expone justamente para esto) y después se reconcilia con la respuesta real
  // del servidor, que es la única autoridad sobre el estado final.
  const handleToggleFollowAuthor = async (authorId) => {
    const capsule = capsules.find((c) => c.author.id === authorId);
    if (!capsule) return;

    const previousStatus = capsule.author.follow_status ?? null;
    const hasRelation = previousStatus !== null;
    const optimisticStatus = hasRelation
      ? null
      : capsule.author.is_private
        ? "pending"
        : "accepted";

    const applyStatus = (status) =>
      setCapsules((prev) =>
        prev.map((c) =>
          c.author.id === authorId
            ? {
                ...c,
                author: {
                  ...c.author,
                  follow_status: status,
                  // Se mantiene sincronizado con el contrato:
                  // `is_followed_by_me` es true solo con un follow aceptado.
                  is_followed_by_me: status === "accepted",
                },
              }
            : c
        )
      );

    applyStatus(optimisticStatus);

    try {
      const res = hasRelation
        ? await api.delete(`/users/${authorId}/follow`, { headers: authHeaders() })
        : await api.post(`/users/${authorId}/follow`, null, { headers: authHeaders() });
      applyStatus(res.data.follow_status ?? null);
    } catch (error) {
      applyStatus(previousStatus);
      toast.error(getErrorMessage(error, t));
    }
  };

  // Guard defensivo, no una decisión de ruteo: ProtectedRoute ya garantiza
  // isAuthenticated antes de montar AppShell; esto solo evita un crash en el
  // instante de re-render que sigue a logout() (currentUser pasa a null un
  // tick antes de que la navegación a /login desmonte este árbol).
  if (!currentUser) return null;

  // Variante visual del shell según la ruta. Las referencias se reparten en
  // dos familias (slate/288px para lo social, luminous/256px para
  // Configuración y Mensajes) y `data-th-shell` resuelve los tokens de
  // tokens.css sin duplicar el shell (docs/THERS_REFERENCE_MANIFEST.md §5).
  const shellVariant = shellVariantFor(location.pathname);

  return (
    <ShellFrame
      variant={shellVariant}
      currentUser={currentUser}
      unreadMessages={unreadMessages}
      hasUnreadNotifications={unreadCount > 0}
      onCreate={() => setComposerOpen(true)}
      onLogout={handleLogout}
      theme={theme}
      onToggleTheme={toggleTheme}
      drawerOpen={drawerOpen}
      onOpenDrawer={() => setDrawerOpen(true)}
      onCloseDrawer={() => setDrawerOpen(false)}
    >
      <Outlet
        context={{
          currentUser,
          capsules,
          capsulesLoading,
          followingIds,
          notifications,
          conversations,
          onReloadConversations: reloadConversations,
          theme,
          toggleTheme,
          onToggleFollow: handleToggleFollow,
          onMarkRead: handleMarkRead,
          onMarkAllRead: handleMarkAllRead,
          onUpdateUser: updateProfile,
          onUploadProfileImage: uploadProfileImage,
          onRemoveProfileImage: removeProfileImage,
          onOpenComposer: () => setComposerOpen(true),
          onToggleLike: handleToggleLike,
          onLoadComments: handleLoadComments,
          onPostComment: handlePostComment,
          onDeleteComment: handleDeleteComment,
          onEditComment: handleEditComment,
          onToggleFollowAuthor: handleToggleFollowAuthor,
          onDeleteCapsule: handleDeleteCapsule,
          onEditCapsule: handleEditCapsule,
        }}
      />

      {isComposerOpen && (
        <CreateCapsuleFlow
          currentUser={currentUser}
          onClose={() => setComposerOpen(false)}
          onSubmit={handleCreateCapsule}
        />
      )}
    </ShellFrame>
  );
}
