import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@features/auth/context/AuthContext';
import { useCalls } from '@features/calls/CallContext';
import { MAX_MESSAGE_LENGTH } from './api';
import type { ChatTarget } from './api';
import type { LocalMessage } from './chatState';
import { useChat } from './useChat';
import { VoiceBubble } from './VoiceBubble';
import { VoiceComposer } from './VoiceComposer';
import { VOICE_ENABLED } from './voiceConfig';
import { voiceAccessibilityLabel } from './voice';
import { SharedPlaceCard } from '@features/places/SharedPlaceCard';
import { SharedPostCard } from '@features/posts/SharedPostCard';
import { useOpenProfile } from '@features/profile/useOpenProfile';
import { blockUser } from '@features/safety/api';
import { ReportModal } from '@features/safety/ReportModal';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { formatClock } from '@shared/lib/time';
import { ImageGridView } from '@shared/media/ImageGridView';
import { MediaAttachmentBar } from '@shared/media/MediaAttachmentBar';
import { MAX_MESSAGE_IMAGES } from '@shared/media/mediaRules';
import { useMediaAttachments } from '@shared/media/useMediaAttachments';
import { VideoPlayerView } from '@shared/media/VideoPlayerView';
import { ActionSheet } from '@shared/ui/ActionSheet';
import type { SheetAction } from '@shared/ui/ActionSheet';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';
import { Banner } from '@shared/ui/Banner';
import { EditTextModal } from '@shared/ui/EditTextModal';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

type Props = ChatTarget & {
  name?: string;
  username?: string;
  avatar?: string;
};

/**
 * Pantalla de un chat (`ADR-035-chat-sync.md`): directo entre dos personas o grupal (`ADR-048`). Solo
 * quienes participan acceden: el servidor deriva quién eres del token, nunca del cuerpo.
 *
 * Sincronización por consultas periódicas (no tiempo real), que se detienen con la
 * pantalla en segundo plano. Los envíos son idempotentes: un reintento no duplica.
 */
