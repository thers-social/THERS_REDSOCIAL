# FRONTEND_ARCHITECTURE

| Campo | Valor |
|---|---|
| Documento | `docs/architecture/FRONTEND_ARCHITECTURE.md` |
| Versión | 0.5 (Propuesta) |
| Estado | **Pendiente de ratificación formal del equipo** (proceso de decisiones de alto impacto, `HB-001` §11–12) |
| Depende de | `HB-001` (Manual de Organización), `REPOSITORY_STRUCTURE.md` §3/§5, `BACKEND_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md`, `API_CONTRACT.md`, `CLAUDE.md`, código real de `Frontend/` |
| Autoridad sobre este documento | `/docs` oficial > estructura real observada en el código > este documento (mismo orden que `CLAUDE.md` §3) |

>  **Nota de estado.** `docs/architecture/Frontend/FAS-001-Frontend-Architecture-Specification.md` existe con un nombre similar y en una ruta que podría confundirse con esta, pero su propio contenido (§1, §3, §17) lo declara exclusivo del **THERS Engineering Handbook**, no del producto — ver §2. Este documento sigue el mismo método que `BACKEND_ARCHITECTURE.md`: separa explícitamente **lo implementado**, **lo objetivo/propuesto** y **lo pendiente de aprobación**, y no se autoproclama cerrado.
>
> **v0.2 — introducción de `VITE_API_URL`:** se resolvió la Open Architectural Decision #3 (§24) — `shared/lib/api.js` dejó de tener la URL de la API hardcodeada en un único valor.
>
> **v0.3 — reescritura integral (auditoría documental de THERS).** Esta versión reemplaza casi por completo la anterior, que describía una app de **2 features y 6 rutas, sin sesión real, sin i18n, sin manejo de errores más allá de `alert()`**. El código real, verificado archivo por archivo en esta auditoría, tiene hoy **5 features y 28 rutas**, sesión real contra los 4 endpoints del backend (`register`/`login`/`GET`/`PATCH /users/me`), rutas protegidas, un sistema de i18n completo (ES/EN), notificaciones `Toast`, dark mode, y lint ya cableado. Nada de esto estaba reflejado en `/docs` — es la misma clase de desincronización que ya se corrigió del lado del backend (`BACKEND_ARCHITECTURE.md`), aplicada aquí por primera vez al Frontend. Reflejado en prácticamente todas las secciones; el detalle de qué cambió respecto a v0.2 vive en cada sección, no se repite aquí.
>
> **v0.4 — segundo sistema de tokens (§13).** Registra `Frontend/src/shared/design/tokens.css` + `docs/THERS_DESIGN_SYSTEM.md`, el set de tokens `th-*` que el shell rediseñado (`app/layout/thers/`, `features/feed/`) usa en paralelo a los tokens de v0.3 — autorizado por el propietario del proyecto vía `THERS_IMPLEMENTACION_MAESTRA_CLAUDE.md`, todavía sin ratificación del equipo. No se toca ninguna otra sección.
>
> Este documento no implementa, refactoriza ni modifica código de `Frontend/` por iniciativa propia. Documenta lo que existe y señala, donde falta una decisión, el hueco explícito — nunca una arquitectura inventada.

---

## 1. Propósito y alcance

**Propósito.** Establecer el contrato técnico propuesto de la arquitectura Frontend del producto THERS (la red social): su stack, estructura, frontera con el backend, y las decisiones que el código ya asume implícitamente — de modo que la implementación futura siga la documentación y no al revés (mismo principio que `BACKEND_ARCHITECTURE.md` §1 y `FAS-001` §1 declaran para sus respectivas áreas).

**Alcance.** Cubre exclusivamente `Frontend/`: su estructura interna, el código React/Vite ya implementado, sus dependencias, y las decisiones de arquitectura que ese código ya asume implícitamente.

**Fuera de alcance de este documento:**
- El THERS Engineering Handbook (`handbook/`) — arquitectura propia, ya cubierta por `ARC-001`/`DS-001`/`WF-001`/`PV-001`/`FAS-001`.
- Backend (`backend/`) y Base de Datos — arquitecturas propias, cubiertas por `BACKEND_ARCHITECTURE.md` y `DATABASE_ARCHITECTURE.md`; este documento las referencia solo en la frontera de integración (§6).
- Un Design System propio del producto — no existe y no se inventa aquí (§13).
- DevOps, Docker, CI/CD, despliegue — fuera del alcance declarado de `HB-001` §0; este documento solo señala qué información necesitará DevOps (§25).

---

## 2. Relación con FAS-001

`FAS-001` vive en `docs/architecture/Frontend/`, la misma carpeta padre de este documento, y comparte parte del nombre ("Frontend Architecture"). Se deja constancia explícita de que **no son el mismo documento ni compiten entre sí**:

| | `FAS-001` | `FRONTEND_ARCHITECTURE.md` (este documento) |
|---|---|---|
| Aplica a | THERS Engineering Handbook (`handbook/`) | Producto — la red social (`Frontend/`) |
| Fuente que lo confirma | `FAS-001` §1, §3, §17 (texto literal) | `DS-001` §1.2 (confirma que el Handbook y el producto son sistemas separados) |
| Contenido | Capas conceptuales de un sitio documental estático (Markdown como dato) | Stack, estructura y frontera de una SPA con autenticación, estado e integración real con el backend |
| Depende de | `HB-001`, `ARC-001`, `DS-001`, `WF-001`, `PV-001` | `HB-001`, `REPOSITORY_STRUCTURE.md`, `BACKEND_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md`, `API_CONTRACT.md` |

Ambos documentos pueden evolucionar de forma independiente. Si en el futuro el equipo decide unificar principios entre ambos Frontends, es una decisión de gobernanza (`HB-001` §11–12), no una consecuencia automática de ninguno de los dos documentos.

---

## 3. Stack Frontend

