// Cliente HTTP de THERS Places (contrato: API_CONTRACT.md §4.23 y §4.24).
//
// El catálogo es público: si hay sesión se envía el token (el backend marca `is_saved`);
// si no, se llama igual. Un token vencido NO rompe el catálogo (el backend lo trata como
// anónimo). Guardar y reportar sí exigen sesión.
//
// Las coordenadas se redondean a 3 decimales aquí, antes de salir (ADR-040 §4.4).

import { api } from "@shared/lib/api";
import { getStoredToken } from "@features/auth/context/AuthContext";
import { roundPoint } from "./coordinates";

function authConfig(extra = {}) {
  const token = getStoredToken();
  return {
    ...extra,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

export async function fetchCategories(signal) {
  const { data } = await api.get("/places/categories", { signal });
  return data.categories;
}

export async function fetchNearby({ lat, lng, radius, category, limit }, signal) {
  const point = roundPoint({ lat, lng });
  const { data } = await api.get(
    "/places/nearby",
    authConfig({ signal, params: { ...point, radius, category, limit } })
  );
  return data.places;
}

export async function searchPlaces({ q, lat, lng, category, limit }, signal) {
  const params = { q, category, limit };
  if (Number.isFinite(lat) && Number.isFinite(lng)) Object.assign(params, roundPoint({ lat, lng }));
  const { data } = await api.get("/places/search", authConfig({ signal, params }));
  return data.places;
}

export async function fetchPlace(id, signal) {
  const { data } = await api.get(`/places/${id}`, authConfig({ signal }));
  return data.place;
}

export async function fetchSavedPlaces(signal) {
  const { data } = await api.get("/places/saved", authConfig({ signal }));
  return data.places;
}

export async function savePlace(id) {
  const { data } = await api.post(`/places/${id}/save`, null, authConfig());
  return data.saved;
}

export async function unsavePlace(id) {
  const { data } = await api.delete(`/places/${id}/save`, authConfig());
  return data.saved;
}

export async function reportPlace(id, { reason, details }) {
  const { data } = await api.post(`/places/${id}/report`, { reason, details }, authConfig());
  return data.report;
}
