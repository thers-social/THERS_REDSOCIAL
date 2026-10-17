/** Formas de la API de historias (`API_CONTRACT.md` §4.37, ADR-042). */

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
  latest_at: string;
  latest_image_url: string | null;
  is_me: boolean;
};

export type Story = {
  id: string;
  author: StoryAuthor;
  content: string | null;
  image: { url: string; width: number; height: number };
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