| Tecnología | Estado en `/docs` | Estado en el código | Observación |
|---|---|---|---|
| React | Confirmado (`HB-001` portada, §2 rol Tech Lead Frontend) | 19.2.4 (`Frontend/package.json`) | Implementado — toda la app |
| Vite | Confirmado (`HB-001` portada) | 8.0.1, con `@vitejs/plugin-react` 6.0.1 | Implementado |
| Tailwind CSS | Confirmado (`HB-001` portada) | 3.4.4 (v3, no v4 — distinto del handbook) | Implementado con tokens propios ya centralizados en `tailwind.config.js` — ver §13 |
| react-router-dom | No mencionado por nombre en `/docs` | 7.14.1 | Implementado — `BrowserRouter`, rutas anidadas, layouts compartidos, rutas protegidas (§7) |
| axios | No mencionado por nombre en `/docs` | 1.18.1 | Implementado — un único wrapper (`src/shared/lib/api.js`), `baseURL` configurable vía `VITE_API_URL` (§9, §17) |
| react-icons | No mencionado por nombre en `/docs` | 5.6.0 | Implementado en toda la app (`react-icons/io5`, `react-icons/fc`, `react-icons/fa`) |
| Estado global | No documentado | **Implementado — v0.3.** Context API: `AuthContext` (sesión), `LanguageContext` (i18n), `ToastContext` (notificaciones) — sin Redux/Zustand/Jotai. Ver §8 | |
| Formularios / validación | No documentado | `useState` manual por componente, con funciones de validación propias (`features/auth/lib/validators.js`) — sin librería (React Hook Form, Formik, Zod, Yup) | Ver §11 |
| HTTP client alternativo (fetch nativo) | — | No usado — todo pasa por axios | — |
| Testing (Vitest/Jest/Playwright/Cypress) | No documentado | **No instalado** — sin `vitest.config.*`/`jest.config.*`, sin carpeta `__tests__/` ni archivos `*.test.jsx` | Ver §18 |
| ESLint | No documentado | **v0.3 — instalado y cableado.** `eslint.config.js` (flat config, `eslint` 9.39.5 + `eslint-plugin-react` + `@eslint/js`), script `lint` en `package.json` (`eslint .`) | Antes de v0.3 estaba instalado sin cablear — ya no |
| Prettier | No documentado | No instalado en `Frontend/` (sí existe en `handbook/`, aplicación independiente) | Sin cambios |
| TypeScript | No documentado | `@types/react`/`@types/react-dom` instalados como devDependency, **sin `tsconfig.json`** | Tipos huérfanos — todo el código sigue siendo `.jsx` puro |

**Distinción `instalado` vs. `realmente utilizado`:** todo lo listado arriba salvo Prettier (no instalado) y TypeScript (tipos huérfanos, sin `tsconfig.json`) está instalado **y** en uso real — a diferencia de v0.2, donde ESLint estaba instalado sin cablear.

---

## 4. Arquitectura actual

**Patrón observado:** feature-based, coherente con `REPOSITORY_STRUCTURE.md` §2 ("Modularidad por dominio"). No es atomic design, no es layered estricto, no es domain-driven en sentido formal.

- **5 features** en `src/features/<dominio>/`, cada una con `index.js` como barrel/punto de entrada único: `auth`, `legal`, `public`, `feed`, **`help`** (Centro de Ayuda — nueva desde v0.2, no documentada hasta ahora; ~20 componentes, datos de artículos/FAQ propios en `data/`, hooks de búsqueda propios).
- `auth` es la feature más profunda: `components/` (8), `context/` (`AuthContext.jsx`), `hooks/` (2), `lib/` (`dateUtils.js`, `validators.js`), `pages/` (5). Las demás features siguen un subconjunto de esa misma forma (`components/`, `data/`, `pages/`) según lo que necesitan — no hay una estructura interna obligatoria idéntica entre todas.
- `shared/` aloja lo transversal: `components/` (`Avatar`, `Logo`, `BrandMark`, `Spinner`, `AmbientGlow`, `LanguageSwitcher`, `Footer/`, `Toast/`), `hooks/` (`useTheme`), `i18n/` (sistema de traducción completo), `lib/` (`api.js`).
- `app/` aloja el arranque de la aplicación: `router/` (`router.jsx`, `ProtectedRoute.jsx`) y **`layout/`** (`AppShell.jsx`, `NavRail.jsx`, `MobileNav.jsx`, `PublicLayout.jsx`) — `layout/` no existía en v0.2.

**`app/providers/` y `app/store/` — actualización v0.3:** seguían documentados en v0.2 como "`[PROPUESTO]`, no `[EXISTENTE]`" en espera de una decisión de estado global. Esa decisión ya se tomó de facto: Context API, sin necesidad de una carpeta `providers/` separada — los tres providers (`AuthProvider`, `LanguageProvider`, `ToastProvider`) viven junto a lo que proveen (`features/auth/context/`, `shared/i18n/`, `shared/components/Toast/`) y se componen directamente en `App.jsx` (§8). `app/store/` sigue sin existir y ya no se anticipa — no hay ningún indicio de que se vaya a necesitar más allá de Context API al ritmo de crecimiento actual.

---

## 5. Estructura del proyecto

Estructura real verificada (árbol completo de `src/`, agosto 2026):

