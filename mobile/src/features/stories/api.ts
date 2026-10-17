/**
 * Llamadas HTTP de las historias (`API_CONTRACT.md` §4.37). Una función por petición; el estado
 * vive en las pantallas.
 */

import { request } from '@shared/lib/api';

import type { Story, StoryViewer, StripAuthor } from './types';

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

export async function createStory(image: PickedImage, content: string): Promise<Story> {
  const form = new FormData();
  // En React Native un archivo se adjunta con {uri, name, type}; el tipo de TS de `FormData` no
  // lo conoce, por eso el cast.
  form.append('image', {
    uri: image.uri,
    name: image.fileName || 'historia.jpg',
    type: image.mimeType || 'image/jpeg',
  } as unknown as Blob);
  const text = content.trim();
  if (text) form.append('content', text);

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
