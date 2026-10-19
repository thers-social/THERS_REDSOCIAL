/** Formas de la API de historias (`API_CONTRACT.md` §4.38, ADR-042). */

export type StoryAuthor = {
  id: string;
  username: string;
  name: string;
  avatar_url: string | null;
};

/** Una entrada de la tira (`GET /api/stories`). */
export type StripAuthor = {
  author: StoryAuthor;
  stories_count: number;
  has_unseen: boolean;
  /** Alguna de sus historias vigentes es solo para mejores amigos (`ADR-054`): anillo verde. */
  has_close_friends: boolean;
  latest_at: string;
  latest_image_url: string | null;
  is_me: boolean;
};

/** A quién va dirigida una historia (`ADR-054`). */
export type StoryAudience = "everyone" | "close_friends";

export type Story = {
  id: string;
  author: StoryAuthor;
  content: string | null;
  audience: StoryAudience;
  // `url` es null mientras la moderación (ADR-044) no la aprueba; solo la ve quien la publicó.
  image: { url: string | null; width: number; height: number };
  moderation_status?: "pending" | "held" | "rejected";
  created_at: string;
  expires_at: string;
  seen_by_me?: boolean;
};

export type StoryViewer = {
  id: string;
  username: string;
  name: string;
  avatar_url: string | null;
  viewed_at: string;
};
