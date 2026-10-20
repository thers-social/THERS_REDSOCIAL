import type { SharedPlace } from '@features/places/types';
import type { PublicImage } from '@shared/media/ImageGridView';
import type { PublicVideo } from '@shared/media/VideoPlayerView';

/**
 * Tipos del contrato de publicaciones y comentarios.
 *
 * Fuente única: `docs/architecture/API_CONTRACT.md` §4.3 (publicaciones), §4.4
 * (me gusta), §4.5 (comentarios), §4.6 (seguidos). Se verificaron además contra
 * los presentadores reales del backend (`post_presenter.py`,
 * `comment_presenter.py`). Una publicación puede llevar hasta 10 fotos (`ADR-039`) o un video corto
 * (`ADR-046`), nunca las dos cosas.
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
  /** Fotos adjuntas; `[]` si no tiene (`ADR-039`). */
  images?: PublicImage[];
  /** Video corto; `null` si no tiene (`ADR-046`). */
  video?: PublicVideo | null;
  /** Lo declara quien publica (ADR-030): se muestra oculto a las demás personas. */
  is_sensitive: boolean;
  /** A quién va dirigida (`ADR-054`): `close_friends` = solo la lista de mejores amigos de quien publica. */
  audience?: 'everyone' | 'close_friends';
  created_at: string;
  mentions: Mention[];
  edited: boolean;
  likes_count: number;
  liked_by_me: boolean;
  /** La guardó quien pregunta (`ADR-047`). Privado: nunca cuántas personas la guardaron. */
  saved_by_me?: boolean;
  comments_count: number;
  /** Lugar asociado (ADR-040 fase 4d); `null` o ausente si la publicación no lleva uno. */
  place?: SharedPlace | null;
};

/**
 * Tarjeta de una publicación compartida por mensaje (`ADR-047`). La calcula el servidor para quien mira:
 * `available: false` si esa persona ya no puede verla; una sensible llega sin texto ni miniatura.
 */
export type SharedPost =
  | { id: string; available: false }
  | {
      id: string;
      available: true;
      author: { id: string; name: string; username: string; avatar_url: string | null };
      is_sensitive: boolean;
      excerpt: string | null;
      thumbnail_url: string | null;
      has_video: boolean;
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
