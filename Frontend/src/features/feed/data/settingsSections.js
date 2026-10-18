/**
 * Contenido de las secciones de Configuración que SÍ funcionan.
 *
 * Solo quedan controles con efecto real. Por pedido del propietario se retiraron
 * las secciones Suscripción, Herramientas (radar), Notificaciones, Audio y
 * Permisos (sus filas eran `pending`, sin servicio detrás, o preferencias locales
 * que nada leía), y las filas `pending` de Privacidad y Enlaces. Si una función
 * llega a existir, se vuelve a añadir su sección aquí y en `SETTINGS_SECTIONS`
 * (app/layout/thers/navigation.js).
 *
 * Los títulos de sección y de grupo vienen de las referencias REF-SET-xx; las
 * descripciones son textos reales que explican lo que hace el control.
 *
 * Tipos de fila (ver components/settings/SettingsPrimitives.jsx):
 *   switch  — preferencia booleana, se guarda en este navegador (solo si algo la lee)
 *   info    — dato real de solo lectura
 *   el resto — controles con efecto en el SERVIDOR (ADR-022..ADR-030)
 *
 * REGLA APLICADA: nada que dependa de una decisión de servidor se modela como
 * preferencia local, porque guardar un booleano en el navegador no protege
 * ningún dato (archivo maestro §8.10 y §10.2).
 */

