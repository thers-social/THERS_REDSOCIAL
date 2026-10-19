/**
 * Llamadas HTTP de las historias (`API_CONTRACT.md` §4.38). Una función por petición; el estado
 * vive en las pantallas.
 */

import { request } from '@shared/lib/api';
import { appendMedia } from '@shared/media/mediaForm';

import type { Story, StoryAudience, StoryViewer, StripAuthor } from './types';

export async function fetchStrip(signal?: AbortSignal): Promise<StripAuthor[]> {
  const { authors } = await request<{ authors: StripAuthor[] }>('/stories', {
    authenticated: true,
    signal,
  });
  return authors;
}

/** Lista vacía si la persona no existe, no tiene historias vigentes o no puedes verlas. */
export async function fetchUserStories(userId: string, signal?: AbortSignal): Promise<Story[]> {
  const { stories } = await request<{ stories: Story[] }>(`/users/${userId}/stories`, {
    authenticated: true,
    signal,
  });
  return stories;
}

export async function markViewed(storyId: string): Promise<void> {
  await request(`/stories/${storyId}/view`, { method: 'POST', authenticated: true });
}

export async function fetchViews(
  storyId: string,
  signal?: AbortSignal,
): Promise<{ views_count: number; views: StoryViewer[] }> {
  return request(`/stories/${storyId}/views`, { authenticated: true, signal });
}

export type PickedImage = { uri: string; mimeType?: string | null; fileName?: string | null };

export async function createStory(
  image: PickedImage,
  content: string,
  audience: StoryAudience = 'everyone',
): Promise<Story> {
  const form = new FormData();
  // El `fetch` de Expo SDK 57 no acepta el formato clásico `{uri, name, type}` (la app lo ve como falta
  // de red): el archivo se adjunta como `File`, igual que en las publicaciones (`mediaForm.ts`).
  appendMedia(form, 'image', { uri: image.uri, name: image.fileName || 'historia.jpg' });
  const text = content.trim();
  if (text) form.append('content', text);
  // Solo se envía si no es la de siempre: el servidor trata la ausencia como `everyone`.
  if (audience !== 'everyone') form.append('audience', audience);

  const { story } = await request<{ story: Story }>('/stories', {
    method: 'POST',
    authenticated: true,
    form,
    timeoutMs: 60_000,
  });
  return story;
}

export async function deleteStory(storyId: string): Promise<void> {
  await request(`/stories/${storyId}`, { method: 'DELETE', authenticated: true });
}
