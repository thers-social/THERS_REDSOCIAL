/**
 * Perfil de OTRA persona (`ADR-049`): `GET /api/users/<id>` y sus publicaciones
 * (`GET /api/posts?author_id=`). Una cuenta bloqueada en cualquier sentido responde 404.
 */

import { request } from '@shared/lib/api';
import type { FollowStatus, Post } from '@features/posts/types';

export type PublicProfile = {
  id: string;
  username: string;
  name: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  is_private: boolean;
  followers_count: number;
  following_count: number;
  follow_status: FollowStatus;
  /** `false` en una cuenta privada que no sigues: no se piden sus publicaciones. */
  can_view_posts: boolean;
};

export async function fetchPublicProfile(userId: string, signal?: AbortSignal): Promise<PublicProfile> {
  const { user } = await request<{ user: PublicProfile }>(`/users/${userId}`, {
    authenticated: true,
    signal,
  });
  return user;
}

export async function fetchPostsByAuthor(userId: string, signal?: AbortSignal): Promise<Post[]> {
  const { posts } = await request<{ posts: Post[] }>(`/posts?author_id=${encodeURIComponent(userId)}`, {
    authenticated: true,
    signal,
  });
  return posts;
}
