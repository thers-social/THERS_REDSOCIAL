import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { TERO_ENABLED } from '@features/tero/config';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { comingSoon } from '@shared/lib/comingSoon';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import type { IconName } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';

/**
 * `route`: pantalla real conectada al servidor. Sin `route`: el diseño aprobado
 * la muestra pero el backend aún no la soporta, así que avisa «Próximamente».
 */
type Row = {
  label: string;
  description: string;
  icon: IconName;
  route?: string;
  danger?: boolean;
};

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'Cómo usas THERS',
    rows: [
      { label: 'Guardado', description: 'Colecciones de publicaciones.', icon: 'bookmark' },
      { label: 'Archivo', description: 'Historias pasadas y publicaciones archivadas.', icon: 'archive' },
      { label: 'Tu actividad', description: 'Tiempo en la app e interacciones.', icon: 'activity' },
      { label: 'Notificaciones', description: 'Push, correo y frecuencia.', icon: 'bell' },
      { label: 'Administración del tiempo', description: 'Recordatorios de descanso y límites.', icon: 'clock' },
    ],
  },
  {
    title: 'Quién puede ver tu contenido',
    rows: [
      {
        label: 'Privacidad de la cuenta',
        description: 'Cuenta privada, quién puede escribirte y mencionarte, contenido sensible.',
        icon: 'lock',
        route: '/settings/privacy',
      },
      {
        label: 'Solicitudes de seguimiento',
        description: 'Aprueba o rechaza quién quiere seguirte (cuentas privadas).',
        icon: 'userAdd',
        route: '/settings/follow-requests',
      },
      { label: 'Mejores amigos', description: 'Círculo privado para tus publicaciones.', icon: 'star' },
      {
        label: 'Bloqueados',
        description: 'Revisa a quién bloqueaste y desbloquea.',
        icon: 'block',
        route: '/settings/blocked',
      },
    ],
  },
  {
    title: 'Interacciones',
    rows: [
      {
        label: 'Palabras ocultas y filtros',
        description: 'Oculta del inicio las publicaciones con ciertas palabras.',
        icon: 'filter',
        route: '/settings/muted',
      },
      { label: 'Etiquetas y menciones', description: 'Aprobación manual y quién puede etiquetarte.', icon: 'at' },
      { label: 'Comentarios', description: 'Control de filtros y restricción de ofensas.', icon: 'comment' },
    ],
  },
  {
    title: 'Tu app y contenido multimedia',
    rows: [
      { label: 'Permisos de cámara y micro', description: 'Acceso a galería, audio y sensores.', icon: 'camera' },
      { label: 'Idioma y traducciones', description: 'Idioma de la app y traducción automática.', icon: 'globe' },
      // Excepción a la regla de abajo: las preferencias de Tero son locales del
      // teléfono. Esta fila es la vuelta para quien ocultó la burbuja.
      ...(TERO_ENABLED
        ? [
            {
              label: 'Tero',
              description: 'Mostrar, mover u ocultar a Tero (vista previa).',
              icon: 'sparkle' as const,
              route: '/tero/settings',
            },
          ]
        : []),
    ],
  },
  {
    title: 'Seguridad',
    rows: [
      {
        label: 'Sesiones activas',
        description: 'Dispositivos con tu cuenta abierta. Cierra los que no reconozcas.',
        icon: 'devices',
        route: '/settings/sessions',
      },
      {
        label: 'Eliminar cuenta',
        description: 'Elimina tu cuenta y sus datos de forma definitiva.',
        icon: 'trash',
        route: '/delete-account',
        danger: true,
      },
    ],
  },
];

/**
 * Ajustes. Las filas con ruta leen y escriben en el SERVIDOR (no son preferencias
 * guardadas solo en el teléfono); las demás muestran «Próximamente».
 */
