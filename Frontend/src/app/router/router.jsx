import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Pantallas de entrada (landing y flujo de auth): van en el bundle inicial porque
// son lo primero que ve un visitante. Todo lo demás se descarga al navegar
// (Core Web Vitals, LAUNCH_CHECKLIST §3): la app tras el login, las páginas
// públicas, la ayuda, los textos legales y la moderación no pesan en la primera carga.
import {
  AuthPage,
  Login,
  Register,
  ForgotPassword,
  VerifyResetCode,
  ResetPassword,
  VerifyRegistrationCode,
  TwoFactorChallenge,
  CompleteProfile,
} from "@features/auth";
import Spinner from "@shared/components/Spinner";
import ProtectedRoute from "./ProtectedRoute";
import RouteSeo from "@/shared/seo/RouteSeo";
import NotFound from "@/shared/seo/NotFound";

// Cada barril `@features/*` se convierte en su propio chunk. `named` toma un
// export con nombre del barril y lo adapta a lo que espera React.lazy.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));

const loadLegal = () => import("@features/legal");
const loadPublic = () => import("@features/public");
const loadHelp = () => import("@features/help");
const loadFeed = () => import("@features/feed");

const Terms = named(loadLegal, "Terms");
const Privacy = named(loadLegal, "Privacy");
const Cookies = named(loadLegal, "Cookies");
const ChildSafety = named(loadLegal, "ChildSafety");
const DeleteAccount = named(() => import("@features/account"), "DeleteAccount");
const Moderation = named(() => import("@features/moderation"), "Moderation");
// THERS Places (ADR-040, fase 3): mapa de lugares. Su propio chunk: MapLibre pesa y solo
// lo necesita quien abre esta página.
const Places = named(() => import("@features/places"), "Places");

const Information = named(loadPublic, "Information");
const HowItWorks = named(loadPublic, "HowItWorks");
const Community = named(loadPublic, "Community");
const Security = named(loadPublic, "Security");
const Faq = named(loadPublic, "Faq");
const Blog = named(loadPublic, "Blog");
const Locations = named(loadPublic, "Locations");
const Popular = named(loadPublic, "Popular");
const ImportContacts = named(loadPublic, "ImportContacts");

const HelpLayout = named(loadHelp, "HelpLayout");
const HelpCenter = named(loadHelp, "HelpCenter");
const HelpCategoryPage = named(loadHelp, "HelpCategoryPage");
const HelpArticlePage = named(loadHelp, "HelpArticlePage");
const HelpSearchPage = named(loadHelp, "HelpSearchPage");

const Home = named(loadFeed, "Home");
const Search = named(loadFeed, "Search");
const Videos = named(loadFeed, "Videos");
const Capsules = named(loadFeed, "Capsules");
const Radar = named(loadFeed, "Radar");
const Messages = named(loadFeed, "Messages");
const Notifications = named(loadFeed, "Notifications");
const Profile = named(loadFeed, "Profile");
const SettingsLayout = named(loadFeed, "SettingsLayout");
const SettingsSectionPage = named(loadFeed, "SettingsSectionPage");

const AppShell = lazy(() => import("@/app/layout/AppShell"));
const PublicLayout = lazy(() => import("@/app/layout/PublicLayout"));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas dark:bg-canvas-dark">
      <Spinner />
    </div>
  );
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <RouteSeo />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* AUTH */}
        <Route path="/" element={<AuthPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-registration-code" element={<VerifyRegistrationCode />} />
        {/* Segundo paso del login con 2FA (ADR-026). Ruta pública: en este
            punto todavía no hay sesión -- el token de desafío viaja por
            router state, no por localStorage. */}
        <Route path="/two-factor" element={<TwoFactorChallenge />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-reset-code" element={<VerifyResetCode />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* THERS -- shell con navegación propia (rail/FAB) + páginas anidadas.
            ProtectedRoute es la única responsable de decidir si hay sesión;
            AppShell ya no redirige por su cuenta. */}
        <Route element={<ProtectedRoute />}>
          {/* Fuera de AppShell a propósito -- ADR-012-google-sign-in.md,
              FASE 18: onboarding de una cuenta con perfil incompleto, no
              una página de la app en sí (sin rail/FAB de navegación). */}
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route element={<AppShell />}>
            <Route path="/feed" element={<Home />} />

            {/* Los siete destinos de la sidebar de referencia
                (docs/THERS_REFERENCE_MANIFEST.md §5) tienen todos una URL
                real: el archivo maestro §6.3 prohíbe dejar un enlace de
                navegación sin destino. */}
            <Route path="/search" element={<Search />} />
            <Route path="/videos" element={<Videos />} />
            <Route path="/capsules" element={<Capsules />} />
            <Route path="/radar" element={<Radar />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/profile" element={<Profile />} />
            {/* Moderación (ADR-032 fase 3). Sin enlace en la navegación a propósito: la página
                se oculta sola a quien no es moderador y el servidor rechaza sus peticiones. */}
            <Route path="/moderation" element={<Moderation />} />
            {/* THERS Places (ADR-040, fase 3). `/places/:placeId` es la ficha de un lugar. */}
            <Route path="/places" element={<Places />} />
            <Route path="/places/:placeId" element={<Places />} />
            {/* Configuración: las 12 secciones son rutas reales, cada una
                con su URL propia para poder enlazarla y recargarla
                (archivo maestro §6.3). */}
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="/settings/profile" replace />} />
              <Route path=":section" element={<SettingsSectionPage />} />
            </Route>

            {/* /discover era la ruta anterior de esta misma superficie. Se
                redirige en vez de mantener dos rutas equivalentes (archivo
                maestro §11: "no dejes dos rutas nueva y vieja sin motivo"). */}
            <Route path="/discover" element={<Navigate to="/search" replace />} />
          </Route>
        </Route>

        {/* PÚBLICO -- páginas informativas/legales, con Footer y navegación pública propia */}
        <Route element={<PublicLayout />}>
          <Route path="/information" element={<Information />} />
          <Route path="/information/how-it-works" element={<HowItWorks />} />
          <Route path="/information/community" element={<Community />} />
          <Route path="/information/security" element={<Security />} />
          <Route path="/information/faq" element={<Faq />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/help" element={<HelpLayout />}>
            <Route index element={<HelpCenter />} />
            <Route path="category/:categoryId" element={<HelpCategoryPage />} />
            <Route path="article/:slug" element={<HelpArticlePage />} />
            <Route path="search" element={<HelpSearchPage />} />
          </Route>
          <Route path="/popular" element={<Popular />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/contacts/import" element={<ImportContacts />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/cookies" element={<Cookies />} />
          {/* Estándares de seguridad infantil (ADR-038): URL pública que exige Google Play. */}
          <Route path="/child-safety" element={<ChildSafety />} />
          {/* Recurso web de eliminación de cuenta que Google Play exige
              (ADR-031-account-deletion.md). Público a propósito. */}
          <Route path="/eliminar-cuenta" element={<DeleteAccount />} />
          {/* Comodín dentro del layout público: una URL rota sigue mostrando
              Footer y navegación (RouteSeo la marca noindex). */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
