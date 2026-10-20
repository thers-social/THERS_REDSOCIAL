import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@features/auth/context/AuthContext';
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
import { CHAT_MEDIA_SIZE } from '@shared/media/chatMediaSize';
import { ImageGridView } from '@shared/media/ImageGridView';
import { MediaAttachmentBar } from '@shared/media/MediaAttachmentBar';
import { MAX_MESSAGE_IMAGES } from '@shared/media/mediaRules';
import { useMediaAttachments } from '@shared/media/useMediaAttachments';
import { VideoPlayerView } from '@shared/media/VideoPlayerView';
import { ActionSheet } from '@shared/ui/ActionSheet';
import type { SheetAction } from '@shared/ui/ActionSheet';
import { Avatar } from '@shared/ui/Avatar';
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
            renderItem={({ item, index }) => {
              // La lista está invertida: el mensaje anterior en el tiempo es el siguiente del arreglo.
              const older = data[index + 1];
              const newer = data[index - 1];
              return (
                <Bubble
                  message={item}
                  mine={item.sender_id === user.id}
                  // En un grupo cada mensaje trae a su autor; en un directo es siempre la otra persona.
                  avatarName={isGroup ? (item.sender?.name ?? 'Alguien') : displayName}
                  avatarUri={isGroup ? (item.sender?.avatar_url ?? null) : avatar || null}
                  showName={isGroup}
                  startsRun={!sameRun(older, item)}
                  endsRun={!sameRun(item, newer)}
                  stamp={timeSeparator(older, item)}
                  // Foto de quien habla -> su perfil (en un grupo, el autor del mensaje; en un directo, la otra persona).
                  onAvatarPress={() => openProfile(isGroup ? (item.sender?.id ?? item.sender_id) : userId)}
                  onLongPress={() => openMessageMenu(item)}
                  onRetry={() => item.client_id && chat.retry(item.client_id)}
                />
              );
            }}
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

/** Mensajes seguidos de la misma persona, a menos de 5 minutos, forman una tanda (formato TikTok). */
const RUN_WINDOW_MS = 5 * 60 * 1000;
/** Pasado este silencio entre dos mensajes se pone la hora en el centro. */
const STAMP_GAP_MS = 15 * 60 * 1000;

function sameRun(a: LocalMessage | undefined, b: LocalMessage | undefined): boolean {
  if (!a || !b || a.sender_id !== b.sender_id) return false;
  return Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < RUN_WINDOW_MS;
}

/** La hora centrada que separa tandas: vacía si el mensaje sigue de cerca al anterior. */
function timeSeparator(older: LocalMessage | undefined, message: LocalMessage): string | null {
  const now = new Date(message.created_at);
  if (older && now.getTime() - new Date(older.created_at).getTime() < STAMP_GAP_MS) return null;
  const clock = formatClock(message.created_at);
  return now.toDateString() === new Date().toDateString()
    ? clock
    : `${now.getDate()}/${now.getMonth() + 1} ${clock}`;
}

/**
 * Un mensaje al estilo de los directos de TikTok: burbujas redondeadas (las tuyas en el color de la marca,
 * las demás en gris), sin la hora dentro, la foto de la otra persona solo en el último mensaje de su tanda y
 * una hora centrada entre conversaciones separadas en el tiempo. Foto y video van sin burbuja.
 */
