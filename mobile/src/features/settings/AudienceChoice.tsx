import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { useLanguage } from '@shared/i18n';
import type { MessageKey } from '@shared/i18n';

import type { Audience } from './api';

const AUDIENCES: { id: Audience; label: MessageKey }[] = [
  { id: 'everyone', label: 'settings.audience.everyone' },
  { id: 'followers', label: 'settings.audience.followers' },
  { id: 'nobody', label: 'settings.audience.nobody' },
];

/** «Todas las personas / Solo quienes me siguen / Nadie»: lo usan Privacidad y Menciones. */
export function AudienceChoice({
  title,
  description,
  value,
  disabled,
  onChange,
}: {
  title: string;
  description?: string;
  value: Audience;
  disabled: boolean;
  onChange: (value: Audience) => void;
}) {
  const { t } = useLanguage();
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {AUDIENCES.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            disabled={disabled}
            onPress={() => !selected && onChange(option.id)}
            style={[styles.choice, selected && styles.choiceSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
          >
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{t(option.label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
  group: { marginTop: space[3], marginBottom: space[2] },
  label: { fontSize: fontSize.bodyLg, fontWeight: '600', color: colors.fg },
  description: { fontSize: fontSize.bodySm, color: colors.fgMuted, marginTop: 2, lineHeight: 18 },
  choice: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    marginTop: space[2],
  },
  choiceSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  choiceText: { fontSize: fontSize.bodyMd, color: colors.fg },
  choiceTextSelected: { color: colors.brandText, fontWeight: '700' },
}));
