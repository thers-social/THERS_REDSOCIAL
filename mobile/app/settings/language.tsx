import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { LANGUAGES, useLanguage } from '@shared/i18n';
import { Icon } from '@shared/ui/Icon';
import { Screen } from '@shared/ui/Screen';

/**
 * Idioma de la app. Se guarda en el teléfono (no en la cuenta, para que también valga en la pantalla de
 * acceso) y se aplica al instante. Cada idioma se escribe en su propio idioma, para que se reconozca
 * aunque la app esté en otro.
 */
export default function LanguageScreen() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <Screen title={t('language.title')} back>
      <Text style={styles.intro}>{t('language.intro')}</Text>
      <View style={styles.group} accessibilityRole="radiogroup">
        {LANGUAGES.map((option) => {
          const selected = option.id === language;
          return (
            <Pressable
              key={option.id}
              onPress={() => !selected && setLanguage(option.id)}
              style={[styles.choice, selected && styles.choiceSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
              {selected ? <Icon name="check" size={20} color={colors.brandText} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  intro: { fontSize: fontSize.bodyMd, color: colors.fgSecondary, marginBottom: space[3], lineHeight: 20 },
  group: { gap: space[2] },
  choice: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
  },
  choiceSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  choiceText: { fontSize: fontSize.bodyLg, color: colors.fg },
  choiceTextSelected: { color: colors.brandText, fontWeight: '700' },
}));
