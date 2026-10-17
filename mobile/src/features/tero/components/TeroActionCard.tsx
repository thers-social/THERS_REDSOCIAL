import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { teroColors } from '../design/teroColors';
import { canAct, EXPIRED_NOTE, isCardExpired } from '../lib/teroCards';
import type { TeroActionCard, TeroCardState } from '../types';

type Props = {
  card: TeroActionCard;
  state: TeroCardState;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Cuánto esperar tras el vencimiento antes de volver a pintar, para no quedar justo en el borde. */
const EXPIRY_MARGIN_MS = 50;

const HEADLINE: Record<TeroCardState['status'], string> = {
  pending: 'Tero preparó esto · todavía no se ha hecho',
  confirming: 'Confirmando…',
  cancelling: 'Cancelando…',
  confirmed: 'Hecho',
  cancelled: 'Cancelada',
  expired: 'Venció',
  failed: 'No se pudo completar',
  unavailable: 'No disponible',
};

/**
 * Tarjeta de una acción que Tero preparó (ADR-041 §6.2). El texto (`summary`) es el que redactó
 * el servidor y es exactamente lo que se ejecutará: no se reformula aquí. Nada ocurre hasta que
 * la persona pulsa «Confirmar»; la tarjeta lo dice con todas las letras.
 */
export function TeroActionCardView({ card, state, onConfirm, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now());

  // Si vence mientras está en pantalla, se repinta sola como vencida (y se bloquean los botones).
  useEffect(() => {
    if (state.status !== 'pending') return;
    const wait = Date.parse(card.expiresAt) - Date.now();
    if (wait <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), wait + EXPIRY_MARGIN_MS);
    return () => clearTimeout(timer);
  }, [card.expiresAt, state.status]);

  const expiredOnScreen = state.status === 'pending' && isCardExpired(card, now);
  const status = expiredOnScreen ? 'expired' : state.status;
  const note = expiredOnScreen ? EXPIRED_NOTE : state.note;
  const active = canAct(state, card, now);
  const busy = state.status === 'confirming' || state.status === 'cancelling';
  const done = status === 'confirmed';

  return (
    <View
      style={[styles.card, done && styles.cardDone, (status === 'failed' || status === 'unavailable') && styles.cardFailed]}
      accessible={false}
    >
      <Text style={[styles.headline, done && styles.headlineDone]} accessibilityLiveRegion="polite">
        {HEADLINE[status]}
      </Text>
      <Text style={styles.summary} accessibilityLabel={`Acción propuesta: ${card.summary}`}>
        {card.summary}
      </Text>

      {note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}

      {status === 'pending' || busy ? (
        <View style={styles.actions}>
          <Pressable
            onPress={onCancel}
            disabled={!active}
            style={[styles.button, styles.cancel, !active && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Cancelar esta acción"
            accessibilityState={{ disabled: !active, busy: state.status === 'cancelling' }}
          >
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            disabled={!active}
            style={[styles.button, styles.confirm, !active && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel={`Confirmar: ${card.summary}`}
            accessibilityState={{ disabled: !active, busy: state.status === 'confirming' }}
          >
            <Text style={styles.confirmText}>Confirmar</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  card: {
    alignSelf: 'stretch',
    maxWidth: '92%',
    marginBottom: space[3],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: teroColors.blue,
    backgroundColor: colors.surface,
  },
  cardDone: { borderColor: colors.borderSubtle, opacity: 0.85 },
  cardFailed: { borderColor: colors.dangerFg },
  headline: {
    fontSize: fontSize.labelSm,
    fontWeight: '700',
    color: colors.brandText,
    marginBottom: space[1],
  },
  headlineDone: { color: colors.fgSecondary },
  summary: { fontSize: fontSize.bodyMd, fontWeight: '600', color: colors.fg, lineHeight: 21 },
  note: { fontSize: fontSize.bodySm, color: colors.fgSecondary, marginTop: space[2], lineHeight: 18 },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  confirm: { backgroundColor: colors.brand },
  disabled: { opacity: 0.5 },
  cancelText: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.fg },
  confirmText: { fontSize: fontSize.bodyMd, fontWeight: '700', color: colors.onBrand },
}));