export const SETTINGS_CONTENT = {
  // REF-SET-01
  profile: {
    title: "Editar perfil",
    description:
      "Tu identidad pública en THERS. Nombre y usuario se guardan en el servidor; el resto del perfil extendido vive en este navegador.",
    groups: [
      {
        title: "Identidad",
        description: "Los únicos campos que el backend persiste hoy (ADR-003).",
        rows: [{ type: "profileLink" }],
      },
    ],
  },

  // REF-SET-02
  privacy: {
    title: "Privacidad de la cuenta",
    description:
      "Gestiona la exposición de tu identidad en THERS, define quién puede interactuar con tus resonancias y mantén el control de tu visibilidad.",
    notice: {
      tone: "info",
      text: "Estos controles SÍ se aplican en el servidor (ADR-022, ADR-023, ADR-024): filtran cada consulta, deciden permisos y ocultan datos. No son preferencias de este navegador.",
    },
    groups: [
      {
        title: "Cuenta privada",
        rows: [
          {
            type: "privacySwitch",
            key: "is_private",
            label: "Cuenta privada",
            description:
              "Solo los usuarios aprobados pueden ver tus cápsulas. Quien ya te seguía lo sigue haciendo; a partir de ahora, cada persona nueva tiene que pedirlo y aprobarlo vos.",
          },
          { type: "followRequests" },
        ],
      },
      {
        title: "Interacciones",
        description: "Quién puede conectar y amplificar tu contenido.",
        index: "Sección 01",
        rows: [
          {
            type: "privacyChoice",
            key: "who_can_mention",
            label: "Menciones y etiquetas",
            description:
              "Qué usuarios pueden etiquetarte escribiendo @tu_usuario en una cápsula o un comentario. Si no están autorizados, el texto queda como texto plano y no te llega ninguna notificación.",
            options: [
              { value: "everyone", label: "Cualquiera" },
              { value: "followers", label: "Solo mis seguidores" },
              { value: "nobody", label: "Nadie" },
            ],
          },
          {
            type: "privacySwitch",
            key: "hide_offensive_comments",
            label: "Ocultar comentarios ofensivos",
            description:
              "Filtra automáticamente los comentarios con insultos o spam evidente en TUS cápsulas, para todo el que las lea. Usa una lista de términos del sistema, revisable por el equipo — no hay moderación humana ni revisión caso por caso.",
          },
          { type: "mutedKeywords" },
          {
            type: "privacyChoice",
            key: "who_can_message",
            label: "Mensajes directos",
            description:
              "Quién puede escribirte por mensaje directo. A quien no esté autorizado le aparece un aviso al intentar enviarte algo; los mensajes que ya recibiste no se borran.",
            options: [
              { value: "everyone", label: "Cualquiera" },
              { value: "followers", label: "Solo mis seguidores" },
              { value: "nobody", label: "Nadie" },
            ],
          },
        ],
      },
      {
        title: "Conexiones y visibilidad",
        description: "Tu presencia en THERS.",
        index: "Sección 02",
        rows: [
          {
            type: "privacySwitch",
            key: "show_activity_status",
            label: "Mostrar mi estado de actividad",
            description:
              "Deja ver la última vez que estuviste activo a las personas con las que tenés una conversación. Si lo apagas, para ellas se ve igual que si nunca hubieras estado activo — no se nota que lo desactivaste.",
          },
        ],
      },
    ],
  },

  // REF-SET-03
  security: {
    title: "Seguridad y contraseña",
    description: "Credenciales de acceso, verificación en dos pasos y control de sesiones.",
    notice: {
      tone: "info",
      text: "Todos los controles de esta pantalla se aplican en el servidor. La verificación en dos pasos usa una app autenticadora (TOTP, ADR-026); las sesiones se registran por dispositivo y cerrarlas invalida su token de inmediato (ADR-025).",
    },
    groups: [
      {
        title: "Cambiar contraseña",
        description: "El flujo de recuperación por correo sí está implementado (ADR-009).",
        rows: [{ type: "passwordReset" }],
      },
      {
        title: "Verificación de correo",
        rows: [{ type: "emailVerification" }],
      },
      {
        title: "Autenticación en dos pasos (2FA)",
        rows: [{ type: "twoFactor" }],
      },
      {
        title: "Sesiones activas",
        rows: [{ type: "activeSessions" }],
      },
      {
        title: "Eliminar cuenta",
        description:
          "Elimina tu cuenta y sus datos de forma definitiva. Te pedimos un código por correo y varias confirmaciones.",
        rows: [{ type: "deleteAccount" }],
      },
      {
        title: "Alertas de inicio de sesión",
        rows: [
          {
            type: "securitySwitch",
            key: "login_alerts_enabled",
            label: "Avisarme de accesos nuevos",
            description:
              "Te mandamos un correo cuando alguien entre a tu cuenta desde un dispositivo que no habíamos visto antes. No se avisa en cada inicio de sesión: solo con dispositivos nuevos, para que el aviso signifique algo.",
          },
        ],
      },
    ],
  },

  // REF-SET-08
  links: {
    title: "Enlaces",
    description: "Tu enlace principal.",
    notice: {
      tone: "info",
      text: "Un enlace público no es una cuenta conectada: lo que se guarda aquí es texto.",
    },
    groups: [
      {
        title: "Enlace Principal de Perfil (Bio Link)",
        description: "Se edita desde «Editar perfil» y se muestra en tu perfil público.",
        rows: [{ type: "profileLink" }],
      },
    ],
  },

  // REF-SET-09
  data: {
    title: "Descarga de datos y archivo",
    description: "Solicita una copia de tu información y consulta el historial de descargas.",
    notice: {
      tone: "info",
      text: "Esta función SÍ se aplica en el servidor (ADR-028): el archivo es un ZIP real con los datos de tu cuenta, generado al momento de pedirlo.",
    },
    groups: [
      {
        title: "Solicitar descarga de información",
        rows: [{ type: "dataExportRequest" }],
      },
      {
        title: "Archivos listos para descargar (Historial)",
        rows: [{ type: "dataExportHistory" }],
      },
      {
        title: "Privacidad y seguridad de tu archivo",
        rows: [
          {
            type: "info",
            label: "Caducidad del enlace",
            description:
              "Pasado ese plazo el archivo se elimina del servidor y hay que pedir uno nuevo.",
            value: "7 días",
          },
          {
            type: "info",
            label: "Quién puede descargarlo",
            description:
              "Solo tu cuenta, con la sesión iniciada. El enlace no sirve sin tu sesión ni para otra persona.",
            value: "Solo tú",
          },
          {
            type: "info",
            label: "Cifrado del paquete",
            description:
              "El ZIP no está cifrado ni protegido con contraseña: guárdalo en un lugar seguro. No incluye tu contraseña ni el secreto de tu verificación en dos pasos.",
            value: "Sin cifrar",
          },
        ],
      },
    ],
  },

  // REF-SET-10
  blocked: {
    title: "Cuentas bloqueadas y restringidas",
    description: "Bloquear y restringir son dos cosas distintas y se listan por separado.",
    notice: {
      tone: "info",
      text: "Estos controles SÍ se aplican en el servidor (ADR-029): el bloqueo corta el acceso a tu contenido en cada consulta, no solo en la interfaz. También puedes bloquear o restringir desde el menú de cualquier publicación.",
    },
    groups: [
      {
        title: "¿Qué ocurre al bloquear a alguien?",
        rows: [{ type: "restrictedAccounts", kind: "block" }],
      },
      {
        title: "Protección sutil con Cuentas Restringidas",
        rows: [{ type: "restrictedAccounts", kind: "restrict" }],
      },
    ],
  },

  // REF-SET-12
  content: {
    title: "Preferencias de contenido y feed",
    description: "Qué ves en tu feed y qué prefieres no ver.",
    notice: {
      tone: "info",
      text: "Estos filtros SÍ se aplican en el servidor (ADR-024, ADR-030): `GET /api/posts` ya no devuelve lo que ocultaste, no se esconde solo en la interfaz.",
    },
    groups: [
      {
        title: "Control de contenido sensible",
        rows: [
          {
            type: "privacySwitch",
            key: "hide_sensitive_content",
            label: "Filtrar contenido sensible",
            description:
              "Oculta de tu feed las publicaciones que su autor marcó como sensibles al publicar. Es lo que declara quien escribe, no una clasificación automática. Tus propias publicaciones nunca se ocultan.",
          },
        ],
      },
      {
        title: "Palabras y frases ocultas",
        rows: [{ type: "mutedKeywords" }],
      },
      {
        title: "Temas y etiquetas silenciadas",
        rows: [{ type: "mutedTopics" }],
      },
      {
        title: "Cuentas sugeridas en el feed",
        rows: [
          {
            type: "switch",
            key: "content.suggestions",
            label: "Mostrar cuentas sugeridas",
            description:
              "Muestra u oculta el panel «Personas que resuenan» del feed, que sugiere cuentas reales que todavía no sigues. Es una preferencia de pantalla y se guarda en este navegador.",
            default: true,
          },
        ],
      },
    ],
  },
};
