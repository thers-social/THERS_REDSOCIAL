// Tabla única de SEO por ruta (ADR-033-seo-foundation.md).
//
// Módulo PURO (sin JSX, sin alias `@`, sin `window`): lo importan tanto el
// runtime (`RouteSeo.jsx`) como el plugin de build (`vite-seo-files.js`, que
// corre en Node). Así `robots.txt`, `sitemap.xml` y las etiquetas del navegador
// salen de la misma fuente y no pueden contradecirse.
//
// Criterio: **noindex por defecto**. Una ruta solo se indexa si está aquí con
// `index: true`, y solo debe estarlo si tiene contenido propio. Las páginas que
// todavía dicen "estamos construyendo esta sección" se quedan fuera: Google
// las trataría como contenido delgado (thin content) y le restarían confianza
// al sitio. Cuando una página tenga contenido real, se agrega aquí.

import { HELP_ARTICLES } from "../../features/help/data/articles.js";
import { HELP_CATEGORIES } from "../../features/help/data/categories.js";

export const SITE_NAME = "THERS";

const DEFAULT_DESCRIPTION = "THERS es una red social para conectar con tu gente, compartir y descubrir.";

// Rutas estáticas indexables. `path` exacto.
const STATIC_ROUTES = [
  {
    path: "/",
    title: "THERS — Conecta, comparte y descubre",
    description: DEFAULT_DESCRIPTION,
  },
  {
    path: "/information",
    title: "Qué es THERS",
    description: "Conoce THERS: una red social pensada para conectar con tu gente.",
  },
  {
    path: "/child-safety",
    title: "Estándares de Seguridad Infantil de THERS Social Network",
    description:
      "Tolerancia cero frente a la explotación y el abuso sexual infantil: qué está prohibido, cómo reportar y cómo contactarnos.",
  },
  {
    path: "/eliminar-cuenta",
    title: "Eliminar tu cuenta de THERS",
    description: "Cómo pedir la eliminación de tu cuenta de THERS y de tus datos, sin tener la app instalada.",
  },
  {
    path: "/help",
    title: "Centro de Ayuda",
    description: "Guías para usar THERS: cuenta, seguridad, privacidad y más.",
  },
];

// Artículos listos para leer. Los `in-progress` describen funciones que aún no
// existen del todo: no se indexan ni entran al sitemap.
export function getIndexableArticles() {
  return HELP_ARTICLES.filter((article) => article.status === "available");
}

function articleRoutes() {
  return getIndexableArticles().map((article) => ({
    path: `/help/article/${article.slug}`,
    title: article.title,
    description: article.description,
    lastmod: article.updatedAt,
  }));
}

function categoryRoutes() {
  return HELP_CATEGORIES.map((category) => ({
    path: `/help/category/${category.id}`,
    title: category.title,
    description: category.description,
  }));
}

/** Todas las rutas indexables, en el orden en que se listan en el sitemap. */
export function getIndexableRoutes() {
  return [...STATIC_ROUTES, ...categoryRoutes(), ...articleRoutes()];
}

/** Quita barra final (salvo la raíz) para que `/help/` y `/help` sean una sola URL. */
export function normalizePath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * SEO de una ruta. Siempre devuelve algo: lo que no está en la tabla es
 * `index: false`. Las rutas privadas (la app) y las páginas en construcción
 * caen aquí.
 */
export function getSeoForPath(pathname) {
  const path = normalizePath(pathname);
  const match = getIndexableRoutes().find((route) => route.path === path);
  if (match) {
    return { title: match.title, description: match.description, index: true, path };
  }
  return { title: SITE_NAME, description: DEFAULT_DESCRIPTION, index: false, path };
}

/** URL absoluta canónica, o `null` si no se configuró el dominio. */
export function buildCanonicalUrl(siteUrl, path) {
  const base = (siteUrl || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return path === "/" ? `${base}/` : `${base}${path}`;
}

// Datos estructurados de la home (schema.org). Solo se generan con dominio
// público conocido: un JSON-LD con URLs inventadas es peor que ninguno.
// No se declara `SearchAction` porque no existe una búsqueda pública indexable,
// ni `logo`/`sameAs` hasta que haya asset de marca y perfiles oficiales.
export function buildJsonLd(siteUrl) {
  if (!siteUrl) return null;
  const url = buildCanonicalUrl(siteUrl, "/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${url}#organization`, name: SITE_NAME, url },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: SITE_NAME,
        url,
        inLanguage: "es",
        description: DEFAULT_DESCRIPTION,
        publisher: { "@id": `${url}#organization` },
      },
    ],
  };
}
