import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { TERO_ENABLED } from '@features/tero/config';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import type { MessageKey } from '@shared/i18n';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import type { IconName } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';

/**
 * Cada fila lleva a una pantalla REAL conectada al servidor (o a una preferencia del teléfono, como
 * Idioma y Tero). Lo que no funciona no se muestra: no hay filas «Próximamente».
 */
type Row = {
  label: MessageKey;
  description: MessageKey;
  icon: IconName;
  route: string;
  danger?: boolean;
};

const SECTIONS: { title: MessageKey; rows: Row[] }[] = [
  {
    title: 'settings.section.usage',
    rows: [
      { label: 'settings.row.saved', description: 'settings.row.saved.desc', icon: 'bookmark', route: '/settings/saved' },
    ],
  },
  {
    title: 'settings.section.visibility',
    rows: [
      { label: 'settings.row.privacy', description: 'settings.row.privacy.desc', icon: 'lock', route: '/settings/privacy' },
      {
        label: 'settings.row.requests',
        description: 'settings.row.requests.desc',
        icon: 'userAdd',
        route: '/settings/follow-requests',
      },
      {
        label: 'settings.row.closeFriends',
        description: 'settings.row.closeFriends.desc',
        icon: 'star',
        route: '/settings/close-friends',
      },
      { label: 'settings.row.blocked', description: 'settings.row.blocked.desc', icon: 'block', route: '/settings/blocked' },
    ],
  },
  {
    title: 'settings.section.interactions',
    rows: [
      { label: 'settings.row.muted', description: 'settings.row.muted.desc', icon: 'filter', route: '/settings/muted' },
      { label: 'settings.row.mentions', description: 'settings.row.mentions.desc', icon: 'at', route: '/settings/mentions' },
    ],
  },
  {
    title: 'settings.section.app',
    rows: [
      { label: 'settings.row.language', description: 'settings.row.language.desc', icon: 'globe', route: '/settings/language' },
      // Las preferencias de Tero son locales del teléfono. Esta fila es la vuelta para quien ocultó la burbuja.
      ...(TERO_ENABLED
        ? [{ label: 'settings.row.tero' as const, description: 'settings.row.tero.desc' as const, icon: 'sparkle' as const, route: '/tero/settings' }]
        : []),
    ],
  },
  {
    title: 'settings.section.security',
    rows: [
      {
        label: 'settings.row.sessions',
        description: 'settings.row.sessions.desc',
        icon: 'devices',
        route: '/settings/sessions',
      },
      {
        label: 'settings.row.deleteAccount',
        description: 'settings.row.deleteAccount.desc',
        icon: 'trash',
        route: '/delete-account',
        danger: true,
      },
    ],
  },
];

/** Ajustes. Las filas con servidor leen y escriben allí; Idioma y Tero se guardan en el teléfono. */
export default function Settings() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      rows: section.rows.filter(
        (row) => t(row.label).toLowerCase().includes(q) || t(row.description).toLowerCase().includes(q),
      ),
    })).filter((section) => section.rows.length > 0);
  }, [query, t]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <Screen title={t('settings.title')} back>
      <View style={styles.search}>
        <Icon name="search" size={18} color={colors.fgMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('settings.search.placeholder')}
          placeholderTextColor={colors.fgDisabled}
          accessibilityLabel={t('settings.search.label')}
          autoCorrect={false}
        />
      </View>

      {!query.trim() && user ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.account.title')}</Text>
          <Pressable
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.account, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('settings.account.view')}
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
          <Text style={styles.sectionTitle}>{t(section.title)}</Text>
          <View style={styles.card}>
            {section.rows.map((row, index) => (
              <Pressable
                key={row.label}
                onPress={() => router.push(row.route as never)}
                style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityHint={t(row.description)}
              >
                <View style={styles.tile}>
                  <Icon name={row.icon} size={20} color={row.danger ? colors.dangerFg : colors.fgSecondary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.label, row.danger && styles.danger]}>{t(row.label)}</Text>
                  <Text style={styles.description} numberOfLines={2}>
                    {t(row.description)}
                  </Text>
                </View>
                <Icon name="chevron" size={18} color={colors.fgDisabled} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {sections.length === 0 ? <Text style={styles.empty}>{t('settings.empty', { query: query.trim() })}</Text> : null}

      {!query.trim() ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.section.session')}</Text>
          <View style={styles.card}>
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
            >
              <View style={styles.tile}>
                <Icon name="logout" size={20} color={colors.dangerFg} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.label, styles.danger]}>
                  {user ? t('settings.logout.as', { username: user.username }) : t('settings.logout')}
                </Text>
                <Text style={styles.description}>{t('settings.logout.desc')}</Text>
              </View>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.footer}>{t('settings.footer')}</Text>
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
  danger: { color: colors.dangerFg },
  description: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2, lineHeight: 18 },
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