```
Frontend/
├── public/
├── src/
│   ├── app/
│   │   ├── layout/
│   │   │   ├── AppShell.jsx        # shell autenticado: header, NavRail, MobileNav, Outlet con contexto
│   │   │   ├── NavRail.jsx         # navegación lateral (desktop)
│   │   │   ├── MobileNav.jsx       # navegación inferior (mobile)
│   │   │   └── PublicLayout.jsx    # header simple + Footer, para páginas públicas/legales
│   │   └── router/
│   │       ├── router.jsx          # 28 rutas — ver §7
│   │       └── ProtectedRoute.jsx  # única fuente de verdad de "requiere sesión"
│   ├── assets/
│   ├── features/
│   │   ├── auth/
│   │   │   ├── components/         # AuthCard, TextField, PasswordField, PasswordStrength,
│   │   │   │                       # PhoneField, BirthDateField, InfoTooltip, TrustNote
│   │   │   ├── context/
│   │   │   │   └── AuthContext.jsx # login/register/logout/loadCurrentUser/updateProfile — ver §8, §10
│   │   │   ├── hooks/              # useOAuthNotice, usePasswordStrength
│   │   │   ├── lib/                # dateUtils.js, validators.js
│   │   │   ├── pages/              # AuthPage, Login, Register, ForgotPassword, ResetPassword
│   │   │   └── index.js
│   │   ├── legal/
│   │   │   ├── pages/               # Terms, Privacy, Cookies
│   │   │   └── index.js
│   │   ├── public/
│   │   │   ├── components/          # ComingSoon, EditorialCard, InformationHero/Cta, PhoneMockup, ...
│   │   │   ├── data/                 # informationContent.js
│   │   │   ├── pages/                # Information, HowItWorks, Community, Security, Faq, Blog,
│   │   │   │                         # Locations, Popular, ImportContacts
│   │   │   └── index.js
│   │   ├── feed/
│   │   │   ├── components/          # CapsuleCard, CreateCapsuleFlow, MomentsRow, MomentViewer,
│   │   │   │                        # MoodBadge, PulseBar
│   │   │   ├── data/                 # mockData.js — ver §6, sigue 100% mock
│   │   │   ├── pages/                 # Home, Discover, Messages, Notifications, Profile, Settings
│   │   │   └── index.js
│   │   └── help/
│   │       ├── components/           # ~15 componentes (HelpLayout, HelpSearchBar, HelpFAQ, ...)
│   │       ├── data/                  # articles.js, categories.js, faqs.js, featuredTopics.js
│   │       ├── hooks/                  # useHelpSearch, useDebouncedValue, useArticleFeedback
│   │       ├── lib/                     # formatDate.js, searchHelp.js
│   │       ├── pages/                    # HelpCenter, HelpCategoryPage, HelpArticlePage, HelpSearchPage
│   │       └── index.js
│   ├── shared/
│   │   ├── components/
│   │   │   ├── Avatar.jsx, BrandMark.jsx, Logo.jsx, Spinner.jsx, AmbientGlow.jsx, LanguageSwitcher.jsx
│   │   │   ├── Footer/               # Footer, FooterSection, FooterExpandableItem, FooterLink, ...
│   │   │   └── Toast/                # Toast.jsx, ToastContext.jsx, index.js
│   │   ├── hooks/
│   │   │   └── useTheme.js           # dark mode, oscuro por defecto
│   │   ├── i18n/
│   │   │   ├── LanguageContext.jsx, translate.js, languages.js, index.js
│   │   │   └── locales/{es,en}.json
│   │   └── lib/
│   │       └── api.js                 # cliente axios + getErrorMessage()
│   ├── App.jsx, App.css               # splash screen + composición de providers
│   ├── index.css
│   └── main.jsx
├── index.html
├── eslint.config.js                    # nuevo desde v0.3 — ver §19
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

**Regla de crecimiento (heredada de `REPOSITORY_STRUCTURE.md` §2):** una feature nueva es una carpeta adicional dentro de `features/`, no una reorganización de las existentes — `help` (v0.3) es el ejemplo más reciente de esa regla aplicada. No se fija aquí una estructura interna obligatoria idéntica por feature (§24, ítem 7 sigue abierto).

---

## 6. Frontera Frontend ↔ Backend ↔ Database

Regla heredada, respetada de facto por el código actual:

```
Frontend (Frontend/)
   ↓  HTTP/JSON, vía shared/lib/api.js
Backend API (backend/app/interfaces/routes/)
   ↓
Application / Domain (backend/app/application, domain)
   ↓
