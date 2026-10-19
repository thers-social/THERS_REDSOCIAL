import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { IoSearchOutline, IoArrowBack, IoImageOutline, IoVideocamOutline, IoSend, IoChatbubblesOutline, IoTrashOutline, IoPencilOutline, IoPeopleOutline, IoInformationCircleOutline } from "react-icons/io5";
import Avatar from "@shared/components/Avatar";
import ConfirmDialog from "@shared/components/ConfirmDialog";
import ImageAttachmentPicker from "@shared/components/ImageAttachmentPicker";
import ImageGrid from "@shared/components/ImageGrid";
import VideoAttachmentPicker from "@shared/components/VideoAttachmentPicker";
import VoiceNotePlayer from "@shared/components/VoiceNotePlayer";
import VoiceRecorderBar, { VoiceRecordButton } from "@shared/components/VoiceRecorderBar";
import SharedPlaceCard from "@shared/components/SharedPlaceCard";
import SharedPostCard from "@shared/components/SharedPostCard";
import useImageAttachments from "@shared/hooks/useImageAttachments";
import VideoPlayer from "@shared/components/VideoPlayer";
import useVideoAttachment from "@shared/hooks/useVideoAttachment";
import { ACCEPTED_VIDEO_TYPES, VIDEO_ENABLED, videoSendErrorKind } from "@shared/lib/videoAttachments";
import useVoiceRecorder from "@shared/hooks/useVoiceRecorder";
import { VOICE_ENABLED } from "@shared/lib/voiceConfig";
import { extensionFor, sendErrorKind } from "@shared/lib/voice";
import { ACCEPTED_IMAGE_TYPES } from "@shared/lib/imageAttachments";
import { api, getErrorMessage } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import { formatRelativeTime } from "../lib/formatRelativeTime";
import CreateGroupDialog from "../components/CreateGroupDialog";
import GroupInfoDialog from "../components/GroupInfoDialog";

// Mensajes directos reales (POST/GET/PATCH/DELETE .../messages,
// GET /api/conversations -- ADR-013-messages-minimal-model.md,
// ADR-014-messages-ux-improvements.md, ADR-021-content-editing.md).
// `conversations` llega por contexto desde AppShell.jsx (mismo patrón que
// `capsules`/`notifications`: se carga una sola vez ahí, no en cada página).
// El hilo abierto, su envío/borrado y el indicador de "escribiendo" son
// estado propio de esta página.
//
// Presencia: `mockConversations` tenía un campo `online` inventado, que se
// quitó por no tener dato real detrás. Desde
// ADR-024-content-filters-and-privacy-preferences.md sí existe uno:
// `user.last_seen_at` en GET /api/conversations. Llega en `null` cuando la otra
// persona oculta su actividad O cuando nunca registró ninguna -- los dos casos
// son indistinguibles a propósito, para que apagar el interruptor no se note
// (ADR-024 §Seguridad). Se sigue sin mostrar un indicador "en línea" en verde:
// el dato es "última vez activo", no presencia en tiempo real.

function authHeaders() {
  return { Authorization: `Bearer ${getStoredToken()}` };
}

// Mientras un hilo está abierto, se vuelve a pedir cada pocos segundos para
// recibir mensajes nuevos de la otra persona -- sin WebSockets/SSE todavía
// (ADR-013 §No objetivos), este es el único mecanismo de "tiempo real".
const THREAD_POLL_MS = 4000;
// "Escribiendo..." necesita sentirse más inmediato que el resto del chat
// para no parecer roto -- mismo motivo por el que ADR-014 eligió un
// intervalo más corto para esto que para el hilo en sí.
const TYPING_POLL_MS = 2000;
const TYPING_PING_MIN_INTERVAL_MS = 2000;
// Una imagen por mensaje (ADR-039), más chica que en una publicación.
const MAX_MESSAGE_IMAGES = 1;
const MAX_MESSAGE_IMAGE_SIDE = 1280;

// Qué lleva el último mensaje, para la vista previa de la lista (directos y grupos).
function lastMessagePreview(last, t) {
  return (
    last.content ||
    (last.has_image ? "📷 Foto" : "") ||
    (last.has_audio ? t("voice.preview_list") : "") ||
    (last.has_video ? "🎬 Video" : "") ||
    (last.has_place ? t("places.share.preview") : "") ||
    (last.has_post ? t("postActions.card.preview") : "")
  );
}

