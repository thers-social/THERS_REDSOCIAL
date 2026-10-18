/**
 * Explorar (`ADR-050`): `GET /api/explore`. Fotos y videos populares de personas que no sigues, en
 * páginas (`offset`). El servidor ya aplica cuentas privadas, bloqueos y filtros.
 */

import { request } from '@shared/lib/api';
import type { Post } from '@features/posts/types';

export type ExploreKind = 'all' | 'images' | 'videos';

export async function fetchExplore(
  kind: ExploreKind,
  offset: number,
  signal?: AbortSignal,
): Promise<{ posts: Post[]; has_more: boolean }> {
  return request<{ posts: Post[]; has_more: boolean }>(`/explore?kind=${kind}&offset=${offset}`, {
    authenticated: true,
    signal,
  });
}