PostgreSQL (real, ver BACKEND_ARCHITECTURE.md §8)
```

- El Frontend **nunca** accede a PostgreSQL directamente ni conoce detalles de persistencia — el único acceso a datos es vía `axios` contra `VITE_API_URL` (§9, §17).
- **Estado real de la integración — v0.3, honesto, no aspiracional:**
  - **Auth y perfil: real de punta a punta.** `Register`/`Login` llaman a `POST /api/register`/`POST /api/login`; `AuthContext.loadCurrentUser()` llama a `GET /api/users/me` al montar la app y tras cada login; `Profile.jsx` llama a `PATCH /api/users/me` vía `AuthContext.updateProfile()` para `name`/`username` (ADR-003) — reemplaza la edición local-only que existía antes y que se perdía al refrescar.
  - **Feed: sigue 100% mock.** `capsules`, `notifications`, `followingIds` son estado local en `AppShell.jsx` (`useState(mockCapsules)`, `useState(mockNotifications)`) — no hay ningún endpoint de backend para posts/comentarios/likes/follows/mensajes/notificaciones (`DATABASE_ARCHITECTURE.md` §4.B: todo candidato objetivo, sin ratificar). `Discover`, `Messages`, `Notifications`, `Settings` heredan el mismo estado mock vía el contexto de `Outlet` que expone `AppShell`.
  - **Recuperación de contraseña: solo UI.** `ForgotPassword.jsx`/`ResetPassword.jsx` existen y navegan entre sí, pero no hay ningún endpoint de backend detrás — `DATABASE_ARCHITECTURE.md` §4.B lo marca "PENDIENTE DE DECISIÓN" (depende de cómo se envíen los correos).
- **Formato de error del backend:** `{"msg": "..."}`, ya **estandarizado y aplicado de forma uniforme** desde `API_CONTRACT.md` v0.6/`BACKEND_ARCHITECTURE.md` v0.10 (manejador global de errores) — `shared/lib/api.js` (`getErrorMessage()`) lo consume de forma consistente en toda la app.

---

## 7. Routing

- **Implementado:** `react-router-dom` 7.14.1, `BrowserRouter`, rutas anidadas con layouts compartidos (`AppShell`, `PublicLayout`), rutas protegidas (`ProtectedRoute`).
- **28 rutas** (antes 6 en v0.2):

  | Grupo | Rutas | Layout | Protegida |
  |---|---|---|---|
  | Auth | `/`, `/login`, `/register`, `/forgot-password`, `/reset-password` (5) | ninguno | No |
  | Producto (feed) | `/feed`, `/discover`, `/messages`, `/notifications`, `/profile`, `/settings` (6) | `AppShell` | **Sí** — `ProtectedRoute` |
  | Público/legal/ayuda | `/information` (+4 subrutas), `/blog`, `/help` (+3 subrutas anidadas: `category/:categoryId`, `article/:slug`, `search`), `/popular`, `/locations`, `/contacts/import`, `/terms`, `/privacy`, `/cookies` (17) | `PublicLayout` | No |

- **`ProtectedRoute` (`app/router/ProtectedRoute.jsx`) — nuevo desde v0.3, cierra la Open Architectural Decision #2 (§24) de v0.2.** Única fuente de verdad de si una rama de rutas requiere sesión: consulta `useAuth().isAuthenticated`/`isLoading` (nunca `localStorage` directamente), muestra un `Spinner` mientras `AuthContext` resuelve la sesión, y redirige a `/login` si no hay usuario. `AppShell` ya no decide esto por su cuenta (lo hacía antes, de forma redundante).
- **No implementado:** lazy loading de páginas (`React.lazy`/`Suspense`), rutas 404 explícitas (una URL sin match no tiene una página de error propia).

---

## 8. Estado (state management)

- **Implementado — v0.3, cierra la Open Architectural Decision #1 (§24) de v0.2 de facto:** Context API, tres providers compuestos en `App.jsx` (`<LanguageProvider><AuthProvider><ToastProvider><Router/></ToastProvider></AuthProvider></LanguageProvider>`):
  - **`AuthContext`** (`features/auth/context/AuthContext.jsx`) — sesión del usuario: `user`, `isAuthenticated`, `isLoading`, `login`, `register`, `logout`, `loadCurrentUser`, `updateProfile`. Es la única fuente de verdad de la identidad — `ProtectedRoute`, `AppShell` y `Profile.jsx` la consumen, ninguno mantiene su propia copia.
  - **`LanguageContext`** (`shared/i18n/`) — idioma actual (ES/EN) y función `t()`/`tList()`.
  - **`ToastContext`** (`shared/components/Toast/`) — notificaciones de error/éxito, reemplaza los `alert()` que existían en v0.2.
  - No hay Redux, Zustand ni Jotai — Context API alcanza para el tamaño actual del árbol de estado (sesión + idioma + notificaciones, ninguno de alta frecuencia de actualización).
- **Estado local por feature, sin cambios de patrón respecto a v0.2:** cada página sigue usando `useState` para su propio estado de formulario/UI. `AppShell.jsx` mantiene `capsules`/`notifications`/`followingIds` (mock, ver §6) como estado local, expuesto a las páginas hijas vía el `context` de `<Outlet>`.
- Elegir Context API en vez de una librería fue una decisión que el código ya tomó — este documento la registra como hecho, no la re-decide. Si el volumen del estado del feed (una vez deje de ser mock) llegara a justificar algo más sofisticado, es una decisión nueva, no una consecuencia automática de esto.

---

## 9. Data fetching / API client

- **Implementado:** `src/shared/lib/api.js` — instancia única de `axios`, `baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:5000/api"` (advertido por consola si falta la variable). `getErrorMessage(error, t)` traduce cualquier respuesta de error del backend a un mensaje para el usuario, usando el traductor de `shared/i18n` — sin acoplar este módulo a React.
- **Patrón de consumo:** cada feature que necesita datos llama a `api` directamente desde su contexto o componente (`AuthContext`, `Login.jsx`, `Register.jsx`, `Profile.jsx`) — sigue sin existir una capa `services/` por feature.
- **No implementado:** interceptores de axios (adjuntar el token automáticamente en vez de pasarlo a mano en cada llamada, manejar `401` de forma centralizada — hoy cada caller de `AuthContext` lee `localStorage` y arma el header `Authorization` por su cuenta), reintentos, cancelación de requests, cache de datos (React Query/SWR).

---

## 10. Autenticación y autorización

Estado actual, ya real de punta a punta — reemplaza por completo la descripción de v0.2 (login con contraseña hardcodeada, registro que no llamaba a ningún backend):

- **Login:** `Login.jsx` valida formato de email/presencia de password (`features/auth/lib/validators.js`), llama a `AuthContext.login({ email, password })` → `POST /api/login` real, navega a `/feed` en éxito, muestra el error vía `Toast` (`getErrorMessage`).
- **Registro:** `Register.jsx` recolecta y envía el payload completo (`name`, `username`, `email`, `phone`, `country_code`, `birth_date`, `password`, `confirm_password`) a `POST /api/register` real — ya no hay ningún `TODO BACKEND` ni `console.log` en su lugar.
- **Sesión:** `AuthContext.loadCurrentUser()` corre en el montaje de `App.jsx` (vía `AuthProvider`) y llama a `GET /api/users/me` con el token de `localStorage`; un `401`/`404` limpia la sesión (`logout()`). El token vive en `localStorage` (`token`), el usuario cacheado en `localStorage` (`user`) como copia de lectura rápida — `GET /api/users/me` sigue siendo la fuente de verdad.
- **Edición de perfil:** `Profile.jsx` → `AuthContext.updateProfile(patch)` → `PATCH /api/users/me` real (ADR-003) — la respuesta del backend reemplaza `user` por completo, nunca un merge local parcial.
- **Rutas protegidas:** `ProtectedRoute` (§7) — implementado, cierra la decisión que en v0.2 seguía abierta.
- **No implementado:** verificación de expiración del token en el cliente (se descubre recién en la siguiente llamada que devuelva `401`), refresh token, interceptor centralizado de `401`, login con Google/Apple (los botones siguen existiendo visualmente en `Login.jsx`/`Register.jsx`/`AuthPage.jsx`, sin `onClick` conectado a ningún flujo OAuth real — `useOAuthNotice` solo muestra un aviso de "próximamente").
- **`PENDIENTE DE APROBACIÓN`** (§24, ítem 2 — reducido de alcance respecto a v0.2, la mitad ya se resolvió): dónde vive el token a mediano plazo (`localStorage` vs. cookie `httpOnly`, ver riesgo en §16) y la política de expiración/refresh — depende de la misma decisión todavía pendiente del lado del backend (`BACKEND_ARCHITECTURE.md` §20, ítem 9).

---

## 11. Formularios y validación

