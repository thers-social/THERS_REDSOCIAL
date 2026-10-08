import { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { fetchPrivacy, patchPrivacy } from '@features/settings/api';
import type { Audience, PrivacyPatch, PrivacySettings } from '@features/settings/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Banner } from '@shared/ui/Banner';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'everyone', label: 'Todas las personas' },
  { id: 'followers', label: 'Solo quienes me siguen' },
  { id: 'nobody', label: 'Nadie' },
];

/**
 * Privacidad (`GET`/`PATCH /api/users/me/privacy`, `ADR-022`/`023`/`024`). Cada
 * cambio se aplica en el SERVIDOR: si falla, el control vuelve a su valor real.
 */
export default function Privacy() {
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await fetchPrivacy());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cargar tu privacidad.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(patch: PrivacyPatch) {
    if (!settings || saving) return;
    setSaving(true);
    setError(null);
    const previous = settings;
    setSettings({ ...settings, ...patch });
    try {
      setSettings(await patchPrivacy(patch));
    } catch (e) {
      setSettings(previous);
      setError(e instanceof ApiError ? e.message : 'No pudimos guardar el cambio.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title="Privacidad" back>
      {error && settings ? <Banner tone="error">{error}</Banner> : null}

      {!settings ? (
        error ? (
          <StateMessage kind="error" title="No pudimos cargar tu privacidad" message={error} actionLabel="Reintentar" onAction={load} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : (
        <>
          <SwitchRow
            label="Cuenta privada"
            description="Solo quienes aprobaste ven tus publicaciones. Las demás personas deben solicitar seguirte."
            value={settings.is_private}
            disabled={saving}
            onChange={(value) => update({ is_private: value })}
          />
          <SwitchRow
            label="Mostrar mi actividad"
            description="Otras personas pueden ver cuándo estuviste conectado por última vez."
            value={settings.show_activity_status}
            disabled={saving}
            onChange={(value) => update({ show_activity_status: value })}
          />
          <SwitchRow
            label="Ocultar contenido sensible"
            description="No muestra las publicaciones que sus autores marcaron como sensibles."
            value={settings.hide_sensitive_content}
            disabled={saving}
            onChange={(value) => update({ hide_sensitive_content: value })}
          />
          <SwitchRow
            label="Ocultar comentarios ofensivos"
            description="Filtra comentarios con lenguaje ofensivo."
            value={settings.hide_offensive_comments}
            disabled={saving}
            onChange={(value) => update({ hide_offensive_comments: value })}
          />

          <ChoiceGroup
            title="Quién puede escribirme"
            value={settings.who_can_message}
            disabled={saving}
            onChange={(value) => update({ who_can_message: value })}
          />
          <ChoiceGroup
            title="Quién puede mencionarme"
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

function ChoiceGroup({
  title,
  value,
  disabled,
  onChange,
}: {
  title: string;
  value: Audience;
  disabled: boolean;
  onChange: (value: Audience) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{title}</Text>
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
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
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
  group: { marginTop: space[3], marginBottom: space[2] },
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
