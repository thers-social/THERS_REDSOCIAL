import { Switch, Text, View } from 'react-native';

import { AudienceChoice } from '@features/settings/AudienceChoice';
import { usePrivacySettings } from '@features/settings/usePrivacySettings';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { Banner } from '@shared/ui/Banner';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Privacidad (`GET`/`PATCH /api/users/me/privacy`, `ADR-022`/`023`/`024`). Cada
 * cambio se aplica en el SERVIDOR: si falla, el control vuelve a su valor real.
 */
export default function Privacy() {
  const { t } = useLanguage();
  const { settings, error, saving, load, update } = usePrivacySettings();

  return (
    <Screen title={t('privacy.title')} back>
      {error && settings ? <Banner tone="error">{error}</Banner> : null}

      {!settings ? (
        error ? (
          <StateMessage
            kind="error"
            title={t('privacy.error.loadTitle')}
            message={error}
            actionLabel={t('common.retry')}
            onAction={load}
          />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : (
        <>
          <SwitchRow
            label={t('privacy.private')}
            description={t('privacy.private.desc')}
            value={settings.is_private}
            disabled={saving}
            onChange={(value) => update({ is_private: value })}
          />
          <SwitchRow
            label={t('privacy.activity')}
            description={t('privacy.activity.desc')}
            value={settings.show_activity_status}
            disabled={saving}
            onChange={(value) => update({ show_activity_status: value })}
          />
          <SwitchRow
            label={t('privacy.sensitive')}
            description={t('privacy.sensitive.desc')}
            value={settings.hide_sensitive_content}
            disabled={saving}
            onChange={(value) => update({ hide_sensitive_content: value })}
          />
          <SwitchRow
            label={t('privacy.offensive')}
            description={t('privacy.offensive.desc')}
            value={settings.hide_offensive_comments}
            disabled={saving}
            onChange={(value) => update({ hide_offensive_comments: value })}
          />

          <AudienceChoice
            title={t('privacy.whoMessage')}
            value={settings.who_can_message}
            disabled={saving}
            onChange={(value) => update({ who_can_message: value })}
          />
          <AudienceChoice
            title={t('privacy.whoMention')}
            value={settings.who_can_mention}
            disabled={saving}
            onChange={(value) => update({ who_can_mention: value })}
          />
        </>
      )}
    </Screen>
  );
}

function SwitchRow({
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.brand, false: colors.borderStrong }}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[4],
    marginBottom: space[3],
    gap: space[3],
  },
  rowText: { flex: 1 },
  label: { fontSize: fontSize.bodyLg, fontWeight: '600', color: colors.fg },
  description: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2, lineHeight: 18 },
}));
