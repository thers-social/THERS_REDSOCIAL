import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { addMutedKeyword, fetchMutedKeywords, removeMutedKeyword } from '@features/settings/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';
import { TextField } from '@shared/ui/TextField';

/**
 * Palabras silenciadas (`ADR-024`): el servidor deja de mostrarte en el inicio las
 * publicaciones que las contienen. Tus propias publicaciones nunca se ocultan.
 */
export default function Muted() {
  const [words, setWords] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setWords(await fetchMutedKeywords());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cargar tus palabras silenciadas.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const word = draft.trim();
    if (!word || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addMutedKeyword(word);
      setDraft('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos añadir la palabra.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(word: string) {
    try {
      await removeMutedKeyword(word);
      setWords((current) => current?.filter((w) => w !== word) ?? current);
    } catch (e) {
      Alert.alert('No se pudo quitar', e instanceof ApiError ? e.message : 'Inténtalo de nuevo.');
    }
  }

  return (
    <Screen title="Palabras silenciadas" back>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <TextField
        label="Silenciar una palabra"
        hint="No distingue mayúsculas ni tildes."
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onSubmitEditing={add}
      />
      <Button label="Añadir" variant="secondary" onPress={add} loading={busy} disabled={!draft.trim()} />

      <Text style={styles.title}>Tus palabras</Text>
      {words === null ? (
        error ? null : <StateMessage kind="loading" />
      ) : words.length === 0 ? (
        <StateMessage kind="empty" message="No has silenciado ninguna palabra." />
      ) : (
        <View style={styles.chips}>
          {words.map((word) => (
            <Pressable
              key={word}
              onPress={() => remove(word)}
              style={styles.chip}
              accessibilityRole="button"
              accessibilityLabel={`Quitar ${word}`}
            >
              <Text style={styles.chipText}>{word}  ✕</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginTop: space[6], marginBottom: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandSoftStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  chipText: { fontSize: fontSize.bodySm, color: colors.brandText, fontWeight: '600' },
}));