- **Implementado:** formularios controlados con `useState` + `onChange`, sin librería declarativa — pero **ya no es solo `.trim()` y no-vacío como en v0.2**: `features/auth/lib/validators.js` centraliza `isValidEmail` y otras reglas de formato, reutilizadas por `Login.jsx`/`Register.jsx`; `PasswordStrength`/`usePasswordStrength` dan feedback de fuerza de contraseña en vivo; `PhoneField`/`BirthDateField`/`CountryCode` tienen su propia validación de formato coherente con lo que el backend exige (`domain/auth/validators.py`).
- **No implementado:** ninguna librería de formularios/validación (React Hook Form, Formik, Zod, Yup) — el número de formularios (5 en `auth`, más los del feed) sigue siendo manejable a mano, pero ya no es "prematuro" descartar una librería solo por bajo volumen como decía v0.2. Se mantiene como Open Architectural Decision de prioridad media (§24, ítem 5), sin subir de prioridad por falta de evidencia de que el código manual esté costando tiempo real.

---

## 12. Manejo de errores y estados de carga

- **Implementado — v0.3, reemplaza el `alert()` de v0.2 por completo:** `shared/components/Toast/` (`ToastContext`, `useToast()`) — notificaciones de error/éxito consistentes en toda la app, con título e i18n. `getErrorMessage(error, t)` (`shared/lib/api.js`) traduce cualquier respuesta HTTP del backend a un mensaje entendible, ya alineado con el formato de error uniforme que el backend garantiza desde `BACKEND_ARCHITECTURE.md` v0.10.
- **Estados de carga:** `Spinner` (`shared/components/Spinner.jsx`) — usado en `ProtectedRoute` mientras se resuelve la sesión, y en formularios (`isSubmitting`) para deshabilitar el botón durante la petición.
- **No implementado:** skeletons para contenido (feed, help), estados vacíos diseñados de forma sistemática, manejo diferenciado de error de red vs. error de servidor más allá de lo que `getErrorMessage` ya distingue (sin conexión / `401` / `409` / `400` / genérico).

---

## 13. Design System

> ⚠️ Sección crítica — confirmado directamente en la fuente. `DS-001` §1.2 declara textualmente: **"No aplica al producto THERS en sí... si en el futuro se decide unificarlos, eso es una decisión de gobernanza (sección 16), no una consecuencia automática de este documento."**

- **Sigue sin existir ningún Design System ratificado por el Comité Técnico para `Frontend/`.** Este documento no extrapola `DS-001` ni inventa uno nuevo — solo registra lo que el código ya tiene.
- **Tokens "clásicos" (v0.3) — sin cambios:** `tailwind.config.js` centraliza `canvas`, `surface`, `ink`, `muted`, `line`, `pulse` (acento de marca), `ember` (error/destructivo), `success`, `warning`, sombras (`soft`/`lift`/`glow`) y animaciones (`marquee`, `capsule-in`, `pop-like`, `mood-glow`, `float-in`). Siguen en uso en `auth/`, `help/`, `public/` y `legal/`. La referencia colgante a un `PRODUCT_DESIGN_SYSTEM.md` inexistente, señalada en v0.3, sigue sin resolverse.
- **v0.4 — segundo sistema de tokens, prefijo `th-`, con documento propio.** `Frontend/src/shared/design/tokens.css` + `docs/THERS_DESIGN_SYSTEM.md` (ambos nuevos) definen un segundo set de tokens (color, tipografía, espaciado, radios, sombras, capas, movimiento) para el shell rediseñado (`app/layout/thers/`, `features/feed/`). No reemplaza al de v0.3: ambos conviven a propósito, cada módulo usa el suyo (ver `docs/THERS_DESIGN_SYSTEM.md` §1).
- **Origen de la decisión — autorizado por el propietario del proyecto, no por el Comité Técnico.** `THERS_IMPLEMENTACION_MAESTRA_CLAUDE.md` (raíz del repo, fuera de `/docs`) instruyó explícitamente reconstruir estas pantallas con fidelidad a un set de referencias visuales, incluyendo crear la fuente de tokens que eso requiere. Es una autorización real del dueño del proyecto, pero **no equivale a la ratificación del equipo que exige `HB-001` §11–12** para una decisión de este impacto, ni a la que `DS-001` §16 exige para tocar la relación Handbook/producto.
- **`PENDIENTE DE APROBACIÓN`:** ratificar formalmente este segundo sistema de tokens (o fusionarlo con el de v0.3, o mantenerlos separados a propósito) vía ADR, siguiendo `HB-001` §11–12 — señalado aquí, no resuelto por este documento.

---

## 14. Responsive y accesibilidad

- **Responsive:** utilidades responsive de Tailwind en uso consistente (`AppShell`/`NavRail`/`MobileNav` implementan explícitamente un layout de escritorio con rail lateral y uno mobile con navegación inferior — no es un caso puntual como en v0.2, es un patrón de layout completo). No hay una estrategia de breakpoints documentada formalmente ni una verificación sistemática página por página.
- **Accesibilidad — más atención que en v0.2, sin ser todavía una política formal:** `AppShell` usa `aria-label` en los controles de icono (búsqueda, mensajes, notificaciones, menú de perfil), textos vía i18n en vez de hardcodeados. Sigue sin haber verificación de contraste sistemática ni un estándar documentado (a diferencia del Handbook, donde `DS-001` §12 exige WCAG 2.2 AA — esa exigencia no se hereda automáticamente al producto).
- No se fija aquí un estándar de accesibilidad formal — se señala como gap, no se llena.

---

## 15. Performance

- La app pasó de 6 rutas estáticas a 28, con un sistema de layout, i18n y estado global — sigue sin haber code splitting (`React.lazy`/`Suspense`) ni lazy loading de rutas. Con el volumen actual (todavía sin datos reales de feed/medios) no es un problema medible, pero ya no es tan claramente "prematuro optimizar" como en v0.2.
- No se proponen reglas de performance específicas en esta versión — revisar cuando el feed deje de ser mock y cargue datos/medios reales.

---

## 16. Seguridad Frontend

Estado actual observado, sin proponer remediaciones como si fueran ya decididas:

