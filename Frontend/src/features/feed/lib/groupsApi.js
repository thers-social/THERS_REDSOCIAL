// Chats grupales (ADR-048; contrato en API_CONTRACT.md v0.67). Los mensajes del grupo se leen y se
// mandan con `/groups/<id>/messages` (mismo formato que un mensaje directo, más `group_id` y `sender`).

import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth/context/AuthContext";

function authConfig(extra = {}) {
  return { ...extra, headers: { Authorization: `Bearer ${getStoredToken()}` } };
}

export async function fetchGroups(signal) {
  const { data } = await api.get("/groups", authConfig({ signal }));
  return data.groups;
}

export async function createGroup(name, memberIds) {
  const { data } = await api.post("/groups", { name, member_ids: memberIds }, authConfig());
  return data.group;
}

export async function fetchGroup(groupId, signal) {
  const { data } = await api.get(`/groups/${groupId}`, authConfig({ signal }));
  return data.group;
}

export async function renameGroup(groupId, name) {
  const { data } = await api.patch(`/groups/${groupId}`, { name }, authConfig());
  return data.group;
}

export async function addGroupMembers(groupId, userIds) {
  const { data } = await api.post(`/groups/${groupId}/members`, { user_ids: userIds }, authConfig());
  return data.group;
}

export async function promoteGroupMember(groupId, userId) {
  const { data } = await api.patch(`/groups/${groupId}/members/${userId}`, { role: "admin" }, authConfig());
  return data.group;
}

export async function removeGroupMember(groupId, userId) {
  const { data } = await api.delete(`/groups/${groupId}/members/${userId}`, authConfig());
  return data.group;
}

export async function leaveGroup(groupId) {
  await api.post(`/groups/${groupId}/leave`, null, authConfig());
}
