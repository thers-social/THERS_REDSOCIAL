/** Seguidores y seguidos de una persona (`ADR-050`): `GET /api/users/<id>/followers|following`. */

import { request } from '@shared/lib/api';
import type { FollowStatus } from '@features/posts/types';

export type ConnectionKind = 'followers' | 'following';

export type Connection = {
  id: string;
  username: string;
  name: string;
  avatar_url: string | null;
  is_private: boolean;
  is_me: boolean;
  /** Relación de quien mira con esta persona. */
  follow_status: FollowStatus;
};

export async function fetchConnections(
  userId: string,
  kind: ConnectionKind,
  offset: number,
  signal?: AbortSignal,
): Promise<{ users: Connection[]; has_more: boolean }> {
  return request<{ users: Connection[]; has_more: boolean }>(
    `/users/${userId}/${kind}?offset=${offset}`,
    { authenticated: true, signal },
  );
}
