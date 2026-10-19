import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import Icon from "@shared/components/Icon";
import { useToast } from "@shared/components/Toast";
import { useLanguage } from "@shared/i18n";
import { api, getErrorMessage } from "@shared/lib/api";
import { SETTINGS_CONTENT } from "../data/settingsSections";
import { loadSettings, saveSetting } from "../lib/settingsStorage";
import { usePrivacySettings } from "../hooks/usePrivacySettings";
import CloseFriendsRow from "../components/settings/CloseFriendsRow";
import FollowRequestsRow from "../components/settings/FollowRequestsRow";
import MutedKeywordsRow from "../components/settings/MutedKeywordsRow";
import TwoFactorRow from "../components/settings/TwoFactorRow";
import DeleteAccountRow from "../components/settings/DeleteAccountRow";
import ActiveSessionsRow from "../components/settings/ActiveSessionsRow";
import MutedTopicsRow from "../components/settings/MutedTopicsRow";
import RestrictedAccountsRow from "../components/settings/RestrictedAccountsRow";
import {
  DataExportHistoryRow,
  DataExportRequestRow,
  useDataExports,
} from "../components/settings/DataExportRow";
import { useSecuritySettings } from "../hooks/useSecuritySettings";
import {
  ActionRow,
  ChoiceRow,
  InfoRow,
  PendingRow,
  ScopeNotice,
  SectionHeader,
  SettingGroup,
  SwitchRow,
} from "../components/settings/SettingsPrimitives";

/**
 * Renderiza una de las 12 secciones de Configuración a partir de su
 * descripción en `data/settingsSections.js`.
 *
 * Un único renderizador en vez de doce componentes casi idénticos: las
 * secciones se diferencian por contenido, no por maquetado (archivo maestro
 * §6, principio de reutilización).
 *
 * Filas con comportamiento REAL:
 *  · `passwordReset`     -> POST /api/forgot-password (ADR-009)
 *  · `emailVerification` -> estado real `email_verified` de la sesión (solo
 *                           informa: la verificación es obligatoria al registrarse,
 *                           ADR-011, y `send-verification-email` se retiró)
 *  · `profileLink`       -> enlace a la edición de perfil ya existente
 *  · `switch` / `choice` -> preferencia guardada en este navegador
 *
 * Filas de privacidad, que se aplican en el SERVIDOR (no en este navegador):
 *  · `privacySwitch` / `privacyChoice` -> PATCH /api/users/me/privacy
 *                           (ADR-022-private-accounts.md, ADR-023-mentions.md,
 *                           ADR-024-content-filters-and-privacy-preferences.md)
 *  · `followRequests`    -> GET/POST/DELETE /api/follow-requests (ADR-022)
 *  · `mutedKeywords`     -> GET/POST/DELETE /api/users/me/muted-keywords (ADR-024)
 *
 * Filas de seguridad, que también se aplican en el SERVIDOR:
 *  · `securitySwitch`    -> PATCH /api/users/me/security (ADR-025-session-registry.md)
 *  · `activeSessions`    -> GET/DELETE /api/sessions (ADR-025)
 *  · `twoFactor`         -> GET/POST /api/2fa/... (ADR-026-two-factor-authentication.md)
 *
 * Preferencias de contenido y feed, también en el SERVIDOR (ADR-030):
 *  · `privacySwitch hide_sensitive_content` -> PATCH /api/users/me/privacy
 *  · `mutedKeywords` (ya existía, ADR-024) y `mutedTopics` ->
 *                           GET/POST/DELETE /api/users/me/muted-topics
 *
 * Bloqueo y restricción de cuentas, también en el SERVIDOR:
 *  · `restrictedAccounts` -> GET/POST/DELETE /api/users/me/blocks y
 *                           /api/users/me/restrictions (ADR-029-blocked-and-restricted-accounts.md)
 *
 * Exportación de datos, también en el SERVIDOR:
 *  · `dataExportRequest` / `dataExportHistory` -> POST/GET /api/data-exports y
 *                           GET /api/data-exports/<id>/download (ADR-028-data-export.md)
 *
 * El objeto de privacidad se carga UNA vez por sección (no una por fila) y se
 * pasa a cada control: cuatro interruptores pidiendo lo mismo al montarse
 * serían cuatro peticiones idénticas.
 */
