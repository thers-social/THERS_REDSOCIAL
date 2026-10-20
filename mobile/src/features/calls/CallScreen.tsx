import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
  VideoTrack,
} from '@livekit/react-native';
import { Track } from 'livekit-client';

import { fontSize, space } from '@shared/design/tokens';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';

import type { Call, CallAccess } from './api';
import type { CallSession } from './CallContext';

/**
 * Pantalla de llamada: entrante (contestar o rechazar), saliente (llamando...) y en curso (sala de
 * LiveKit con micrófono, cámara y colgar). Es un Modal a pantalla completa por encima de toda la app, así
 * que la llamada sigue si la persona navega. Colores fijos (negro y blanco) a propósito: es una pantalla
 * de llamada, no depende del tema claro u oscuro.
 */

type Props = {
  session: CallSession;
  onAccept: () => void;
  onHangUp: () => void;
};

function otherPerson(call: Call) {
  return call.direction === 'outgoing' ? call.callee : call.caller;
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Android pide el micrófono (y la cámara en videollamada) en ejecución, además del manifiesto. */
async function ensurePermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (video) wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

function RoundButton({
  label,
  onPress,
  tone = 'neutral',
  pressed = false,
  children,
}: {
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'danger' | 'accept';
  pressed?: boolean;
  children: ReactNode;
}) {
  const background =
    tone === 'danger' ? '#dc2626' : tone === 'accept' ? '#16a34a' : pressed ? '#ffffff' : 'rgba(255,255,255,0.18)';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={tone === 'neutral' ? { selected: pressed } : undefined}
      style={[styles.round, { backgroundColor: background }]}
    >
      {children}
    </Pressable>
  );
}

function Identity({ call, subtitle }: { call: Call; subtitle: string }) {
  const person = otherPerson(call);
  return (
    <View style={styles.identity}>
      <Avatar name={person.name} uri={person.avatar_url} size={112} />
      <Text style={styles.name} numberOfLines={1}>
        {person.name}
      </Text>
      <Text style={styles.subtitle} accessibilityLiveRegion="polite">
        {subtitle}
      </Text>
    </View>
  );
}

function Incoming({ call, onAccept, onHangUp }: { call: Call; onAccept: () => void; onHangUp: () => void }) {
  // Timbre: vibración repetida mientras suena (sin archivos de audio ni dependencias extra).
  useEffect(() => {
    Vibration.vibrate([0, 700, 1300], true);
    return () => Vibration.cancel();
  }, []);

  return (
    <View style={styles.center}>
      <Identity call={call} subtitle={call.kind === 'video' ? 'Videollamada entrante' : 'Llamada entrante'} />
      <View style={styles.actions}>
        <View style={styles.action}>
          <RoundButton label="Rechazar llamada" tone="danger" onPress={onHangUp}>
            <View style={styles.hangIcon}>
              <Icon name="phone" size={26} color="#ffffff" />
            </View>
          </RoundButton>
          <Text style={styles.actionLabel}>Rechazar</Text>
        </View>
        <View style={styles.action}>
          <RoundButton label="Contestar llamada" tone="accept" onPress={onAccept}>
            <Icon name={call.kind === 'video' ? 'video' : 'phone'} size={26} color="#ffffff" />
          </RoundButton>
          <Text style={styles.actionLabel}>Contestar</Text>
        </View>
      </View>
    </View>
  );
}

function Outgoing({ call, onHangUp }: { call: Call; onHangUp: () => void }) {
  return (
    <View style={styles.center}>
      <Identity call={call} subtitle={call.kind === 'video' ? 'Videollamando...' : 'Llamando...'} />
      <View style={styles.actions}>
        <View style={styles.action}>
          <RoundButton label="Cancelar llamada" tone="danger" onPress={onHangUp}>
            <View style={styles.hangIcon}>
              <Icon name="phone" size={26} color="#ffffff" />
            </View>
          </RoundButton>
          <Text style={styles.actionLabel}>Cancelar</Text>
        </View>
      </View>
    </View>
  );
}