| Área | Estado |
|---|---|
| Almacenamiento del token JWT | `localStorage` (`AuthContext.jsx`) — expuesto a lectura por cualquier script que corra en la página (riesgo XSS). Alternativa común (cookie `httpOnly`) no evaluada ni decidida — `PENDIENTE DE APROBACIÓN` (§10, §24 ítem 2) |
| Variables de entorno / secretos | Ningún secreto en el Frontend (correcto, nunca debe haberlo — ver `PUBLIC CONFIG` vs. `SECRET CONFIG` en §17) |
| Datos sensibles en código fuente | **v0.3 — resuelto.** La contraseña `"123456"` hardcodeada en `Login.jsx` (v0.2) ya no existe — el formulario recoge y envía la contraseña real del usuario |
| XSS | No hay uso de `dangerouslySetInnerHTML` ni inyección de HTML no confiable en el código actual — superficie de riesgo baja hoy; sigue sin haber política documentada para cuando exista contenido generado por usuarios (posts, comentarios del feed, todavía mock) |
| CORS | Responsabilidad del backend (`CORS(app)` sin restricción — `BACKEND_ARCHITECTURE.md` §13); el Frontend no la controla. Relevante ahora que el backend tiene un primer despliegue real (Render, ver `BACKEND_ARCHITECTURE.md` v0.12) — sin URL de Frontend desplegada todavía que whitelistear, sigue sin ser accionable restringir el origen |

---

## 17. Variables de entorno

- **Estado actual:** `Frontend/.env.example` documenta `VITE_API_URL` (sin valores reales) y `Frontend/.gitignore` protege un `.env` real. `src/shared/lib/api.js` lee `import.meta.env.VITE_API_URL`, con fallback al valor de desarrollo local si no está definida.
- **Distinción a mantener:**
  - `PUBLIC CONFIG` (seguro de exponer en el bundle del cliente, prefijo `VITE_` requerido por Vite): hoy solo `VITE_API_URL`.
  - `SECRET CONFIG`: **nunca** debe vivir en el Frontend.
- `VITE_API_URL` sigue apuntando a `http://127.0.0.1:5000/api` por defecto — todavía no se ha actualizado para apuntar a ningún backend desplegado (el equipo decidió explícitamente no pasar a producción todavía).

---

## 18. Testing

- **Sin cambios respecto a v0.2: no hay ningún framework de testing instalado ni configurado** en `Frontend/`. Confirmado de nuevo en esta auditoría — sin `vitest.config.*`, sin `jest.config.*`, sin carpeta `__tests__/` ni archivos `*.test.jsx`/`*.spec.jsx`.
- Dado que el backend ya adoptó `pytest` pragmáticamente sin ratificación formal (`BACKEND_ARCHITECTURE.md` §15/§20 ítem 12), y que el stack Frontend ya usa Vite, `Vitest` es el candidato de menor fricción si el equipo decide adoptar algo — pero **no se decide aquí** (§24, ítem 6).

---

## 19. Linting y formatting

- **ESLint — v0.3, resuelto.** `eslint.config.js` (flat config) existe, con `eslint` 9.39.5, `eslint-plugin-react`, `@eslint/js` y `globals`; `package.json` tiene el script `"lint": "eslint ."`. Ya corre localmente (`npm run lint`) — **no corre todavía en CI** (`.github/workflows/ci.yml` solo ejecuta `npm run build` para el job de Frontend, no `npm run lint`) — hueco nuevo, sin cerrar.
- **Prettier:** sigue sin instalarse en `Frontend/` (sí existe en `handbook/`, aplicación independiente).

---

## 20. Convenciones de naming y estructura

Confirmadas por `REPOSITORY_STRUCTURE.md` §8 y verificadas contra el código real:

- Componentes React: PascalCase (`AuthPage.jsx`, `Login.jsx`, `AppShell.jsx`, `HelpArticleCard.jsx`).
- Hooks: camelCase con prefijo `use` (`useAuth`, `useTheme`, `useOAuthNotice`, `useHelpSearch`).
- Archivos de configuración: kebab-case (`vite.config.js`, `tailwind.config.js`, `eslint.config.js`).
- Código, nombres de carpeta y archivo: inglés (`auth`, `legal`, `feed`, `help`, `shared`).
- Organización por dominio funcional (`features/<dominio>/{components,pages,...}` + `index.js` como barrel), no por tipo de archivo.

**Alias de imports (`vite.config.js`):**

| Alias | Apunta a | Uso real verificado |
|---|---|---|
| `@` | `Frontend/src` | `@/assets/...`, `@/app/layout/AppShell` |
| `@features` | `Frontend/src/features` | `@features/auth`, `@features/feed`, `@features/help`, etc. |
| `@shared` | `Frontend/src/shared` | `@shared/lib/api`, `@shared/components/Toast`, `@shared/i18n` |
| `@assets` | `Frontend/src/assets` | Uso confirmado más allá de `@/assets/...` desde v0.3 |

---

## 21. Entorno de desarrollo

```bash
cd Frontend
npm install
npm run dev       # servidor de desarrollo (Vite)
npm run build      # build de producción → dist/
npm run lint        # eslint . — nuevo desde v0.3
npm run preview      # sirve el build de producción
```

- **Node version:** no fijada en ningún `.nvmrc` ni `package.json engines` — `PENDIENTE DE APROBACIÓN`.
- **Package manager:** npm (`package-lock.json`).
- **Variables de entorno:** copiar `Frontend/.env.example` a `Frontend/.env` y ajustar `VITE_API_URL` si el backend no corre en `http://127.0.0.1:5000`.
- **Integración con Backend:** `backend/requirements.txt` ya existe — un desarrollador Frontend nuevo puede levantar el backend localmente (`pip install -r requirements-dev.txt`, `docker compose up -d`, `flask db upgrade`, `python run.py`) para probar el flujo completo (register → login → feed → editar perfil) sin coordinarse manualmente con nadie más.

---

## 22. Conflictos detectados