export default function SettingsSectionPage() {
  const { section } = useParams();
  const { currentUser } = useOutletContext();
  const content = SETTINGS_CONTENT[section];

  const [prefs, setPrefs] = useState(() => loadSettings(currentUser.username));
  // Preferencias reales del servidor. Se piden siempre, no solo en la sección
  // de privacidad: el hook es barato y así no hace falta condicionar un hook
  // al valor de `section` (lo que violaría las reglas de hooks de React).
  const privacySettings = usePrivacySettings();
  // Mismo criterio que `privacySettings`: se carga una vez por sección, no una
  // por fila, y el hook se llama siempre (condicionarlo al valor de `section`
  // violaría las reglas de hooks de React).
  const securitySettings = useSecuritySettings();
  // Solo carga el historial en la sección de descarga de datos (ADR-028).
  const dataExports = useDataExports({ enabled: section === "data" });

  useEffect(() => {
    setPrefs(loadSettings(currentUser.username));
  }, [currentUser.username]);

  const setPref = useCallback(
    (key, value) => {
      setPrefs((previous) => ({ ...previous, [key]: value }));
      saveSetting(currentUser.username, key, value);
    },
    [currentUser.username]
  );

  if (!content) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-th-card border border-dashed border-th-border bg-th-surface px-6 py-16 text-center">
        <Icon name="search_off" size={28} className="text-th-fg-subtle" />
        <p className="text-label-lg font-bold text-th-fg-strong">Sección no encontrada</p>
        <Link to="/settings" className="text-label-lg font-bold text-th-brand-fg hover:underline">
          Volver a Configuración
        </Link>
      </div>
    );
  }

  return (
    <>
      <SectionHeader title={content.title} description={content.description} />

      {content.notice && (
        <ScopeNotice tone={content.notice.tone}>{content.notice.text}</ScopeNotice>
      )}

      {content.groups.map((group) => (
        <SettingGroup
          key={group.title}
          title={group.title}
          description={group.description}
          index={group.index}
        >
          {group.rows.map((row, rowIndex) => (
            <SettingRowRenderer
              key={row.key || row.label || `${group.title}-${rowIndex}`}
              row={row}
              prefs={prefs}
              setPref={setPref}
              currentUser={currentUser}
              privacySettings={privacySettings}
              securitySettings={securitySettings}
              dataExports={dataExports}
            />
          ))}
        </SettingGroup>
      ))}
    </>
  );
}

function SettingRowRenderer({
  row,
  prefs,
  setPref,
  currentUser,
  privacySettings,
  securitySettings,
  dataExports,
}) {
  switch (row.type) {
    // --- Temas silenciados: se aplica en el servidor (ADR-030) ---
    case "mutedTopics":
      return <MutedTopicsRow />;

    // --- Bloqueo y restricción: se aplica en el servidor (ADR-029) ---
    case "restrictedAccounts":
      return <RestrictedAccountsRow kind={row.kind} />;

    // --- Exportación de datos: se aplica en el servidor (ADR-028) ---
    case "dataExportRequest":
      return <DataExportRequestRow state={dataExports} />;

    case "dataExportHistory":
      return <DataExportHistoryRow state={dataExports} />;

    // --- Seguridad: se aplica en el servidor (ADR-025/ADR-026) ---
    case "securitySwitch":
      return (
        <SwitchRow
          label={row.label}
          description={row.description}
          checked={securitySettings.security?.[row.key] ?? false}
          disabled={securitySettings.loading}
          hint="Se aplica en el servidor"
          onChange={(value) => securitySettings.update(row.key, value)}
        />
      );

    case "activeSessions":
      return <ActiveSessionsRow />;

    case "twoFactor":
      return <TwoFactorRow />;

    // --- Eliminación de cuenta (ADR-031): lleva a la página pública con el
    // flujo completo, la misma que se declara en Play Console ---
    case "deleteAccount":
      return <DeleteAccountRow />;

    // --- Privacidad: se aplica en el servidor (ADR-022/ADR-023/ADR-024) ---
    case "privacySwitch":
      return (
        <SwitchRow
          label={row.label}
          description={row.description}
          // Mientras carga se muestra apagado y deshabilitado: dibujarlo
          // encendido por defecto afirmaría una protección que no sabemos si
          // está activa.
          checked={privacySettings.privacy?.[row.key] ?? false}
          disabled={privacySettings.loading}
          hint="Se aplica en el servidor"
          onChange={(value) => privacySettings.update(row.key, value)}
        />
      );

    case "privacyChoice":
      return (
        <ChoiceRow
          id={`privacy-${row.key}`}
          label={row.label}
          description={row.description}
          value={privacySettings.privacy?.[row.key] ?? row.options[0].value}
          options={row.options}
          disabled={privacySettings.loading}
          hint="Se aplica en el servidor"
          onChange={(value) => privacySettings.update(row.key, value)}
        />
      );

    case "followRequests":
      return <FollowRequestsRow onResolved={privacySettings.decrementPendingRequests} />;

    case "closeFriends":
      return <CloseFriendsRow currentUser={currentUser} />;

    case "mutedKeywords":
      return <MutedKeywordsRow />;

    case "switch":
      return (
        <SwitchRow
          label={row.label}
          description={row.description}
          checked={prefs[row.key] ?? row.default ?? false}
          onChange={(value) => setPref(row.key, value)}
        />
      );

    case "choice":
      return (
        <ChoiceRow
          id={`setting-${row.key}`}
          label={row.label}
          description={row.description}
          value={prefs[row.key] ?? row.default ?? row.options[0]}
          options={row.options}
          onChange={(value) => setPref(row.key, value)}
        />
      );

    case "info":
      return <InfoRow label={row.label} description={row.description} value={row.value} />;

    case "profileLink":
      return <ProfileLinkRow currentUser={currentUser} />;

    case "passwordReset":
      return <PasswordResetRow currentUser={currentUser} />;

    case "emailVerification":
      return <EmailVerificationRow currentUser={currentUser} />;

    case "pending":
    default:
      return (
        <PendingRow
          label={row.label}
          description={row.description}
          action={row.action}
          reason={row.reason}
        />
      );
  }
}