export function ChatScreen({ kind, id: userId, name, username, avatar }: Props) {
  const isGroup = kind === 'group';
  const { enabled: callsEnabled, inCall, startCall } = useCalls();
  const router = useRouter();
  const openProfile = useOpenProfile();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const chat = useChat({ myId: user?.id ?? '', otherUserId: userId, kind, active: focused });

  const [draft, setDraft] = useState('');
  const [menuFor, setMenuFor] = useState<LocalMessage | null>(null);
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  const [reporting, setReporting] = useState<LocalMessage | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  // Foto o video adjuntos al mensaje que se está escribiendo (ADR-039, ADR-046): uno solo.
  const media = useMediaAttachments({ maxImages: MAX_MESSAGE_IMAGES });
  const [reportUser, setReportUser] = useState(false);
  const listRef = useRef<FlatList<LocalMessage>>(null);

  if (!user) return null;

  const displayName = name || (isGroup ? 'Grupo' : 'Conversación');
  const canWrite = chat.state === 'ready' || chat.state === 'loading';

  function submit() {
    const text = draft.trim();
    // Con una foto o un video el texto es opcional (ADR-039, ADR-046).
    const attachment = media.items[0];
    if (!text && !attachment) return;
    chat.send(text, attachment);
    setDraft('');
    media.clear();
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
            // Una nota de voz sin texto no tiene nada que editar (ADR-042).
            ...(menuFor.audio && !menuFor.content
              ? []
              : [{ label: 'Editar mensaje', onPress: () => setEditing(menuFor) }]),
            {
              label: 'Eliminar mensaje',
              destructive: true,
              onPress: () =>
                Alert.alert(
                  'Eliminar mensaje',
                  isGroup ? 'Se eliminará para todo el grupo. No se puede deshacer.' : 'Se eliminará para las dos personas. No se puede deshacer.',
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
    { label: `Ver el perfil de @${username ?? 'esta cuenta'}`, onPress: () => openProfile(userId) },
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

  // El compositor de texto de siempre; con notas de voz recibe el botón de micrófono (ADR-042).
  const textComposer = (mic: ReactNode) => (
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
      {mic}
      <Pressable
        onPress={submit}
        disabled={(!draft.trim() && media.items.length === 0) || !canWrite || media.picking}
        style={[
          styles.send,
          ((!draft.trim() && media.items.length === 0) || !canWrite || media.picking) && styles.sendDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Enviar mensaje"
      >
        <Text style={styles.sendText}>Enviar</Text>
      </Pressable>
    </View>
  );

  // La lista se muestra invertida (más reciente abajo, sin saltos al cargar historial).
  const data = [...chat.messages].reverse();

  return (
    <Screen
      title={displayName}
      back
      scroll={false}
      headerRight={
        chat.state === 'unavailable' ? null : (
          <View style={styles.headerActions}>
            {callsEnabled && !isGroup ? (
              <>
                <Pressable
                  onPress={() => startCall(userId, 'audio')}
                  disabled={inCall}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Llamar a ${displayName}`}
                  style={inCall ? styles.headerActionOff : null}
                >
                  <Icon name="phone" size={22} color={colors.fgMuted} />
                </Pressable>
                <Pressable
                  onPress={() => startCall(userId, 'video')}
                  disabled={inCall}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Videollamada con ${displayName}`}
                  style={inCall ? styles.headerActionOff : null}
                >
                  <Icon name="video" size={22} color={colors.fgMuted} />
                </Pressable>
              </>
            ) : null}
            <Pressable
              onPress={() =>
                isGroup
                  ? router.push({ pathname: '/group/info/[groupId]', params: { groupId: userId, name: displayName } })
                  : setHeaderMenu(true)
              }
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={isGroup ? 'Información del grupo' : 'Más opciones de la conversación'}
            >
              <Text style={styles.headerMenu}>⋯</Text>
            </Pressable>
          </View>
        )
      }
    >
      {chat.state === 'unavailable' ? (
        <StateMessage
          kind="empty"
          title={isGroup ? 'Grupo no encontrado' : 'Usuario no encontrado'}
          message={
            isGroup
              ? 'Ya no estás en este grupo o se eliminó.'
              : 'Esta cuenta ya no existe o no puedes ver su conversación.'
          }
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
                    message={
                      isGroup
                        ? 'Escribe el primero para todo el grupo. Los mensajes no están cifrados de extremo a extremo.'
                        : 'Escribe el primero. Los mensajes no están cifrados de extremo a extremo.'
                    }
                  />
                </View>
              )
            }
            renderItem={({ item }) => (
              <Bubble
                message={item}
                mine={item.sender_id === user.id}
                // En un grupo cada mensaje trae a su autor; en un directo es siempre la otra persona.
                avatarName={isGroup ? (item.sender?.name ?? 'Alguien') : displayName}
                avatarUri={isGroup ? (item.sender?.avatar_url ?? null) : avatar || null}
                showName={isGroup}
                // Foto de quien habla -> su perfil (en un grupo, el autor del mensaje; en un directo, la otra persona).
                onAvatarPress={() => openProfile(isGroup ? (item.sender?.id ?? item.sender_id) : userId)}
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

          {canWrite ? (
            <View style={styles.attachBar}>
              <MediaAttachmentBar media={media} maxImages={MAX_MESSAGE_IMAGES} />
            </View>
          ) : null}

          {VOICE_ENABLED ? (
            <VoiceComposer
              containerStyle={[styles.composer, { paddingBottom: insets.bottom + space[2] }]}
              enabled={canWrite}
              showMic={!draft.trim() && media.items.length === 0}
              onSend={(recording) => {
                chat.sendVoice(recording);
                requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
              }}
            >
              {(mic) => textComposer(mic)}
            </VoiceComposer>
          ) : (
            textComposer(null)
          )}
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
      {isGroup ? null : <ReportModal
        visible={reportUser}
        targetType="user"
        targetId={userId}
        targetLabel={`a @${username ?? 'esta cuenta'}`}
        onClose={() => setReportUser(false)}
      />}
    </Screen>
  );
}

function Bubble({
  message,
  mine,
  avatarName,
  avatarUri,
  showName = false,
  onAvatarPress,
  onLongPress,
  onRetry,
}: {
  message: LocalMessage;
  mine: boolean;
  avatarName: string;
  avatarUri: string | null;
  /** En un grupo se escribe el nombre de quien habla sobre su mensaje. */
  showName?: boolean;
  /** Tocar la foto de quien habla abre su perfil. */
  onAvatarPress?: () => void;
  onLongPress: () => void;
  onRetry: () => void;
}) {
  const failed = message.local === 'failed';
  const sending = message.local === 'sending';
  // Con foto o video la burbuja es un marco fino alrededor de la imagen, no un bloque grueso de color.
  const hasMedia = Boolean(message.images?.length || message.video || message.localMedia);

  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      {!mine ? (
        <Pressable
          onPress={onAvatarPress}
          disabled={!onAvatarPress}
          accessibilityRole="button"
          accessibilityLabel={`Ver el perfil de ${avatarName}`}
        >
          <Avatar name={avatarName} uri={avatarUri} size={28} />
        </Pressable>
      ) : null}
      <Pressable
        onLongPress={onLongPress}
        onPress={failed ? onRetry : undefined}
        delayLongPress={300}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          hasMedia && styles.bubbleMedia,
          failed && styles.bubbleFailed,
          sending && styles.bubbleSending,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          message.audio && !message.content
            ? voiceAccessibilityLabel({ mine, name: avatarName, durationMs: message.audio.duration_ms })
            : `${mine ? 'Tú' : avatarName}: ${message.content}`
        }
        accessibilityHint={failed ? 'No se envió. Toca para reintentar.' : 'Mantén pulsado para ver opciones'}
      >
        {showName && !mine ? <Text style={styles.senderName}>{avatarName}</Text> : null}
        {message.audio ? (
          <VoiceBubble
            url={message.audio.url}
            durationMs={message.audio.duration_ms}
            mine={mine}
            name={avatarName}
          />
        ) : null}
        {/* Foto y video (ADR-039, ADR-046). Un video aún sin confirmar no tiene miniatura. */}
        <ImageGridView images={message.images} label={mine ? 'Tu foto' : `Foto de ${avatarName}`} compact />
        {message.video ? (
          <VideoPlayerView video={message.video} compact accessibilityLabel={mine ? 'Tu video' : `Video de ${avatarName}`} />
        ) : message.localMedia?.kind === 'video' ? (
          <View style={styles.pendingVideo}>
            <Text style={styles.pendingVideoText}>{failed ? 'No se envió el video' : 'Enviando video…'}</Text>
          </View>
        ) : null}
        {message.place ? <SharedPlaceCard place={message.place} mine={mine} /> : null}
        {message.post ? <SharedPostCard post={message.post} mine={mine} /> : null}
        {message.content || (!message.place && !message.post && !message.audio && !message.images?.length && !message.video && !message.localMedia) ? (
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine, hasMedia && styles.mediaText]}>
            {message.content}
          </Text>
        ) : null}
        <Text style={[styles.meta, mine && styles.metaMine, hasMedia && styles.mediaMeta]}>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  headerActionOff: { opacity: 0.4 },
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
  bubbleMine: { backgroundColor: colors.bubbleMine, borderBottomRightRadius: radius.xs },
  bubbleMedia: { padding: 3 },
  mediaText: { paddingHorizontal: space[2], paddingTop: space[1] },
  mediaMeta: { paddingHorizontal: space[2], paddingBottom: 2 },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.xs },
  bubbleFailed: { backgroundColor: colors.dangerSurface, borderWidth: 1, borderColor: colors.dangerBorder },
  bubbleSending: { opacity: 0.7 },
  senderName: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.brandText, marginBottom: 2 },
  bubbleText: { fontSize: fontSize.bodyLg, color: colors.fg, lineHeight: 22 },
  bubbleTextMine: { color: colors.onBrand },
  meta: { fontSize: fontSize.labelSm, color: colors.fgMuted, marginTop: 2, alignSelf: 'flex-end' },
  metaMine: { color: colors.onBrandMuted },
  attachBar: { paddingHorizontal: space[3], paddingTop: space[2], borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  pendingVideo: {
    width: 200,
    height: 110,
    borderRadius: radius.input,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space[1],
  },
  pendingVideoText: { color: '#ffffff', fontSize: fontSize.labelMd },
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
