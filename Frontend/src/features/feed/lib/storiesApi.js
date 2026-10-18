// Cliente HTTP de las historias de 24 horas (contrato: API_CONTRACT.md §4.38, ADR-042).

import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth";

function authConfig(extra = {}) {
  return { ...extra, headers: { Authorization: `Bearer ${getStoredToken()}` } };
}

/** La tira: `[{author, stories_count, has_unseen, latest_at, latest_image_url, is_me}]`. */
export async function fetchStrip(signal) {
  const { data } = await api.get("/stories", authConfig({ signal }));
  return data.authors;
}

/** Historias vigentes de una persona (lista vacía si no existen o no se pueden ver). */
export async function fetchUserStories(userId, signal) {
  const { data } = await api.get(`/users/${userId}/stories`, authConfig({ signal }));
  return data.stories;
}

export async function markViewed(storyId) {
  await api.post(`/stories/${storyId}/view`, null, authConfig());
}

export async function fetchViews(storyId, signal) {
  const { data } = await api.get(`/stories/${storyId}/views`, authConfig({ signal }));
  return data;
}

export async function createStory({ image, content }) {
  const form = new FormData();
  form.append("image", image);
  if (content && content.trim()) form.append("content", content.trim());
  const { data } = await api.post("/stories", form, authConfig());
  return data.story;
}

export async function deleteStory(storyId) {
  await api.delete(`/stories/${storyId}`, authConfig());
}