/** Los campos de identidad se editan en el perfil, que ya tiene su formulario. */
function ProfileLinkRow({ currentUser }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-label-lg font-semibold text-th-fg-strong">
          {currentUser.name} · @{currentUser.username}
        </span>
        <p className="text-body-sm text-th-fg-muted">
          Nombre y usuario se guardan en el servidor. Biografía, ubicación, enlace y portada se
          guardan en este navegador.
        </p>
      </div>
      <Link
        to="/profile"
        className="min-h-[44px] shrink-0 rounded-th-input bg-th-brand px-4 py-2.5 text-label-lg font-bold text-th-on-brand transition-colors th-focus-ring hover:bg-th-brand-hover"
      >
        Editar perfil
      </Link>
    </div>
  );
}

/** POST /api/forgot-password — flujo real (ADR-009). */
function PasswordResetRow({ currentUser }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);

  async function handleRequest() {
    setLoading(true);
    try {
      await api.post("/forgot-password", { email: currentUser.email });
      // Mismo flujo que /forgot-password (ADR-010): el código de 6 dígitos se
      // ingresa en /verify-reset-code, que recibe el correo por router state
      // (no por la URL).
      navigate("/verify-reset-code", { state: { email: currentUser.email } });
    } catch (error) {
      toast.error(getErrorMessage(error, t));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ActionRow
      label="Cambiar contraseña"
      description="Te enviamos un código de 6 dígitos a la dirección de tu cuenta."
      action="Enviar código"
      onAction={handleRequest}
      loading={loading}
      variant="primary"
    />
  );
}

/**
 * Estado de verificación del correo (`email_verified` real de la sesión).
 *
 * Solo informa. `POST /api/send-verification-email` se retiró en ADR-011: desde
 * entonces la verificación es obligatoria al registrarse (código OTP) y una
 * cuenta sin verificar no puede iniciar sesión, así que quien ve esta pantalla
 * ya tiene el correo verificado. El botón "Enviar verificación" que había acá
 * llamaba a una ruta que ya no existe (404).
 */
function EmailVerificationRow({ currentUser }) {
  if (currentUser.email_verified) {
    return (
      <InfoRow
        label="Correo verificado"
        description="Tu dirección ya está confirmada."
        value="Verificado"
      />
    );
  }

  return (
    <InfoRow
      label="Correo sin verificar"
      description="Tu dirección todavía no está confirmada."
      value="Pendiente"
    />
  );
}