function Bubble({
  message,
  mine,
  avatarName,
  avatarUri,
  showName = false,
  startsRun,
  endsRun,
  stamp,
  onAvatarPress,
  onLongPress,
  onRetry,
}: {
  message: LocalMessage;
  mine: boolean;
  avatarName: string;
  avatarUri: string | null;
  /** En un grupo se escribe el nombre de quien habla sobre su primer mensaje. */
  showName?: boolean;
  /** Primer mensaje de la tanda de esa persona. */
  startsRun: boolean;
  /** Último mensaje de la tanda: ahí va la foto de la otra persona. */
  endsRun: boolean;
  /** Hora centrada sobre este mensaje, o `null`. */
  stamp: string | null;
  /** Tocar la foto de quien habla abre su perfil. */
  onAvatarPress?: () => void;
  onLongPress: () => void;
  onRetry: () => void;
}) {
  const failed = message.local === 'failed';
  const sending = message.local === 'sending';
  const hasMedia = Boolean(message.images?.length || message.video || message.localMedia);
  // Solo foto o video, sin texto ni otro adjunto: se ven sin burbuja de color.
  const mediaOnly = hasMedia && !message.content && !message.audio && !message.place && !message.post;
  // Foto o video CON texto: el texto va aparte, en una burbuja debajo.
  const split = hasMedia && Boolean(message.content) && !message.audio && !message.place && !message.post;

  const press = {
    onLongPress,
    onPress: failed ? onRetry : undefined,
    delayLongPress: 300,
    accessibilityRole: 'button' as const,
    accessibilityLabel:
      message.audio && !message.content
        ? voiceAccessibilityLabel({ mine, name: avatarName, durationMs: message.audio.duration_ms })
        : `${mine ? 'Tú' : avatarName}: ${message.content}`,
    accessibilityHint: failed ? 'No se envió. Toca para reintentar.' : 'Mantén pulsado para ver opciones',
  };
  const nameLabel = showName && !mine && startsRun ? <Text style={styles.senderName}>{avatarName}</Text> : null;
  // Foto y video (ADR-039, ADR-046). Un video aún sin confirmar no tiene miniatura.
  const mediaBlock = (
    <>
      <ImageGridView images={message.images} label={mine ? 'Tu foto' : `Foto de ${avatarName}`} compact />
      {message.video ? (
        <VideoPlayerView video={message.video} compact accessibilityLabel={mine ? 'Tu video' : `Video de ${avatarName}`} />
      ) : message.localMedia?.kind === 'video' ? (
        <View style={styles.pendingVideo}>
          <Text style={styles.pendingVideoText}>{failed ? 'No se envió el video' : 'Enviando video…'}</Text>
        </View>
      ) : null}
    </>
  );
  const textBlock = <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.content}</Text>;
  const noteBlock =
    failed || sending || message.edited ? (
      <Text style={[styles.meta, mine && styles.metaMine]}>
        {failed ? 'No se envió · toca para reintentar' : sending ? 'Enviando…' : 'editado'}
      </Text>
    ) : null;

  return (
    <>
      {stamp ? <Text style={styles.stamp}>{stamp}</Text> : null}
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs, startsRun ? styles.runStart : styles.runNext]}>
      {!mine ? (
        endsRun ? (
          <Pressable
            onPress={onAvatarPress}
            disabled={!onAvatarPress}
            accessibilityRole="button"
            accessibilityLabel={`Ver el perfil de ${avatarName}`}
          >
            <Avatar name={avatarName} uri={avatarUri} size={28} />
          </Pressable>
        ) : (
          <View style={styles.avatarSpace} />
        )
      ) : null}
      {split ? (
        // Foto o video con texto: el texto va en su propia burbuja debajo, no dentro del cuadro del adjunto.
        <View style={[styles.stack, mine ? styles.stackMine : styles.stackTheirs]}>
          {nameLabel}
          <Pressable {...press} style={[styles.splitMedia, sending && styles.bubbleSending]}>
            {mediaBlock}
          </Pressable>
          <Pressable
            {...press}
            style={[
              styles.splitText,
              mine ? styles.bubbleMine : styles.bubbleTheirs,
              failed && styles.bubbleFailed,
              sending && styles.bubbleSending,
            ]}
          >
            {textBlock}
            {noteBlock}
          </Pressable>
        </View>
      ) : (
        <Pressable
          {...press}
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            mediaOnly && styles.bubbleMediaOnly,
            failed && styles.bubbleFailed,
            sending && styles.bubbleSending,
          ]}
        >
          {nameLabel}
          {message.audio ? (
            <VoiceBubble
              url={message.audio.url}
              durationMs={message.audio.duration_ms}
              mine={mine}
              name={avatarName}
            />
          ) : null}
          {mediaBlock}
          {message.place ? <SharedPlaceCard place={message.place} mine={mine} /> : null}
          {message.post ? <SharedPostCard post={message.post} mine={mine} /> : null}
          {message.content || (!message.place && !message.post && !message.audio && !hasMedia) ? textBlock : null}
          {noteBlock}
        </Pressable>
      )}
      </View>
    </>
  );
}

const styles = themedStyles(() => ({
  headerMenu: { fontSize: 26, color: colors.fgMuted, lineHeight: 28, paddingHorizontal: space[1] },
  list: { padding: space[3], flexGrow: 1 },
  flip: { transform: [{ scaleY: -1 }] },
  start: { textAlign: 'center', fontSize: fontSize.labelMd, color: colors.fgMuted, padding: space[3] },
  offline: { paddingHorizontal: space[3], paddingTop: space[2] },
  sendError: { paddingHorizontal: space[3] },
  // Formato TikTok: burbujas muy redondeadas, tuyas en el color de la marca y ajenas en gris, sin hora dentro.
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  runStart: { marginTop: space[3] },
  runNext: { marginTop: 2 },
  avatarSpace: { width: 28 },
  stamp: { alignSelf: 'center', fontSize: fontSize.labelMd, color: colors.fgMuted, marginVertical: space[3] },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 20, paddingHorizontal: space[3], paddingVertical: space[2] },
  bubbleMine: { backgroundColor: colors.brand },
  bubbleMediaOnly: { backgroundColor: 'transparent', borderWidth: 0, padding: 0, maxWidth: CHAT_MEDIA_SIZE },
  // Foto o video con texto: dos piezas apiladas, el adjunto arriba y el texto en su burbuja.
  // Ancho fijo (el del adjunto): el texto se ajusta a él y nada se sale de la pantalla.
  stack: { width: CHAT_MEDIA_SIZE, gap: 2 },
  splitMedia: { width: CHAT_MEDIA_SIZE },
  splitText: { maxWidth: '100%', borderRadius: 20, paddingHorizontal: space[3], paddingVertical: space[2] },
  stackMine: { alignItems: 'flex-end' },
  stackTheirs: { alignItems: 'flex-start' },
  bubbleTheirs: { backgroundColor: colors.surfaceRaised },
  bubbleFailed: { backgroundColor: colors.dangerSurface, borderWidth: 1, borderColor: colors.dangerBorder },
  bubbleSending: { opacity: 0.7 },
  senderName: { fontSize: fontSize.labelMd, fontWeight: '700', color: colors.brandText, marginBottom: 2 },
  bubbleText: { fontSize: fontSize.bodyLg, color: colors.fg, lineHeight: 22 },
  bubbleTextMine: { color: colors.onBrand },
  meta: { fontSize: fontSize.labelSm, color: colors.fgMuted, marginTop: 2, alignSelf: 'flex-end' },
  metaMine: { color: colors.onBrandMuted },
  attachBar: { paddingHorizontal: space[3], paddingTop: space[2], borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  pendingVideo: {
    width: CHAT_MEDIA_SIZE,
    height: CHAT_MEDIA_SIZE,
    borderRadius: radius.card,
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
    borderWidth: 0,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    fontSize: fontSize.bodyLg,
    color: colors.fg,
  },
  send: {
    minHeight: 44,
    minWidth: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.onBrand, fontWeight: '700', fontSize: fontSize.bodyMd },
}));
