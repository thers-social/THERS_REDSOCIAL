import type { SharedPlace } from '@features/places/types';

/**
 * Tipos del contrato de publicaciones y comentarios.
 *
 * Fuente única: `docs/architecture/API_CONTRACT.md` §4.3 (publicaciones), §4.4
 * (me gusta), §4.5 (comentarios), §4.6 (seguidos). Se verificaron además contra
 * los presentadores reales del backend (`post_presenter.py`,
 * `comment_presenter.py`). Las publicaciones son **solo texto**: el backend no
 * tiene imágenes ni vídeo en publicaciones, así que aquí tampoco se tipan.
 */

export type FollowStatus = 'accepted' | 'pending' | null;

/** Autor reducido: nunca trae correo ni teléfono. */
export type PostAuthor = {
  id: string;
  username: string;
  name: string;
  avatar_url: string | null;
  is_followed_by_me: boolean;
  follow_status: FollowStatus;
  is_private: boolean;
};

export type Mention = { id: string; username: string; name: string };

export type Post = {
  id: string;
  author: PostAuthor;
  content: string;
  /** Lo declara quien publica (ADR-030): se muestra oculto a las demás personas. */
  is_sensitive: boolean;
  created_at: string;
  mentions: Mention[];
  edited: boolean;
  likes_count: number;
  liked_by_me: boolean;
  comments_count: number;
  /** Lugar asociado (ADR-040 fase 4d); `null` o ausente si la publicación no lleva uno. */
  place?: SharedPlace | null;
};

export type CommentAuthor = {
  id: string;
  username: string;
  name: string;
  avatar_url: string | null;
};

export type PostComment = {
  id: string;
  post_id: string;
  author: CommentAuthor;
  content: string;
  created_at: string;
  mentions: Mention[];
  edited: boolean;
};

/** Longitud máxima de una publicación o comentario (`MAX_CONTENT_LENGTH` del backend). */
export const MAX_POST_LENGTH = 2000;
