/**
 * Chats grupales (`ADR-048`; contrato en `API_CONTRACT.md` v0.67). Los mensajes de un grupo se leen y se
 * mandan con `GET/POST /groups/<id>/messages` (ver `ChatTarget` en `api.ts`); aquí está lo propio del grupo:
 * crearlo, ver y gestionar sus miembros y salir.
 */

import { request } from '@shared/lib/api';

export type GroupMember = {
  id: string;
  username: string;
  name: string;
  avatar_url: string | null;
  role: 'admin' | 'member';
};

export type GroupDetail = {
  id: string;
  name: string;
  created_at: string;
  my_role: 'admin' | 'member';
  members: GroupMember[];
};

export type GroupSummary = {
  id: string;
  name: string;
  member_count: number;
  unread_count: number;
  created_at: string;
  last_message: {
    content: string;
    has_image?: boolean;
    has_audio?: boolean;
    has_video?: boolean;
    has_place?: boolean;
    has_post?: boolean;
    sender_id: string;
    sender_name: string;
    created_at: string;
  } | null;
};

export const MAX_GROUP_NAME = 60;
export const MAX_GROUP_MEMBERS = 50;

export async function fetchGroups(signal?: AbortSignal): Promise<GroupSummary[]> {
  const { groups } = await request<{ groups: GroupSummary[] }>('/groups', { authenticated: true, signal });
  return groups;
}

export async function fetchGroup(groupId: string, signal?: AbortSignal): Promise<GroupDetail> {
  const { group } = await request<{ group: GroupDetail }>(`/groups/${groupId}`, {
    authenticated: true,
    signal,
  });
  return group;
}

export async function createGroup(name: string, memberIds: string[]): Promise<GroupDetail> {
  const { group } = await request<{ group: GroupDetail }>('/groups', {
    method: 'POST',
    authenticated: true,
    body: { name, member_ids: memberIds },
  });
  return group;
}

export async function renameGroup(groupId: string, name: string): Promise<GroupDetail> {
  const { group } = await request<{ group: GroupDetail }>(`/groups/${groupId}`, {
    method: 'PATCH',
    authenticated: true,
    body: { name },
  });
  return group;
}

export async function addGroupMembers(groupId: string, userIds: string[]): Promise<GroupDetail> {
  const { group } = await request<{ group: GroupDetail }>(`/groups/${groupId}/members`, {
    method: 'POST',
    authenticated: true,
    body: { user_ids: userIds },
  });
  return group;
}

export async function promoteGroupMember(groupId: string, userId: string): Promise<GroupDetail> {
  const { group } = await request<{ group: GroupDetail }>(`/groups/${groupId}/members/${userId}`, {
    method: 'PATCH',
    authenticated: true,
    body: { role: 'admin' },
  });
  return group;
}

export async function removeGroupMember(groupId: string, userId: string): Promise<GroupDetail> {
  const { group } = await request<{ group: GroupDetail }>(`/groups/${groupId}/members/${userId}`, {
    method: 'DELETE',
    authenticated: true,
  });
  return group;
}

export function leaveGroup(groupId: string): Promise<unknown> {
  return request(`/groups/${groupId}/leave`, { method: 'POST', authenticated: true });
}
