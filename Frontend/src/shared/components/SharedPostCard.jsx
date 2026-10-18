import Icon from "@shared/components/Icon";
import Avatar from "@shared/components/Avatar";
import { useLanguage } from "@shared/i18n";

/**
 * Tarjeta de una publicación compartida en el chat (ADR-047). `post` es el objeto `message.post`
 * del contrato: lo calcula el servidor PARA QUIEN MIRA, así que si esa persona no puede ver la
 * publicación llega `available: false` y no hay nada más que enseñar. Una publicación sensible
 * llega sin texto ni miniatura. Todo se pinta como texto de React, nunca como HTML. `mine` solo
 * cambia los colores para la burbuja propia.
 */
export default function SharedPostCard({ post, mine = false }) {
  const { t } = useLanguage();
  const tone = mine ? "border-white/30 bg-white/10 text-white" : "border-line bg-surface text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark";

  if (!post.available) {
    return (
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}>
        <Icon name="visibility_off" size={18} />
        {t("postActions.card.unavailable")}
      </div>
    );
  }

  return (
    <div className={`flex w-64 max-w-full flex-col gap-2 rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center gap-2">
        <Avatar name={post.author.name} photo={post.author.avatar_url} size="w-7 h-7" />
        <span className="min-w-0 truncate text-xs font-semibold">{post.author.name}</span>
      </div>
      {post.is_sensitive && post.excerpt === null ? (
        <p className="flex items-center gap-1 text-xs opacity-80">
          <Icon name="warning" size={16} />
          {t("postActions.card.sensitive")}
        </p>
      ) : (
        <>
          {post.excerpt && <p className="line-clamp-4 break-words text-sm">{post.excerpt}</p>}
          {post.thumbnail_url && (
            <div className="relative overflow-hidden rounded-lg">
              <img src={post.thumbnail_url} alt="" loading="lazy" className="max-h-40 w-full object-cover" />
              {post.has_video && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
                  <Icon name="play_arrow" size={32} />
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
