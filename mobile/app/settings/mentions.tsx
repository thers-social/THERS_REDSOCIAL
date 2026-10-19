import { Text } from 'react-native';

import { AudienceChoice } from '@features/settings/AudienceChoice';
import { usePrivacySettings } from '@features/settings/usePrivacySettings';
import { colors, fontSize, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import { Banner } from '@shared/ui/Banner';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Menciones: quién puede mencionarte con `@usuario` en una publicación o un comentario
 * (`ADR-023`). Lo decide y lo aplica el SERVIDOR (`who_can_mention`): a quien no está autorizado le
 * queda como texto plano y a ti no te llega ningún aviso. La misma opción está en la web, en
 * Configuración → Privacidad.
 */
export default function Mentions() {
  const { t } = useLanguage();
  const { settings, error, saving, load, update } = usePrivacySettings();

  return (
    <Screen title={t('mentions.title')} back>
      <Text style={styles.intro}>{t('mentions.intro')}</Text>
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
        <AudienceChoice
          title={t('mentions.who')}
          description={t('mentions.who.desc')}
          value={settings.who_can_mention}
          disabled={saving}
          onChange={(value) => update({ who_can_mention: value })}
        />
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  intro: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginBottom: space[3], lineHeight: 20 },
}));