/** Dentro de la sala: videos, silenciar, cámara, colgar y detección de que la otra persona se fue. */
function RoomView({ call, onHangUp }: { call: Call; onHangUp: () => void }) {
  const insets = useSafeAreaInsets();
  const isVideo = call.kind === 'video';
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const remoteVideo = cameraTracks.find((track) => !track.participant.isLocal && isTrackReference(track));
  const localVideo = cameraTracks.find((track) => track.participant.isLocal && isTrackReference(track));

  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Si la otra persona estuvo en la sala y se va, la llamada terminó.
  const hadRemote = useRef(false);
  useEffect(() => {
    if (remoteParticipants.length > 0) hadRemote.current = true;
    else if (hadRemote.current) onHangUp();
  }, [remoteParticipants.length, onHangUp]);

  const showRemoteVideo = isVideo && remoteVideo && isTrackReference(remoteVideo);

  return (
    <View style={styles.flex}>
      <View style={styles.flex}>
        {showRemoteVideo ? (
          <VideoTrack trackRef={remoteVideo} style={StyleSheet.absoluteFill} objectFit="cover" />
        ) : (
          <View style={styles.center}>
            <Identity call={call} subtitle={formatClock(seconds)} />
          </View>
        )}
        {showRemoteVideo ? (
          <Text style={[styles.clock, { top: insets.top + space[3] }]}>
            {otherPerson(call).name} · {formatClock(seconds)}
          </Text>
        ) : null}
        {isVideo && localVideo && isTrackReference(localVideo) && isCameraEnabled ? (
          <VideoTrack
            trackRef={localVideo}
            style={styles.pip}
            objectFit="cover"
            mirror
            zOrder={1}
          />
        ) : null}
      </View>

      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
        <RoundButton
          label={isMicrophoneEnabled ? 'Silenciar micrófono' : 'Activar micrófono'}
          pressed={!isMicrophoneEnabled}
          onPress={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {})}
        >
          <Icon name="mic" size={26} color={isMicrophoneEnabled ? '#ffffff' : '#111111'} />
        </RoundButton>
        {isVideo ? (
          <RoundButton
            label={isCameraEnabled ? 'Apagar cámara' : 'Encender cámara'}
            pressed={!isCameraEnabled}
            onPress={() => localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {})}
          >
            <Icon name="video" size={26} color={isCameraEnabled ? '#ffffff' : '#111111'} />
          </RoundButton>
        ) : null}
        <RoundButton label="Colgar" tone="danger" onPress={onHangUp}>
          <View style={styles.hangIcon}>
            <Icon name="phone" size={26} color="#ffffff" />
          </View>
        </RoundButton>
      </View>
    </View>
  );
}

function Active({ call, access, onHangUp }: { call: Call; access: CallAccess; onHangUp: () => void }) {
  const isVideo = call.kind === 'video';
  const [permission, setPermission] = useState<'asking' | 'granted' | 'denied'>('asking');
  useKeepAwake();

  useEffect(() => {
    let cancelled = false;
    ensurePermissions(isVideo).then((ok) => {
      if (!cancelled) setPermission(ok ? 'granted' : 'denied');
    });
    return () => {
      cancelled = true;
    };
  }, [isVideo]);

  // Enruta el audio de la llamada (altavoz/auricular/bluetooth) mientras dura.
  useEffect(() => {
    if (permission !== 'granted') return undefined;
    AudioSession.startAudioSession().catch(() => {});
    return () => {
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, [permission]);

  if (permission === 'asking') {
    return (
      <View style={styles.center}>
        <Identity call={call} subtitle="Conectando..." />
      </View>
    );
  }
  if (permission === 'denied') {
    return (
      <View style={styles.center}>
        <Identity
          call={call}
          subtitle={
            isVideo
              ? 'Necesitamos permiso de micrófono y cámara para la videollamada. Actívalos en los ajustes del teléfono.'
              : 'Necesitamos permiso de micrófono para la llamada. Actívalo en los ajustes del teléfono.'
          }
        />
        <View style={styles.actions}>
          <RoundButton label="Colgar" tone="danger" onPress={onHangUp}>
            <View style={styles.hangIcon}>
              <Icon name="phone" size={26} color="#ffffff" />
            </View>
          </RoundButton>
        </View>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={access.url}
      token={access.token}
      connect
      audio
      video={isVideo}
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={onHangUp}
      onError={() => onHangUp()}
    >
      <RoomView call={call} onHangUp={onHangUp} />
    </LiveKitRoom>
  );
}

export function CallScreen({ session, onAccept, onHangUp }: Props) {
  const { call, access, phase } = session;
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onHangUp}>
      <View style={styles.root}>
        {phase === 'incoming' ? (
          <Incoming call={call} onAccept={onAccept} onHangUp={onHangUp} />
        ) : phase === 'outgoing' || !access ? (
          <Outgoing call={call} onHangUp={onHangUp} />
        ) : (
          <Active call={call} access={access} onHangUp={onHangUp} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[6] },
  identity: { alignItems: 'center', gap: space[3] },
  name: { fontSize: fontSize.headlineSm, fontWeight: '700', color: '#ffffff' },
  subtitle: { fontSize: fontSize.bodyMd, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: space[8], marginTop: space[8] },
  action: { alignItems: 'center', gap: space[2] },
  actionLabel: { fontSize: fontSize.labelMd, color: 'rgba(255,255,255,0.7)' },
  round: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  // El auricular del icono apunta hacia arriba; para «colgar» se gira como en cualquier teléfono.
  hangIcon: { transform: [{ rotate: '135deg' }] },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: space[6], paddingTop: space[3] },
  clock: {
    position: 'absolute',
    left: space[3],
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    fontSize: fontSize.labelLg,
  },
  pip: {
    position: 'absolute',
    right: space[3],
    bottom: space[3],
    width: 104,
    height: 144,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#262626',
  },
});