export default function Messages() {
  const { currentUser, conversations, groups = [], onReloadConversations } = useOutletContext();
  const toast = useToast();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeId, setActiveId] = useState(null);
  // Chat grupal abierto (ADR-048). Excluyente con `activeId`: o se mira un directo o un grupo.
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [thread, setThread] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  // Video corto (ADR-046): uno por mensaje, excluyente con imágenes y nota de voz.
  const video = useVideoAttachment();
  const image = useImageAttachments({ max: MAX_MESSAGE_IMAGES, maxSide: MAX_MESSAGE_IMAGE_SIDE });
  // Nota de voz (ADR-042): grabar, revisar y enviar. Solo existe con VITE_VOICE_ENABLED.
  const voice = useVoiceRecorder();
  const [search, setSearch] = useState("");
  // Mensaje pendiente de confirmar para borrar (ADR-014). `null` = diálogo
  // cerrado. Se guarda el id, no un booleano, para saber cuál borrar al confirmar.
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  // Mensaje en edición en línea (PATCH /api/messages/<id>, ADR-021). `null` =
  // ninguno. Sin ConfirmDialog, a diferencia de borrar: una edición se puede
  // volver a editar, así que no hace falta confirmar nada.
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Id del primer mensaje sin leer al abrir el hilo -- calculado una sola
  // vez con la primera respuesta (ADR-014 §Decisión: `read` refleja el
  // estado ANTES de marcar como leído solo en esa primera llamada), no en
  // cada refresco del polling siguiente, para que el separador no
  // desaparezca mientras la persona sigue mirando la pantalla.
  const [unreadDividerId, setUnreadDividerId] = useState(null);
  const [otherIsTyping, setOtherIsTyping] = useState(false);
  const threadEndRef = useRef(null);
  const lastTypingPingRef = useRef(0);
  // Hilo nuevo abierto desde el botón "Mensaje" de CapsuleCard (?to=/&name=/
  // &username=) -- GET /api/conversations solo lista gente con la que ya
  // hay al menos un mensaje, así que esto rellena el panel mientras el
  // primer mensaje todavía no se mandó. Una vez enviado, `conversations`
  // (real, del backend) pasa a incluirlo y este estado deja de usarse para
  // ese usuario.
  const [draftConversation, setDraftConversation] = useState(null);

  useEffect(() => {
    const to = searchParams.get("to");
    if (!to) return;

    setActiveId(to);
    setActiveGroupId(null);
    const alreadyReal = conversations.some((c) => c.user.id === to);
    if (!alreadyReal) {
      setDraftConversation({
        user: {
          id: to,
          name: searchParams.get("name") || "Usuario",
          username: searchParams.get("username") || "",
        },
        last_message: { content: "", sender_id: null, created_at: new Date().toISOString() },
        unread_count: 0,
      });
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const realActive = conversations.find((c) => c.user.id === activeId) || null;
  const active = realActive || (draftConversation?.user.id === activeId ? draftConversation : null);
  const list =
    draftConversation && !conversations.some((c) => c.user.id === draftConversation.user.id)
      ? [draftConversation, ...conversations]
      : conversations;
  const filtered = list.filter((c) => c.user.name.toLowerCase().includes(search.toLowerCase()));

  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;
  const chatOpen = active || activeGroup;
  const messagesPath = activeGroupId ? `/groups/${activeGroupId}/messages` : `/users/${activeId}/messages`;
  // Directos y grupos en una sola lista, por actividad reciente.
  const rows = [
    ...filtered.map((c) => ({
      kind: "dm",
      key: c.user.id,
      name: c.user.name,
      photo: c.user.avatar_url,
      preview: lastMessagePreview(c.last_message, t),
      at: c.last_message.created_at,
      unread: c.unread_count,
    })),
    ...groups
      .filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
      .map((g) => ({
        kind: "group",
        key: g.id,
        name: g.name,
        preview: g.last_message
          ? `${g.last_message.sender_id === currentUser.id ? t("groups.you") : g.last_message.sender_name}: ${lastMessagePreview(g.last_message, t)}`
          : t("groups.empty"),
        at: g.last_message ? g.last_message.created_at : g.created_at,
        unread: g.unread_count,
      })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  useEffect(() => {
    if (!activeId && !activeGroupId) return undefined;
    let cancelled = false;
    let firstLoad = true;

    async function loadThread() {
      try {
        const res = await api.get(messagesPath, { headers: authHeaders() });
        if (cancelled) return;
        setThread(res.data.messages);
        if (firstLoad) {
          const firstUnread = res.data.messages.find(
            (m) => !m.read && m.sender_id !== currentUser.id
          );
          setUnreadDividerId(firstUnread ? firstUnread.id : null);
          firstLoad = false;
        }
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error, t));
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    }

    async function pollTypingStatus() {
      // "Escribiendo" solo existe en los directos.
      if (activeGroupId) return;
      try {
        const res = await api.get(`/users/${activeId}/typing`, { headers: authHeaders() });
        if (!cancelled) setOtherIsTyping(res.data.typing);
      } catch {
        // Silencioso: "escribiendo" es un detalle cosmético, no amerita
        // interrumpir al usuario con un Toast si un poll puntual falla.
      }
    }

    setThreadLoading(true);
    setUnreadDividerId(null);
    setOtherIsTyping(false);
    loadThread();
    // Abrir el hilo marca como leídos los mensajes recibidos (efecto
    // secundario del GET, ADR-013) -- refresca la lista para que el
    // `unread_count` de esta conversación y el badge del shell bajen.
    onReloadConversations();

    const threadInterval = setInterval(loadThread, THREAD_POLL_MS);
    const typingInterval = setInterval(pollTypingStatus, TYPING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(threadInterval);
      clearInterval(typingInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeGroupId]);

  // Hace scroll al mensaje más reciente cada vez que el hilo cambia (al
  // abrirlo, al recibir uno nuevo por polling, o al mandar uno propio) --
  // sin esto, un hilo largo se abría mostrando el mensaje más viejo primero.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [thread]);

  // Cambiar de conversación descarta la imagen que se estaba preparando: no
  // debe viajar a otra persona por haber quedado en la barra (ADR-039).
  const selectConversation = (id) => {
    image.clear();
    // Lo mismo con una nota de voz grabada: no debe viajar a otra persona (ADR-042).
    voice.clear();
    setActiveGroupId(null);
    setShowGroupInfo(false);
    setActiveId(id);
  };

  const selectGroup = (id) => {
    image.clear();
    video.clear();
    voice.clear();
    setActiveId(null);
    setShowGroupInfo(false);
    setActiveGroupId(id);
  };

  const handleDraftChange = (e) => {
    setDraft(e.target.value);
    if (!activeId) return;

    const now = Date.now();
    if (now - lastTypingPingRef.current < TYPING_PING_MIN_INTERVAL_MS) return;
    lastTypingPingRef.current = now;
    api.post(`/users/${activeId}/typing`, null, { headers: authHeaders() }).catch(() => {
      // Mismo criterio que pollTypingStatus: un ping perdido no es un error
      // que el usuario necesite ver.
    });
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const content = draft.trim();
    // Con imagen o video el texto es opcional (ADR-039, ADR-046).
    if ((!content && image.files.length === 0 && !video.file) || !chatOpen || sending || image.processing || video.processing) return;

    setSending(true);
    try {
      let body = { content };
      if (image.files.length > 0 || video.file) {
        body = new FormData();
        body.append("content", content);
        image.files.forEach((file) => body.append("images", file));
        if (video.file) body.append("video", video.file);
      }
      const res = await api.post(messagesPath, body, { headers: authHeaders() });
      setThread((prev) => [...prev, res.data.message]);
      setDraft("");
      image.clear();
      video.clear();
      setDraftConversation(null);
      onReloadConversations();
    } catch (error) {
      const kind = videoSendErrorKind(error);
      toast.error(
        kind === "disabled"
          ? "Los videos no están disponibles ahora."
          : kind === "too_large"
            ? "El video pesa demasiado: 25 MB como máximo."
            : getErrorMessage(error, t)
      );
    } finally {
      setSending(false);
    }
  };

  // Envía la nota de voz grabada (ADR-042): multipart con el campo `audio`. El texto del
  // campo, si lo hay, viaja con ella. El servidor decodifica, normaliza y calcula la duración;
  // aquí no se manda ninguna. Nada se envía solo: esto solo corre al pulsar «Enviar».
  const handleSendVoice = async () => {
    const recording = voice.recording;
    if (!recording || !chatOpen || sending) return;

    setSending(true);
    try {
      const body = new FormData();
      body.append("content", draft.trim());
      body.append(
        "audio",
        new File([recording.blob], `nota.${extensionFor(recording.mime)}`, { type: recording.mime })
      );
      const res = await api.post(messagesPath, body, { headers: authHeaders() });
      setThread((prev) => [...prev, res.data.message]);
      setDraft("");
      voice.clear();
      setDraftConversation(null);
      onReloadConversations();
    } catch (error) {
      // La grabación queda en pantalla para poder reintentar.
      const kind = sendErrorKind(error);
      toast.error(kind ? t(`voice.errors.${kind}`) : getErrorMessage(error, t));
    } finally {
      setSending(false);
    }
  };

  // PATCH /api/messages/<id> (ADR-021). Solo quien mandó el mensaje puede
  // editarlo -- el backend lo verifica contra el JWT y responde 404 si no
  // existe o es de otra persona; acá solo se evita ofrecer el lápiz donde no
  // aplica. El polling del hilo (THREAD_POLL_MS) reemplaza `thread` cada pocos
  // segundos, pero nunca el borrador: `editDraft`/`editingId` son estado
  // aparte, así que escribir una corrección no se pierde entre refrescos.
  const handleStartEdit = (message) => {
    setEditDraft(message.content);
    setEditingId(message.id);
  };

  const handleSubmitEdit = async (e) => {
    e.preventDefault();
    const content = editDraft.trim();
    const original = thread.find((m) => m.id === editingId);
    // Un guardado sin cambios no se manda: marcaría el mensaje como «editado»
    // sin que nada hubiera cambiado.
    if (!content || !original || content === original.content || savingEdit) return;

    setSavingEdit(true);
    try {
      const res = await api.patch(
        `/messages/${editingId}`,
        { content },
        { headers: authHeaders() }
      );
      setThread((prev) => prev.map((m) => (m.id === editingId ? res.data.message : m)));
      setEditingId(null);
      // El resumen de la conversación muestra el texto del último mensaje, que
      // pudo ser justo el editado -- se resincroniza igual que al mandar uno.
      onReloadConversations();
    } catch (error) {
      // El editor queda abierto con lo escrito para reintentar.
      toast.error(getErrorMessage(error, t));
    } finally {
      setSavingEdit(false);
    }
  };

  // El botón de la papelera solo abre el diálogo de confirmación propio de
  // THERS (ConfirmDialog); el borrado real corre recién al confirmar.
  const handleDelete = async (messageId) => {
    setPendingDeleteId(null);

    const previous = thread;
    setThread((prev) => prev.filter((m) => m.id !== messageId));
    try {
      await api.delete(`/messages/${messageId}`, { headers: authHeaders() });
      onReloadConversations();
    } catch (error) {
      setThread(previous);
      toast.error(getErrorMessage(error, t));
    }
  };

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-9rem)]">
      <div className="bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-[28px] shadow-soft h-full flex overflow-hidden">
        <div className={`w-full md:w-80 shrink-0 border-r border-line dark:border-line-dark flex-col ${chatOpen ? "hidden md:flex" : "flex"}`}>
          <div className="p-4 border-b border-line dark:border-line-dark">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h1 className="text-lg font-extrabold text-ink dark:text-ink-dark">Mensajes</h1>
              <button
                type="button"
                onClick={() => setShowCreateGroup(true)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-pulse-600 hover:bg-pulse-50 dark:hover:bg-pulse-900/20"
              >
                <IoPeopleOutline size={16} />
                {t("groups.new")}
              </button>
            </div>
            <div className="relative">
              <IoSearchOutline className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conversaciones..."
                aria-label="Buscar conversaciones"
                className="w-full bg-canvas dark:bg-canvas-dark border border-transparent rounded-full pl-9 pr-3 py-2 text-sm text-ink dark:text-ink-dark placeholder-muted focus:outline-none focus:ring-2 focus:ring-pulse-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {rows.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted">
                <IoChatbubblesOutline size={28} />
                <p className="text-sm">
                  {conversations.length === 0 && groups.length === 0
                    ? "Todavía no tenés conversaciones. Tocá el ícono de mensaje junto a una publicación para empezar una."
                    : "Ninguna conversación coincide con la búsqueda."}
                </p>
              </div>
            )}
            {rows.map((row) => {
              const isActive = row.kind === "group" ? activeGroupId === row.key : activeId === row.key;
              return (
                <button
                  key={`${row.kind}-${row.key}`}
                  onClick={() => (row.kind === "group" ? selectGroup(row.key) : selectConversation(row.key))}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas dark:hover:bg-canvas-dark transition ${
                    isActive ? "bg-pulse-50 dark:bg-pulse-900/20" : ""
                  }`}
                >
                  {row.kind === "group" ? (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-pulse-100 text-pulse-700 dark:bg-pulse-900/30 dark:text-pulse-300" aria-label={t("groups.label")}>
                      <IoPeopleOutline size={22} />
                    </span>
                  ) : (
                    <Avatar name={row.name} photo={row.photo} size="w-11 h-11" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-ink dark:text-ink-dark text-sm font-semibold truncate">{row.name}</p>
                      <span className="text-muted text-[11px] shrink-0">{formatRelativeTime(row.at)}</span>
                    </div>
                    <p className="text-muted text-xs truncate">{row.preview}</p>
                  </div>
                  {row.unread > 0 && (
                    <span className="shrink-0 w-5 h-5 rounded-full bg-pulse-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {row.unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className={`flex-1 flex-col min-w-0 ${chatOpen ? "flex" : "hidden md:flex"}`}>
          {chatOpen ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-line dark:border-line-dark">
                <button
                  onClick={() => selectConversation(null)}
                  aria-label="Volver a conversaciones"
                  className="md:hidden text-muted p-1 -ml-1"
                >
                  <IoArrowBack size={20} />
                </button>
                {activeGroup ? (
                  <>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pulse-100 text-pulse-700 dark:bg-pulse-900/30 dark:text-pulse-300">
                      <IoPeopleOutline size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-ink dark:text-ink-dark text-sm font-semibold truncate">{activeGroup.name}</p>
                      <p className="text-muted text-xs">{t("groups.members", { count: activeGroup.member_count })}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowGroupInfo(true)}
                      aria-label={t("groups.openInfo")}
                      className="shrink-0 rounded-full p-2 text-muted transition hover:text-pulse-600"
                    >
                      <IoInformationCircleOutline size={20} />
                    </button>
                  </>
                ) : (
                  <>
                <Link to={`/user/${active.user.id}`} aria-label={active.user.name} className="shrink-0">
                  <Avatar name={active.user.name} photo={active.user.avatar_url} size="w-9 h-9" />
                </Link>
                <div className="min-w-0">
                  <Link
                    to={`/user/${active.user.id}`}
                    className="block text-ink dark:text-ink-dark text-sm font-semibold truncate hover:underline"
                  >
                    {active.user.name}
                  </Link>
                  {otherIsTyping ? (
                    <p className="text-pulse-600 text-xs animate-pulse">Escribiendo...</p>
                  ) : (
                    // "Escribiendo" tiene prioridad: si está escribiendo ahora,
                    // decir "activo hace 5 min" sería contradictorio.
                    active.user.last_seen_at && (
                      <p className="text-muted text-xs">
                        Activo {formatRelativeTime(active.user.last_seen_at)}
                      </p>
                    )
                  )}
                </div>

                  </>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {threadLoading ? (
                  <p className="text-center text-muted text-sm">Cargando...</p>
                ) : (
                  thread.map((message) => (
                    <div key={message.id}>
                      {message.id === unreadDividerId && (
                        <div className="flex items-center gap-3 py-2" role="separator">
                          <span className="h-px flex-1 bg-line dark:bg-line-dark" />
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            Mensajes no leídos
                          </span>
                          <span className="h-px flex-1 bg-line dark:bg-line-dark" />
                        </div>
                      )}
                      <div
                        className={`group flex items-center gap-1.5 animate-float-in ${
                          message.sender_id === currentUser.id ? "justify-end" : "justify-start"
                        }`}
                      >
                        {message.sender_id === currentUser.id && editingId !== message.id && (
                          <>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(message.id)}
                              aria-label="Eliminar mensaje"
                              className="shrink-0 rounded-full p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:text-red-500"
                            >
                              <IoTrashOutline size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(message)}
                              aria-label="Editar mensaje"
                              className="shrink-0 rounded-full p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:text-pulse-600"
                            >
                              <IoPencilOutline size={14} />
                            </button>
                          </>
                        )}
                        {editingId === message.id ? (
                          <form
                            onSubmit={handleSubmitEdit}
                            className="flex max-w-[85%] flex-1 items-center gap-2"
                          >
                            <label htmlFor={`edit-message-${message.id}`} className="sr-only">
                              Editar el mensaje
                            </label>
                            <input
                              id={`edit-message-${message.id}`}
                              type="text"
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              maxLength={2000}
                              disabled={savingEdit}
                              className="flex-1 rounded-full border border-pulse-500 bg-canvas dark:bg-canvas-dark px-4 py-2 text-sm text-ink dark:text-ink-dark focus:outline-none focus:ring-2 focus:ring-pulse-500 disabled:opacity-60"
                            />
                            <button
                              type="submit"
                              disabled={
                                !editDraft.trim() ||
                                editDraft.trim() === message.content ||
                                savingEdit
                              }
                              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-pulse-600 transition hover:bg-pulse-50 dark:hover:bg-pulse-900/20 disabled:opacity-40"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              disabled={savingEdit}
                              className="shrink-0 rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-ink dark:hover:text-ink-dark disabled:opacity-40"
                            >
                              Cancelar
                            </button>
                          </form>
                        ) : (
                          <div
                            className={`max-w-[75%] rounded-2xl text-sm ${
                              // Con foto o video la burbuja es un marco fino de 3 px alrededor del medio.
                              message.images?.length || message.video ? "p-[3px]" : "px-4 py-2"
                            } ${
                              message.sender_id === currentUser.id
                                ? "bg-[#5b21b6] dark:bg-[#4c1d95] text-white rounded-br-md"
                                : "bg-canvas dark:bg-canvas-dark text-ink dark:text-ink-dark rounded-bl-md"
                            }`}
                          >
                            {/* En un grupo hace falta saber quién habla (ADR-048). */}
                            {activeGroup && message.sender_id !== currentUser.id && (
                              <span className="mb-0.5 block text-[11px] font-semibold text-pulse-600">
                                {message.sender?.name}
                              </span>
                            )}
                            {/* Imagen adjunta (ADR-039). */}
                            <ImageGrid
                              images={message.images}
                              alt="Imagen del mensaje"
                              compact
                            />
                            {/* Video corto (ADR-046). */}
                            <VideoPlayer video={message.video} label="Video del mensaje" compact />
                            {/* Nota de voz (ADR-042). */}
                            {message.audio && (
                              <VoiceNotePlayer
                                url={message.audio.url}
                                durationMs={message.audio.duration_ms}
                                mine={message.sender_id === currentUser.id}
                              />
                            )}
                            {/* Lugar compartido (ADR-040 fase 4c). */}
                            {message.place && (
                              <SharedPlaceCard place={message.place} mine={message.sender_id === currentUser.id} />
                            )}
                            {/* Publicación compartida (ADR-047). */}
                            {message.post && (
                              <SharedPostCard post={message.post} mine={message.sender_id === currentUser.id} />
                            )}
                            {message.content && (
                              <span
                                className={
                                  message.images?.length || message.video
                                    ? "block px-2.5 pb-1 pt-1.5"
                                    : message.place || message.post || message.audio
                                      ? "mt-2 block"
                                      : ""
                                }
                              >
                                {message.content}
                              </span>
                            )}
                            {/* `edited` es un booleano en el contrato
                                (ADR-021): se dice QUE se editó, no cuándo. */}
                            {message.edited && (
                              <span
                                className={`ml-2 text-[10px] ${
                                  message.sender_id === currentUser.id
                                    ? "text-white/70"
                                    : "text-muted"
                                }`}
                              >
                                editado
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {activeGroup && !threadLoading && thread.length === 0 && (
                  <p className="text-center text-muted text-sm">{t("groups.empty")}</p>
                )}
                <div ref={threadEndRef} />
              </div>

              <form onSubmit={handleSend} className="flex flex-col gap-2 px-4 py-3 border-t border-line dark:border-line-dark">
                {(video.item || video.error) && (
                  <div className="flex items-center gap-2">
                    <VideoAttachmentPicker video={video} compact hideButton disabled={sending} />
                  </div>
                )}
                {(image.items.length > 0 || image.error) && (
                  <ImageAttachmentPicker
                    compact
                    hideButton
                    items={image.items}
                    max={MAX_MESSAGE_IMAGES}
                    processing={image.processing}
                    disabled={sending}
                    error={image.error}
                    onAdd={image.add}
                    onRemove={image.remove}
                  />
                )}
                {VOICE_ENABLED && voice.error && (
                  <p role="alert" className="px-2 text-xs text-ember-600">
                    {t(`voice.errors.${voice.error}`)}
                  </p>
                )}
                {VOICE_ENABLED && voice.status !== "idle" ? (
                  <div className="flex items-center gap-2">
                    <VoiceRecorderBar voice={voice} sending={sending} onSend={handleSendVoice} />
                  </div>
                ) : (
                <div className="flex items-center gap-2">
                <Avatar name={currentUser.name} photo={currentUser.avatar_url} size="w-8 h-8" />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(",")}
                  onChange={(e) => {
                    image.add(e.target.files);
                    e.target.value = "";
                  }}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={sending || image.processing || image.items.length >= MAX_MESSAGE_IMAGES || video.file !== null}
                  aria-label="Adjuntar una foto"
                  className="shrink-0 rounded-full p-2 text-muted transition hover:text-pulse-600 disabled:opacity-40"
                >
                  <IoImageOutline size={20} />
                </button>
                {VIDEO_ENABLED && (
                  <>
                    <input
                      ref={videoInputRef}
                      type="file"
                      accept={ACCEPTED_VIDEO_TYPES.join(",")}
                      onChange={(e) => {
                        video.add(e.target.files);
                        e.target.value = "";
                      }}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      disabled={sending || video.processing || video.file !== null || image.items.length > 0}
                      aria-label="Adjuntar un video"
                      className="shrink-0 rounded-full p-2 text-muted transition hover:text-pulse-600 disabled:opacity-40"
                    >
                      <IoVideocamOutline size={20} />
                    </button>
                  </>
                )}
                {VOICE_ENABLED && !draft.trim() && image.items.length === 0 && !video.file && (
                  <VoiceRecordButton voice={voice} disabled={sending || image.processing} />
                )}
                <input
                  type="text"
                  value={draft}
                  onChange={handleDraftChange}
                  placeholder="Escribe un mensaje..."
                  aria-label="Escribir un mensaje"
                  className="flex-1 bg-canvas dark:bg-canvas-dark border border-transparent rounded-full px-4 py-2 text-sm text-ink dark:text-ink-dark placeholder-muted focus:outline-none focus:ring-2 focus:ring-pulse-500"
                />
                <button
                  type="submit"
                  disabled={(!draft.trim() && image.files.length === 0 && !video.file) || sending || image.processing || video.processing}
                  aria-label="Enviar mensaje"
                  className={`p-2.5 rounded-full transition ${
                    (draft.trim() || image.files.length > 0 || video.file) && !sending && !image.processing && !video.processing
                      ? "bg-pulse-600 text-white hover:bg-pulse-700"
                      : "bg-line dark:bg-line-dark text-muted"
                  }`}
                >
                  <IoSend size={16} />
                </button>
                </div>
                )}
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted">
              <IoChatbubblesOutline size={40} />
              <p className="text-sm">Elige una conversación para empezar a chatear</p>
            </div>
          )}
        </div>
      </div>

      {showCreateGroup && (
        <CreateGroupDialog
          people={conversations.map((c) => c.user)}
          onClose={() => setShowCreateGroup(false)}
          onCreated={(group) => {
            setShowCreateGroup(false);
            onReloadConversations();
            selectGroup(group.id);
            toast.success(t("groups.created"));
          }}
        />
      )}
      {showGroupInfo && activeGroupId && (
        <GroupInfoDialog
          groupId={activeGroupId}
          currentUserId={currentUser.id}
          people={conversations.map((c) => c.user)}
          onClose={() => setShowGroupInfo(false)}
          onChanged={onReloadConversations}
          onLeft={() => {
            setShowGroupInfo(false);
            setActiveGroupId(null);
            onReloadConversations();
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        icon="delete"
        destructive
        title="¿Eliminar este mensaje?"
        description="Se borrará para ti y para la otra persona. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => handleDelete(pendingDeleteId)}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
