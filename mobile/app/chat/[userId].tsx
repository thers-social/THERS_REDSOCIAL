import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@features/auth/context/AuthContext';
import { MAX_MESSAGE_LENGTH } from '@features/messages/api';
import type { LocalMessage } from '@features/messages/chatState';
import { useChat } from '@features/messages/useChat';
import { blockUser } from '@features/safety/api';
import { ReportModal } from '@features/safety/ReportModal';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { formatClock } from '@shared/lib/time';
import { ActionSheet } from '@shared/ui/ActionSheet';
import type { SheetAction } from '@shared/ui/ActionSheet';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { EditTextModal } from '@shared/ui/EditTextModal';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Chat individual (`ADR-035-chat-sync.md`). Solo las dos personas de la
 * conversación acceden: el servidor deriva quién eres del token, nunca del cuerpo.
 *
 * Sincronización por consultas periódicas (no tiempo real), que se detienen con la
 * pantalla en segundo plano. Los envíos son idempotentes: un reintento no duplica.
 */
export default function Chat() {
  const { userId, name, username, avatar } = useLocalSearchParams<{
    userId: string;
    name?: string;
    username?: string;
    avatar?: string;
  }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const chat = useChat({ myId: user?.id ?? '', otherUserId: userId, active: focused });

  const [draft, setDraft] = useState('');
  const [menuFor, setMenuFor] = useState<LocalMessage | null>(null);
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  const [reporting, setReporting] = useState<LocalMessage | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [reportUser, setReportUser] = useState(false);
  const listRef = useRef<FlatList<LocalMessage>>(null);

  if (!user) return null;

  const displayName = name || 'Conversación';
  const canWrite = chat.state === 'ready' || chat.state === 'loading';

  function submit() {
    const text = draft.trim();
    if (!text) return;
    chat.send(text);
    setDraft('');
    // Tras enviar se baja al final: la lista está invertida, así que es el inicio.
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }

  function openMessageMenu(message: LocalMessage) {
    if (message.local === 'sending') return;
    setMenuFor(message);
  }

  const messageActions: SheetAction[] = !menuFor
    ? []
    : menuFor.local === 'failed'
      ? [
          { label: 'Reintentar envío', onPress: () => chat.retry(menuFor.client_id as string) },
          {
            label: 'Descartar mensaje',
            destructive: true,
            onPress: () => chat.discard(menuFor.client_id as string),
          },
        ]
      : menuFor.sender_id === user.id
        ? [
            { label: 'Editar mensaje', onPress: () => setEditing(menuFor) },
            {
              label: 'Eliminar mensaje',
              destructive: true,
              onPress: () =>
                Alert.alert(
                  'Eliminar mensaje',
                  'Se eliminará para las dos personas. No se puede deshacer.',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Eliminar',
                      style: 'destructive',
                      onPress: () =>
                        chat.remove(menuFor.id).catch((e: Error) =>
                          Alert.alert('No se pudo eliminar', e.message),
                        ),
                    },
                  ],
                ),
            },
          ]
        : [{ label: 'Reportar mensaje', onPress: () => setReporting(menuFor) }];

  const headerActions: SheetAction[] = [
    { label: `Reportar a @${username ?? 'esta cuenta'}`, onPress: () => setReportUser(true) },
    {
      label: `Bloquear a @${username ?? 'esta cuenta'}`,
      destructive: true,
      onPress: () =>
        Alert.alert(
          `¿Bloquear a @${username ?? 'esta cuenta'}?`,
          'No podrá escribirte. Puedes desbloquearla desde tu perfil.',
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Bloquear',
              style: 'destructive',
              onPress: async () => {
                try {
                  await blockUser(userId);
                  await chat.reload();
                } catch (e) {
                  Alert.alert('No se pudo bloquear', e instanceof Error ? e.message : 'Inténtalo de nuevo.');
                }
              },
            },
          ],
        ),
    },
  ];

  // La lista se muestra invertida (más reciente abajo, sin saltos al cargar historial).
  const data = [...chat.messages].reverse();

  return (
    <Screen
      title={displayName}
      back
      scroll={false}
      headerRight={
        chat.state === 'unavailable' ? null : (
          <Pressable
            onPress={() => setHeaderMenu(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Más opciones de la conversación"
          >
            <Text style={styles.headerMenu}>⋯</Text>
          </Pressable>
        )
      }
    >
      {chat.state === 'unavailable' ? (
        <StateMessage
          kind="empty"
          title="Usuario no encontrado"
          message="Esta cuenta ya no existe o no puedes ver su conversación."
        />
      ) : chat.state === 'error' ? (
        <StateMessage
          kind="error"
          title="No pudimos abrir la conversación"
          message={chat.error ?? undefined}
          actionLabel="Reintentar"
          onAction={chat.reload}
        />
      ) : (
        <>
          {chat.offline ? (
            <View style={styles.offline}>
              <Banner tone="error">Sin conexión. Reintentando…</Banner>
            </View>
          ) : null}

          <FlatList
            ref={listRef}
            data={data}
            inverted
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.4}
            onEndReached={() => void chat.loadOlder()}
            ListFooterComponent={
              chat.loadingOlder ? (
                <StateMessage kind="loading" />
              ) : !chat.hasOlder && chat.state === 'ready' && chat.messages.length > 0 ? (
                <Text style={styles.start}>Inicio de la conversación</Text>
              ) : null
            }
            ListEmptyComponent={
              chat.state === 'loading' ? (
                <View style={styles.flip}>
                  <StateMessage kind="loading" message="Cargando mensajes…" />
                </View>
              ) : (
                <View style={styles.flip}>
                  <StateMessage
                    kind="empty"
                    title="Sin mensajes todavía"
                    message="Escribe el primero. Los mensajes no están cifrados de extremo a extremo."
                  />
                </View>
              )
            }
            renderItem={({ item }) => (
              <Bubble
                message={item}
                mine={item.sender_id === user.id}
                avatarName={displayName}
                avatarUri={avatar || null}
                onLongPress={() => openMessageMenu(item)}
                onRetry={() => item.client_id && chat.retry(item.client_id)}
              />
            )}
          />

          {chat.error && chat.state === 'ready' ? (
            <View style={styles.sendError}>
              <Banner tone="error">{chat.error}</Banner>
            </View>
          ) : null}

          <View style={[styles.composer, { paddingBottom: insets.bottom + space[2] }]}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Escribe un mensaje"
              placeholderTextColor={colors.fgDisabled}
              multiline
              maxLength={MAX_MESSAGE_LENGTH}
              accessibilityLabel="Mensaje"
              editable={canWrite}
            />
            <Pressable
              onPress={submit}
              disabled={!draft.trim() || !canWrite}
              style={[styles.send, (!draft.trim() || !canWrite) && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Enviar mensaje"
            >
              <Text style={styles.sendText}>Enviar</Text>
            </Pressable>
          </View>
        </>
      )}

      <ActionSheet
        visible={menuFor !== null}
        actions={messageActions}
        onClose={() => setMenuFor(null)}
      />
      <ActionSheet
        visible={headerMenu}
        title={displayName}
        actions={headerActions}
        onClose={() => setHeaderMenu(false)}
      />
      <EditTextModal
        visible={editing !== null}
        title="Editar mensaje"
        initialValue={editing?.content ?? ''}
        maxLength={MAX_MESSAGE_LENGTH}
        onSubmit={async (text) => {
          if (!editing) return;
          try {
            await chat.edit(editing.id, text);
          } catch (e) {
            throw new Error(e instanceof Error ? e.message : 'No pudimos guardar el cambio.');
          }
        }}
        onClose={() => setEditing(null)}
      />
      <ReportModal
        visible={reporting !== null}
        targetType="message"
        targetId={reporting?.id ?? ''}
        targetLabel="este mensaje"
        onClose={() => setReporting(null)}
      />
      <ReportModal
        visible={reportUser}
        targetType="user"
        targetId={userId}
        targetLabel={`a @${username ?? 'esta cuenta'}`}
        onClose={() => setReportUser(false)}
      />
    </Screen>
  );
}

function Bubble({
  message,
  mine,
  avatarName,
  avatarUri,
  onLongPress,
  onRetry,
}: {
  message: LocalMessage;
  mine: boolean;
  avatarName: string;
  avatarUri: string | null;
  onLongPress: () => void;
  onRetry: () => void;
}) {
  const failed = message.local === 'failed';
  const sending = message.local === 'sending';

  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      {!mine ? <Avatar name={avatarName} uri={avatarUri} size={28} /> : null}
      <Pressable
        onLongPress={onLongPress}
        onPress={failed ? onRetry : undefined}
        delayLongPress={300}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          failed && styles.bubbleFailed,
          sending && styles.bubbleSending,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${mine ? 'Tú' : avatarName}: ${message.content}`}
        accessibilityHint={failed ? 'No se envió. Toca para reintentar.' : 'Mantén pulsado para ver opciones'}
      >
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.content}</Text>
        <Text style={[styles.meta, mine && styles.metaMine]}>
          {failed
            ? 'No se envió · toca para reintentar'
            : sending
              ? 'Enviando…'
              : `${formatClock(message.created_at)}${message.edited ? ' · editado' : ''}`}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  headerMenu: { fontSize: 26, color: colors.fgMuted, lineHeight: 28, paddingHorizontal: space[1] },
  list: { padding: space[3], flexGrow: 1 },
  flip: { transform: [{ scaleY: -1 }] },
  start: { textAlign: 'center', fontSize: fontSize.labelMd, color: colors.fgMuted, padding: space[3] },
  offline: { paddingHorizontal: space[3], paddingTop: space[2] },
  sendError: { paddingHorizontal: space[3] },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: space[2], gap: space[2] },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: radius.card, paddingHorizontal: space[3], paddingVertical: space[2] },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: radius.xs },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.xs },
  bubbleFailed: { backgroundColor: colors.dangerSurface, borderWidth: 1, borderColor: colors.dangerBorder },
  bubbleSending: { opacity: 0.7 },
  bubbleText: { fontSize: fontSize.bodyLg, color: colors.fg, lineHeight: 22 },
  bubbleTextMine: { color: colors.onBrand },
  meta: { fontSize: fontSize.labelSm, color: colors.fgMuted, marginTop: 2, alignSelf: 'flex-end' },
  metaMine: { color: colors.onBrandMuted },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingTop: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: fontSize.bodyLg,
    color: colors.fg,
  },
  send: {
    minHeight: 44,
    minWidth: 72,
    borderRadius: radius.input,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.onBrand, fontWeight: '700', fontSize: fontSize.bodyMd },
}));
