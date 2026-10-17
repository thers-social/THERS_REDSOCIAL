import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Switch, Text, View } from 'react-native';

import { loadAlertsEnabled, saveAlertsEnabled } from '@features/notifications/alertPrefs';
import { getPermission, openAppSettings, requestPermission } from '@features/permissions/permissions';
import {
  PERMISSION_COPY,
  actionFor,
  actionLabel,
  stateLabel,
} from '@features/permissions/permissionState';
import type { PermissionKind, PermissionSnapshot } from '@features/permissions/permissionState';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Banner } from '@shared/ui/Banner';
import { Screen } from '@shared/ui/Screen';

const KINDS: PermissionKind[] = ['notifications', 'location'];

/**
 * Notificaciones y permisos de este dispositivo. El estado de cada permiso se lee del SISTEMA
 * cada vez que la pantalla vuelve a estar a la vista (por ejemplo, al regresar de Ajustes).
 *
 * Los avisos son LOCALES (ver `useLocalAlerts`): llegan mientras la app está abierta. Las
 * notificaciones push con la app cerrada son una fase posterior y esta pantalla lo dice.
 */
export default function NotificationSettings() {
  const [snapshots, setSnapshots] = useState<Partial<Record<PermissionKind, PermissionSnapshot>>>({});
  const [alertsOn, setAlertsOn] = useState(true);

  const refresh = useCallback(async () => {
    const entries = await Promise.all(
      KINDS.map(async (kind) => [kind, await getPermission(kind)] as const),
    );
    setSnapshots(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void refresh();
    void loadAlertsEnabled().then(setAlertsOn);
    // Al volver de Ajustes del sistema, se relee el estado real.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  async function act(kind: PermissionKind, snapshot: PermissionSnapshot) {
    const action = actionFor(snapshot);
    if (action === 'request') {
      await requestPermission(kind);
      await refresh();
    } else if (action === 'open-settings') {
      await openAppSettings();
    }
  }

  async function toggleAlerts(value: boolean) {
    setAlertsOn(value);
    await saveAlertsEnabled(value);
  }

  const notifications = snapshots.notifications;
  const canAlert = notifications?.state === 'granted';

  return (
    <Screen back title="Notificaciones">
      <Banner tone="info">
        Los avisos llegan mientras usas THERS. Las notificaciones con la app cerrada (push) todavía no existen.
      </Banner>

      <Text style={styles.heading}>Avisos en este dispositivo</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>Avisarme de novedades</Text>
          <Text style={styles.description}>
            {canAlert
              ? 'Me gusta, comentarios, seguidores, menciones y novedades de tus lugares.'
              : 'Primero permite las notificaciones del sistema, más abajo.'}
          </Text>
        </View>
        <Switch
          value={alertsOn && canAlert}
          onValueChange={toggleAlerts}
          disabled={!canAlert}
          trackColor={{ true: colors.brand, false: colors.borderStrong }}
          accessibilityLabel="Avisarme de novedades"
        />
      </View>

      <Text style={styles.heading}>Permisos del sistema</Text>
      {KINDS.map((kind) => {
        const snapshot = snapshots[kind];
        const copy = PERMISSION_COPY[kind];
        const action = snapshot ? actionFor(snapshot) : 'none';
        const label = actionLabel(action);
        return (
          <View key={kind} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{copy.title}</Text>
              <Text style={styles.description}>{copy.why}</Text>
              <Text style={styles.state}>{snapshot ? stateLabel(snapshot) : 'Comprobando…'}</Text>
            </View>
            {label && snapshot ? (
              <Pressable
                onPress={() => act(kind, snapshot)}
                style={styles.button}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${copy.title}`}
              >
                <Text style={styles.buttonText}>{label}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.footnote}>
        Para las fotos de una historia no hace falta ningún permiso: usamos el selector de imágenes del
        sistema, que solo nos entrega la que eliges.
      </Text>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  heading: {
    fontSize: fontSize.labelLg,
    fontWeight: '700',
    color: colors.fgMuted,
    textTransform: 'uppercase',
    marginTop: space[4],
    marginBottom: space[2],
  },
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
  state: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.brandText, marginTop: space[1] },
  button: {
    minHeight: 40,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: fontSize.labelLg, fontWeight: '700', color: colors.brandText },
  footnote: { fontSize: fontSize.labelMd, color: colors.fgMuted, lineHeight: 17, marginTop: space[2] },
}));
