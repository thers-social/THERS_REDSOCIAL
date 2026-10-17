import { useOutletContext } from "react-router-dom";
import {
  IoHeart,
  IoPersonAdd,
  IoChatbubble,
  IoCheckmarkDoneOutline,
  IoStorefront,
} from "react-icons/io5";
import Avatar from "@shared/components/Avatar";
import { isPlaceNotice } from "../lib/mapNotification";

// Tipos reales que GET /api/notifications puede devolver
// (ADR-008-notifications-minimal-model.md) -- "mention" no está en esta
// lista: el backend nunca lo produce todavía (mentions sigue sin ratificar,
// DATABASE_ARCHITECTURE.md §4.B).
const ICONS = {
  like: { icon: IoHeart, color: "text-ember-500" },
  follow: { icon: IoPersonAdd, color: "text-pulse-500" },
  comment: { icon: IoChatbubble, color: "text-muted" },
};

// ADR-040 fase 12: avisos de Places (reservas, cotizaciones, planes, reclamos, reseñas).
const PLACE_ICON = { icon: IoStorefront, color: "text-pulse-500" };

function NotificationRow({ notification, onMarkRead }) {
  const { icon: Icon, color } = ICONS[notification.type] || (isPlaceNotice(notification.type) ? PLACE_ICON : ICONS.comment);

  return (
    <button
      onClick={() => onMarkRead(notification.id)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition ${
        notification.important
          ? "bg-pulse-50 dark:bg-pulse-900/20 border border-pulse-100 dark:border-pulse-800/40"
          : "hover:bg-canvas dark:hover:bg-canvas-dark"
      }`}
    >
      <div className="relative shrink-0">
        <Avatar name={notification.actor} photo={notification.photo} size="w-11 h-11" />
        <span className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-surface dark:bg-surface-dark border border-line dark:border-line-dark flex items-center justify-center ${color}`}>
          <Icon size={13} />
        </span>
      </div>

      <p className="text-sm text-ink dark:text-ink-dark flex-1">
        <span className="font-semibold">{notification.actor}</span> {notification.detail}
      </p>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-xs text-muted">{notification.time}</span>
        {!notification.read && <span className="w-2 h-2 rounded-full bg-pulse-500" aria-label="Sin leer" />}
      </div>
    </button>
  );
}

export default function Notifications() {
  const { notifications, onMarkRead, onMarkAllRead } = useOutletContext();

  const important = notifications.filter((n) => n.important);
  const recent = notifications.filter((n) => !n.important);
  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-ink-dark">Notificaciones</h1>
        {hasUnread && (
          <button
            onClick={onMarkAllRead}
            className="flex items-center gap-1.5 text-xs font-semibold text-pulse-600 dark:text-pulse-300 hover:underline"
          >
            <IoCheckmarkDoneOutline size={15} /> Marcar todas como leídas
          </button>
        )}
      </div>

      {important.length > 0 && (
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark mb-2">
            Importantes
          </h2>
          <div className="bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-[24px] shadow-soft p-2 space-y-1">
            {important.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} onMarkRead={onMarkRead} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark mb-2">
          Actividad reciente
        </h2>
        <div className="bg-surface dark:bg-surface-dark border border-line dark:border-line-dark rounded-[24px] shadow-soft p-2 space-y-1">
          {recent.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} onMarkRead={onMarkRead} />
          ))}
        </div>
      </section>
    </div>
  );
}