| # | Conflicto | Fuente A | Fuente B | Impacto | Estado |
|---|---|---|---|---|---|
| 1 | Motor de base de datos | `HB-001`/`BACKEND_ARCHITECTURE.md`/`DATABASE_ARCHITECTURE.md` → PostgreSQL | `README.md` raíz → MySQL (histórico) | Bajo | **RESUELTO** — `CLAUDE.md` §15 registra el `README.md` como ya corregido |
| 2 | Estructura de carpetas del Frontend en `README.md` vs. real | `README.md` raíz (histórico) → `frontend/src/{components,pages,routes,context,services}` | Código real → `Frontend/src/{app,features,shared}` | Bajo | **RESUELTO** — mismo motivo que #1 |
| 3 | `app/providers/`/`app/store/` documentados vs. inexistentes | `REPOSITORY_STRUCTURE.md` §3 (histórico) | Filesystem real | Bajo | **RESUELTO** — ver §4 |
| 4 | Alias de imports no documentados en `CLAUDE.md` | `CLAUDE.md` §9/§10 | `vite.config.js` + uso real (§20) | Bajo | Sigue sin resolver — no se modifica `CLAUDE.md` en esta tarea |
| 5 | Identificador `STD-001` referenciado pero inexistente como tal | `FAS-001`, `WF-001`, `PV-001`, `REPOSITORY_STRUCTURE.md` citan "STD-001" | El único Manual de Organización real tiene ID `HB-001` | Bajo | Sin resolver |
| 6 | `PRODUCT_DESIGN_SYSTEM.md §2.3` citado en `tailwind.config.js`, archivo inexistente | Comentarios en `tailwind.config.js` | Búsqueda global del repositorio | Medio | **Nuevo en v0.3 — sin resolver, ver §13** |

Ninguno de estos conflictos se resuelve por iniciativa propia de este documento — se listan para decisión del equipo.

---

## 23. Matriz de trazabilidad

| Decisión Frontend | Fuente | Estado | Evidencia |
|---|---|---|---|
| React | `HB-001` portada + `Frontend/package.json` | OFICIAL + EXISTENTE | React 19.2.4 |
| Vite | `HB-001` portada + `vite.config.js` | OFICIAL + EXISTENTE | Vite 8.0.1 |
| Tailwind CSS (v3) | `HB-001` portada + `tailwind.config.js` | OFICIAL + EXISTENTE | v3.4.4, con tokens propios (§13) |
| React Router | Código real | EXISTENTE (no OFICIAL) | `react-router-dom` 7.14.1, rutas anidadas + protegidas |
| Axios | Código real | EXISTENTE | `shared/lib/api.js` |
| Organización por `features/` (5) | `REPOSITORY_STRUCTURE.md` §2/§5 | OFICIAL (borrador) + EXISTENTE | `auth`, `legal`, `public`, `feed`, `help` |
| Alias `@`/`@features`/`@shared`/`@assets` | Código real | EXISTENTE | `vite.config.js` + uso en imports |
| Estado global — Context API | Código real | **EXISTENTE — v0.3** (antes PROPUESTO) | `AuthContext`, `LanguageContext`, `ToastContext` |
| Rutas protegidas | Código real | **EXISTENTE — v0.3** (antes PROPUESTO) | `ProtectedRoute.jsx` |
| Design System | `DS-001` §1.2 | Explícitamente NO aplica | Texto literal de exclusión; tokens propios sin ratificar (§13) |
| Frontend ↔ Backend vía API HTTP/JSON | `BACKEND_ARCHITECTURE.md` §17 | HEREDADO | Regla de capas del backend |
| Frontend nunca accede a PostgreSQL directamente | `DATABASE_ARCHITECTURE.md` §13 | HEREDADO | Regla de capas de datos |
| Auth/perfil real (`register`/`login`/`GET`/`PATCH /me`) | `API_CONTRACT.md` §4 | **EXISTENTE — v0.3** (antes solo backend) | `AuthContext.jsx` |
| Variables de entorno (`VITE_API_URL`) | Código real | EXISTENTE (no OFICIAL) | `Frontend/.env.example`, `shared/lib/api.js` |
| Lint cableado | Código real | **EXISTENTE — v0.3** (antes PROPUESTO) | `eslint.config.js` + script `lint` |
| Testing | — | PROPUESTO | Ausencia de Vitest/Jest/Playwright |
| Feed/mensajería/notificaciones reales | — | PROPUESTO — bloqueado por `DATABASE_ARCHITECTURE.md` §4.C | 100% mock (`mockData.js`) |

---

## 24. Open Architectural Decisions

| # | Decisión | Prioridad | Estado |
|---|---|---|---|
| 1 | ~~Estrategia de estado global~~ | ~~Alta~~ | **Resuelto de facto — v0.3.** Context API en uso real (§8). Sin ratificación formal explícita, pero ya no es un hueco de arquitectura |
| 2 | Estrategia de sesión: dónde vive el token a mediano plazo, expiración/refresh | **Alta** | Parcialmente resuelto — rutas protegidas y sesión real ya existen (§10); dónde vive el token y su expiración siguen abiertos, dependientes de una decisión también pendiente del backend |
| 3 | ~~Variables de entorno (`VITE_API_URL`)~~ | ~~Alta~~ | **Resuelto** (v0.2) |
| 4 | `PRODUCT_DESIGN_SYSTEM.md`: formalizar, o quitar la referencia colgante de `tailwind.config.js` | **Media-Alta** — subió de prioridad en v0.3, la referencia colgante ya es un hallazgo concreto, no solo una ausencia | Sin resolver |
| 5 | Librería de formularios/validación | **Media** | Sin resolver — 5+ formularios en `auth`, el código manual sigue siendo manejable |
| 6 | Framework y estrategia de testing (Vitest, dado el stack) | **Media** | Sin resolver |
| 7 | Estructura interna definitiva de cada `feature/` | **Baja** | Sin resolver — 5 features ya divergen levemente en su forma interna, sin que eso haya causado un problema real todavía |
| 8 | ~~Activar lint~~ | ~~Baja~~ | **Resuelto — v0.3** (`eslint.config.js` + script). Falta cablearlo a CI — ver §19 |
| 9 | Ejecutar `npm run lint` en `.github/workflows/ci.yml` | **Baja** — nuevo en v0.3 | El script ya existe (§19), CI todavía no lo llama |

---

## 25. Información que deberá consumir DevOps