export default function Settings() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      rows: section.rows.filter(
        (row) => row.label.toLowerCase().includes(q) || row.description.toLowerCase().includes(q),
      ),
    })).filter((section) => section.rows.length > 0);
  }, [query]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <Screen title="Configuración y privacidad" back>
      <View style={styles.search}>
        <Icon name="search" size={18} color={colors.fgMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar ajustes o funciones…"
          placeholderTextColor={colors.fgDisabled}
          accessibilityLabel="Buscar ajustes"
          autoCorrect={false}
        />
      </View>

      {!query.trim() && user ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tu cuenta</Text>
          <Pressable
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.account, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Ver tu perfil"
          >
            <Avatar name={user.name} uri={user.avatar_url} size={48} />
            <View style={styles.rowText}>
              <Text style={styles.label}>{user.name}</Text>
              <Text style={styles.description}>@{user.username}</Text>
            </View>
            <Icon name="chevron" size={20} color={colors.fgDisabled} />
          </Pressable>
        </View>
      ) : null}

      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.card}>
            {section.rows.map((row, index) => (
              <Pressable
                key={row.label}
                onPress={() => (row.route ? router.push(row.route as never) : comingSoon(row.label))}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.rowBorder,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                accessibilityHint={row.route ? row.description : 'Próximamente'}
              >
                <View style={styles.tile}>
                  <Icon name={row.icon} size={20} color={row.danger ? colors.dangerFg : colors.fgSecondary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.label, row.danger && styles.danger]}>{row.label}</Text>
                  <Text style={styles.description} numberOfLines={2}>
                    {row.description}
                  </Text>
                </View>
                {row.route ? null : <Text style={styles.soon}>Próximamente</Text>}
                <Icon name="chevron" size={18} color={colors.fgDisabled} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {sections.length === 0 ? <Text style={styles.empty}>Sin resultados para «{query.trim()}».</Text> : null}

      {!query.trim() ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sesión</Text>
          <View style={styles.card}>
            <Pressable
              onPress={() => comingSoon('Agregar otra cuenta')}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityHint="Próximamente"
            >
              <View style={styles.tile}>
                <Icon name="userAdd" size={20} color={colors.fgSecondary} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.label, styles.accent]}>Agregar cuenta existente o nueva</Text>
              </View>
              <Text style={styles.soon}>Próximamente</Text>
            </Pressable>
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [styles.row, styles.rowBorder, pressed && styles.rowPressed]}
              accessibilityRole="button"
            >
              <View style={styles.tile}>
                <Icon name="logout" size={20} color={colors.dangerFg} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.label, styles.danger]}>
                  Cerrar sesión{user ? ` en @${user.username}` : ''}
                </Text>
                <Text style={styles.description}>Termina la sesión en este dispositivo.</Text>
              </View>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.footer}>
        Cambiar la contraseña, la verificación en dos pasos, descargar tus datos y la foto de perfil
        se hacen por ahora desde la web de THERS.
      </Text>
      <Text style={styles.brand}>THERS</Text>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    paddingHorizontal: space[3],
    marginBottom: space[4],
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: fontSize.bodyMd, color: colors.fg, padding: 0 },
  section: { marginBottom: space[6] },
  sectionTitle: {
    fontSize: fontSize.labelMd,
    fontWeight: '700',
    color: colors.fgMuted,
    textTransform: 'uppercase',
    marginBottom: space[2],
    marginLeft: space[1],
  },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[4],
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], minHeight: 64 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  rowPressed: { backgroundColor: colors.bgSubtle },
  tile: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  label: { fontSize: fontSize.bodyLg, fontWeight: '600', color: colors.fg },
  accent: { color: colors.brandText },
  danger: { color: colors.dangerFg },
  description: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2, lineHeight: 18 },
  soon: {
    fontSize: fontSize.labelSm,
    fontWeight: '700',
    color: colors.brandText,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.xs,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
  empty: { fontSize: fontSize.bodySm, color: colors.fgMuted, textAlign: 'center', marginVertical: space[6] },
  footer: { fontSize: fontSize.labelMd, color: colors.fgMuted, lineHeight: 17, marginTop: space[2] },
  brand: {
    fontSize: fontSize.bodyLg,
    fontWeight: '700',
    color: colors.fgDisabled,
    textAlign: 'center',
    marginTop: space[6],
  },
}));
