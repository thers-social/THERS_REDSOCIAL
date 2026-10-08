import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { fetchBlocks, unblockUser } from '@features/safety/api';
import type { BlockedAccount } from '@features/safety/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError, request } from '@shared/lib/api';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';
import { TextField } from '@shared/ui/TextField';

/**
 * Cuentas bloqueadas (`ADR-029`): lista, desbloquear y bloquear por @usuario. Un
 * bloqueo es en los dos sentidos: ninguna de las dos cuentas ve a la otra ni puede
 * escribirle.
 */
export default function Blocked() {
  const { user } = useAuth();
  const [items, setItems] = useState<BlockedAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchBlocks());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos cargar tus bloqueos.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const name = username.trim().replace(/^@/, '');
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      // El servidor admite bloquear por @usuario (`POST /users/me/blocks`).
      await request('/users/me/blocks', {
        method: 'POST',
        authenticated: true,
        body: { username: name },
      });
      setUsername('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos bloquear esa cuenta.');
    } finally {
      setBusy(false);
    }
  }

  function confirmUnblock(account: BlockedAccount) {
    Alert.alert(`¿Desbloquear a @${account.user.username}?`, 'Podrá volver a ver tu perfil y escribirte.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desbloquear',
        onPress: async () => {
          try {
            await unblockUser(account.user.id);
            setItems((current) => current?.filter((b) => b.user.id !== account.user.id) ?? current);
          } catch (e) {
            Alert.alert('No se pudo desbloquear', e instanceof ApiError ? e.message : 'Inténtalo de nuevo.');
          }
        },
      },
    ]);
  }

  if (!user) return null;

  return (
    <Screen title="Cuentas bloqueadas" back>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <TextField
        label="Bloquear una cuenta"
        hint="Escribe su @usuario."
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />
      <Button label="Bloquear" variant="secondary" onPress={add} loading={busy} disabled={!username.trim()} />

      <Text style={styles.title}>Bloqueadas</Text>
      {items === null ? (
        error ? (
          <StateMessage kind="error" message={error} actionLabel="Reintentar" onAction={load} />
        ) : (
          <StateMessage kind="loading" />
        )
      ) : items.length === 0 ? (
        <StateMessage kind="empty" message="No has bloqueado a nadie." />
      ) : (
        items.map((account) => (
          <View key={account.user.id} style={styles.row}>
            <Avatar name={account.user.name} size={40} />
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>
                {account.user.name}
              </Text>
              <Text style={styles.username}>@{account.user.username}</Text>
            </View>
            <Button label="Desbloquear" variant="secondary" onPress={() => confirmUnblock(account)} />
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg, marginTop: space[6], marginBottom: space[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[3],
    marginBottom: space[2],
    gap: space[3],
  },
  rowText: { flex: 1 },
  name: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  username: { fontSize: fontSize.labelMd, color: colors.fgMuted },
}));