- **Node version:** no fijada — `PENDIENTE`.
- **Package manager:** npm (`package-lock.json`).
- **Build command:** `npm run build` (`vite build`).
- **Lint command:** `npm run lint` (`eslint .`) — nuevo desde v0.3, disponible para un gate de CI que todavía no lo usa.
- **Output directory:** `dist/` (default de Vite).
- **Preview/health check:** `npm run preview`.
- **Variables de entorno de build:** `VITE_API_URL` — debe apuntar al backend real en el entorno correspondiente; hoy solo se usa el valor de desarrollo local, el equipo decidió explícitamente no desplegar el Frontend todavía.
- **Docker:** sin Dockerfile ni requisito documentado — territorio no especificado.
- **Testing command:** no existe — bloqueante para cualquier gate de CI que dependa de tests (§24, ítem 6).
- **Contexto nuevo — v0.3:** el backend ya tiene un primer despliegue real (Render, `BACKEND_ARCHITECTURE.md` v0.12) que el equipo todavía no está usando en producción a propósito. Cuando se decida desplegar el Frontend, `VITE_API_URL` de build deberá apuntar a esa URL real — no hay todavía ninguna decisión de dónde se desplegaría el Frontend en sí (Vercel/Netlify/Render static/otro), territorio DevOps sin documentar.

---

## 26. Fuentes consultadas

- `CLAUDE.md` (raíz) — índice de reglas operativas y jerarquía de fuentes.
- `docs/architecture/REPOSITORY_STRUCTURE.md` — estructura del monorepo.
- `docs/architecture/organization/01_Manual_Organizacion/Source/HB-001-manual-organizacion.md.md` — Manual de Organización.
- `docs/architecture/BACKEND_ARCHITECTURE.md` y `API_CONTRACT.md` — arquitectura y contrato del backend, usados para la frontera de integración (§6, §10).
- `docs/architecture/DATABASE_ARCHITECTURE.md` — modelo de datos, usado para §6 (estado mock del feed).
- `docs/architecture/design/design-system/source/DS-001-design-system.md.md` — confirma (§1.2) que no aplica al producto (§13).
- `docs/architecture/Frontend/FAS-001-Frontend-Architecture-Specification.md` — confirma su propio alcance exclusivo al Handbook (§2).
- Código fuente completo de `Frontend/src/` (verificado archivo por archivo en esta auditoría): `package.json`, `vite.config.js`, `tailwind.config.js`, `eslint.config.js`, `App.jsx`, `main.jsx`, `app/router/router.jsx`, `app/router/ProtectedRoute.jsx`, `app/layout/{AppShell,NavRail,MobileNav,PublicLayout}.jsx`, `shared/lib/api.js`, `shared/hooks/useTheme.js`, `shared/i18n/index.js`, `shared/components/Toast/index.js`, `features/auth/context/AuthContext.jsx`, `features/auth/pages/Login.jsx`, `features/{auth,feed,help,public,legal}/index.js`, y el árbol completo de `src/` vía listado de archivos.
- `THERS_PROJECT_INVENTORY.md`/`NOTION_PROJECT_CONTEXT.md` (2026-08-25) — ya habían señalado independientemente que este documento estaba desactualizado (`INV-01`); esta versión lo resuelve.

---

## 27. Cierre

Este documento **no modifica** el código de `Frontend/`, el backend, la base de datos ni el Handbook: define el contrato de arquitectura Frontend que la implementación futura deberá respetar, separando explícitamente **lo implementado**, **lo propuesto** y **lo pendiente de aprobación** (§24). Cualquier cambio a este contrato sigue el proceso de decisiones de impacto medio/alto de `HB-001` §11–12 (ADR), no el criterio individual de quien implementa.

---

## 28. THERS Places en la web (`ADR-040-thers-places.md`, fase 3) — v0.5

- **Feature nueva** `features/places/` (`pages/Places.jsx`, `components/`, `hooks/`, `lib/`, `index.js`), con las rutas `/places` y `/places/:placeId` dentro de `AppShell` (protegidas, como el resto del shell) y un destino «Lugares» en la barra lateral real (`app/layout/thers/navigation.js`; `NavRail.jsx` ya no se usa). La página es un **chunk propio** (`places-*.js`, ~1,07 MB / 290 KB comprimido) porque MapLibre pesa.
- **Dependencia nueva:** `maplibre-gl` 6.13.0 (BSD-3-Clause). Sin `react-map-gl`: se usa directamente.
- **Proveedor de tiles abstraído:** `VITE_MAP_STYLE_URL` (§17). Sin ella se usa el estilo de demostración de MapLibre, que se rotula en pantalla («Mapa de demostración») y se advierte por consola. **La decisión del proveedor (D1) sigue pendiente.**
- **Worker de MapLibre.** MapLibre 6 busca su Web Worker junto al script que lo carga; empaquetado con Vite ese archivo no existe y el mapa queda vacío. `vite-maplibre-worker.js` lo sirve desde `/maplibre/maplibre-gl-worker.mjs` (en `dev` y `build`), leyéndolo de `node_modules` (no se copia código de terceros al repositorio), y `PlacesMap.jsx` lo conecta con `setWorkerUrl()`.
- **Privacidad de la ubicación (ADR-040 §4.4/§6):** la ubicación se pide solo al pulsar «Usar mi ubicación» (una lectura, sin `watchPosition`), se redondea a 3 decimales antes de salir y vive solo en memoria. Rechazarla no desactiva nada. `public/_headers` tenía `Permissions-Policy: geolocation=()`, que **bloqueaba la geolocalización en la web desplegada**: ahora es `geolocation=(self)`. El CSP (aún en modo informe) admite `worker-src blob:`; al elegir proveedor hay que añadir su dominio a `connect-src`.
- **Estados de la vista:** `loading`, `offline`, `error`, `empty` y `success` se resuelven en `lib/placesState.js` (puro, probado); `location_denied` es un aviso, no un estado que rompa la lista. Un fallo de red o del servidor nunca deja la pantalla rota.
- **Pruebas:** `tests/places.test.mjs` (`npm test`, `node --test`, 24 pruebas; 64 en total con las de otras features) cubre la lógica pura, las traducciones completas es/en, la privacidad y la integración. **Además se verificó a mano en un Chrome real** (headless, vía DevTools) con el build de producción y la API de desarrollo: lista, mapa con pines, ficha, guardar (persiste tras recargar), reportar, búsqueda sin tildes, filtro, sin resultados y ubicación denegada. Esa verificación **no está automatizada**: la web sigue sin framework de pruebas de navegador.
