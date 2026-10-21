import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import collage from "@/assets/collage.png";
import logo from "@/assets/logo_oficial.jpeg";
import { useAuth } from "@features/auth";
import { InstallAppButton } from "@features/install";
import { getErrorMessage } from "@shared/lib/api";
import { Footer } from "@shared/components/Footer";
import { useToast } from "@shared/components/Toast";
import LanguageSwitcher from "@shared/components/LanguageSwitcher";
import { useLanguage } from "@shared/i18n";
import GoogleSignInButton from "../components/GoogleSignInButton";

export default function AuthPage() {
  const navigate = useNavigate();
  const { loginWithGoogle } = useAuth();
  const toast = useToast();
  const { t } = useLanguage();
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  // "Continuar con Google" desde la landing (ADR-012-google-sign-in.md) --
  // mismo patrón exacto que Login.jsx/Register.jsx: es la misma operación
  // sin importar desde qué pantalla se dispare.
  const handleGoogleCredential = async (credential) => {
    if (isGoogleSubmitting) return;
    setIsGoogleSubmitting(true);
    try {
      const googleResult = await loginWithGoogle(credential);
      if (googleResult.twoFactorRequired) {
        // ADR-026: la cuenta tiene 2FA, falta el segundo factor.
        navigate("/two-factor", { state: { twoFactorToken: googleResult.twoFactorToken } });
        return;
      }
      const googleUser = googleResult.user;
      navigate(googleUser.profile_completed ? "/feed" : "/complete-profile");
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, t), { title: t("auth.landing.title") });
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white relative">

      {/* En el celular el logo y el idioma son una fila normal arriba: antes flotaban (absolute)
          encima del título. Desde `md`, con el collage a la izquierda, vuelven a flotar sobre él. */}
      <header className="flex items-center justify-between px-5 pt-5 md:pointer-events-none md:absolute md:inset-x-0 md:top-0 md:z-10">
        <div className="bg-white/10 backdrop-blur-md p-1.5 md:p-2 rounded-full shadow-lg md:pointer-events-auto">
          <img
            src={logo}
            alt="THERS"
            className="w-11 h-11 md:w-12 md:h-12 rounded-full object-cover"
          />
        </div>

        <div className="md:pointer-events-auto">
          <LanguageSwitcher />
        </div>
      </header>

      <div className="flex-1 flex">
        {/* IZQUIERDA */}
        <div className="hidden md:flex w-1/2 relative items-center justify-center bg-black overflow-hidden">

          <img
            src={collage}
            alt={t("auth.landing.heroImageAlt")}
            className="w-full h-full object-cover opacity-80"
          />

          <div className="absolute inset-0 bg-black/40"></div>

          <div className="absolute inset-0 flex items-center justify-center text-center px-6">
            <h1 className="text-white text-4xl md:text-5xl font-extrabold">
              {t("auth.landing.heroTitle")}
            </h1>
          </div>

        </div>

        {/* DERECHA */}
        <div className="w-full md:w-1/2 flex flex-col justify-center px-6 sm:px-10 py-8 max-w-md mx-auto">

          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 sm:mb-6 leading-tight">
            {t("auth.landing.title")}
          </h1>

          <h2 className="text-xl sm:text-2xl font-bold mb-5 sm:mb-6">
            {t("auth.landing.subtitle")}
          </h2>

          <GoogleSignInButton
            onCredential={handleGoogleCredential}
            disabled={isGoogleSubmitting}
          />

          <div className="flex items-center my-4">
            <div className="flex-1 h-px bg-line"></div>
            <span className="px-3 text-muted">{t("auth.or")}</span>
            <div className="flex-1 h-px bg-line"></div>
          </div>

          <button
            onClick={() => navigate("/register")}
            className="w-full bg-black text-white py-3 rounded-full font-bold"
          >
            {t("auth.landing.createAccount")}
          </button>

          <p className="text-xs text-muted mt-4">
            {t("auth.landing.acceptPrefix")}{" "}
            <Link to="/terms" className="text-pulse-600 hover:underline">
              {t("auth.landing.termsLink")}
            </Link>{" "}
            {t("auth.landing.acceptMiddle")}{" "}
            <Link to="/privacy" className="text-pulse-600 hover:underline">
              {t("auth.landing.privacyLink")}
            </Link>
            {t("auth.landing.acceptSuffix")}{" "}
            <Link to="/cookies" className="text-pulse-600 hover:underline">
              {t("auth.landing.cookiesLink")}
            </Link>.
          </p>

          <div className="mt-8 text-sm font-semibold flex flex-wrap justify-center gap-2 items-center">
            <span className="font-bold">{t("auth.landing.alreadyHaveAccount")}</span>

            <button
              onClick={() => navigate("/login")}
              className="bg-pulse-600 text-white px-4 py-2 rounded-full font-bold hover:bg-pulse-700 transition"
            >
              {t("auth.landing.login")}
            </button>
          </div>

          {/* QR en computadora, descarga del APK en Android (features/install). */}
          <div className="mt-6">
            <InstallAppButton />
          </div>

        </div>
      </div>

      <Footer />
    </div>
  );
}
