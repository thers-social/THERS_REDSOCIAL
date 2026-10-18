// Perfil extendido LOCAL (localStorage): mood, intereses, canción favorita,
// degradé de portada y acento del avatar. Bio, ubicación y sitio web pasaron
// al servidor (ADR-015-profile-media.md) -- aquí solo se leen para migrar
// lo que la versión anterior dejó guardado en este navegador (ver
// pages/Profile.jsx). Los campos que siguen locales no tienen columnas
// ratificadas (DATABASE_ARCHITECTURE.md §4.B), así que no se inventa
// contrato: viven en el navegador hasta que el equipo los ratifique por ADR.
//
// Nunca se precarga con datos inventados: todo empieza vacío hasta que la
// persona lo completa ella misma.

import { COVERS, DEFAULT_COVER, DEFAULT_ACCENT } from "../data/profileIdentity";

const KEY_PREFIX = "thers_profile_";

export const BIO_MAX = 160;
export const LOCATION_MAX = 60;
export const WEBSITE_MAX = 100;
export const TRACK_MAX = 80;
export const INTEREST_MAX = 24;
export const INTERESTS_MAX_COUNT = 10;

export const EMPTY_PROFILE = {
  bio: "",
  location: "",
  website: "",
  mood: null,
  interests: [],
  favoriteTrack: "",
  cover: DEFAULT_COVER,
  accent: DEFAULT_ACCENT,
};

function storageKey(username) {
  return `${KEY_PREFIX}${username}`;
}

// Tolera perfiles guardados por la versión anterior de la página, que
// almacenaba `banner` como una clase de degradé de Tailwind. Esa clave ya no
// se entiende: se descarta y la portada vuelve al valor por defecto, sin
// tocar el resto de lo que la persona ya había escrito (bio, mood, intereses).
function normalize(raw) {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PROFILE };

  const interests = Array.isArray(raw.interests)
    ? raw.interests.filter((item) => typeof item === "string" && item.trim()).slice(0, INTERESTS_MAX_COUNT)
    : [];

  return {
    bio: typeof raw.bio === "string" ? raw.bio.slice(0, BIO_MAX) : "",
    location: typeof raw.location === "string" ? raw.location.slice(0, LOCATION_MAX) : "",
    website: typeof raw.website === "string" ? raw.website.slice(0, WEBSITE_MAX) : "",
    mood: typeof raw.mood === "string" ? raw.mood : null,
    interests,
    favoriteTrack: typeof raw.favoriteTrack === "string" ? raw.favoriteTrack.slice(0, TRACK_MAX) : "",
    cover: typeof raw.cover === "string" && COVERS[raw.cover] ? raw.cover : DEFAULT_COVER,
    accent: typeof raw.accent === "string" ? raw.accent : DEFAULT_ACCENT,
  };
}

export function loadProfile(username) {
  try {
    return normalize(JSON.parse(localStorage.getItem(storageKey(username))));
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function saveProfile(username, profile) {
  try {
    localStorage.setItem(storageKey(username), JSON.stringify(normalize(profile)));
  } catch {
    // Cuota llena o almacenamiento bloqueado: el perfil sigue en memoria
    // durante la sesión, no se rompe la página.
  }
}

// Al cambiar el username, el perfil extendido se muda con él para no perder
// lo ya escrito (la clave de localStorage incluye el username).
export function moveProfile(fromUsername, toUsername, profile) {
  if (fromUsername === toUsername) {
    saveProfile(toUsername, profile);
    return;
  }
  saveProfile(toUsername, profile);
  try {
    localStorage.removeItem(storageKey(fromUsername));
  } catch {
    // Igual que arriba: no vale la pena romper el guardado por esto.
  }
}

// El campo lo escribe la persona a mano: puede venir sin esquema ("thers.app/x").
// Se asume https para el href, pero se muestra tal cual lo escribió. El servidor devuelve `null`
// cuando no hay sitio web (el perfil público de otra persona lo hace casi siempre).
export function websiteHref(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
