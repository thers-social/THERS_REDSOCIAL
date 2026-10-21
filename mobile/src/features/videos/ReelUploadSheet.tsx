import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@shared/lib/api';
import { Icon } from '@shared/ui/Icon';

import { deleteVideo, reserveUpload, uploadToMux } from './api';
import {
  MAX_CAPTION,
  makeIdempotencyKey,
  statusText,
  uploadErrorMessage,
  validateCaption,
  validatePicked,
} from './reelsLogic';
import type { ReelVideo } from './types';

type Picked = { uri: string; name: string };

type Props = {
  mine: ReelVideo[];
  onClose: () => void;
  /** Refresca «mis Reels» (y el feed) después de subir o borrar. */
  onChanged: () => void;
  onDeleted: (id: string) => void;
};

/**
 * Hoja para subir un Reel y administrar los propios (ADR-043-A). El archivo va DIRECTO a Mux; aquí se
 * valida solo por comodidad (el servidor lo repite todo). Cada fallo se muestra con su causa real, no con
 * un mensaje genérico.
 */
export function ReelUploadSheet({ mine, onClose, onChanged, onDeleted }: Props) {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<'idle' | 'reserving' | 'uploading'>('idle');
  // La clave se conserva entre reintentos: repetir la reserva no abre otra subida en Mux.
  const [idempotencyKey, setIdempotencyKey] = useState(() => makeIdempotencyKey());

  async function pick() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Permite el acceso a tu galería para elegir un video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 60,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const problem = validatePicked({ size: asset.fileSize, mimeType: asset.mimeType, duration: asset.duration });
    if (problem) {
      Alert.alert('No se puede subir', problem);
      return;
    }
    setPicked({ uri: asset.uri, name: asset.fileName ?? 'video' });
    setIdempotencyKey(makeIdempotencyKey());
  }

  async function submit() {
    if (!picked || busy !== 'idle') return;
    const captionProblem = validateCaption(caption);
    if (captionProblem) {
      Alert.alert('Revisa el texto', captionProblem);
      return;
    }
    let step: 'reserving' | 'uploading' = 'reserving';
    setBusy('reserving');
    try {
      const reservation = await reserveUpload(caption, idempotencyKey);
      if (!reservation.upload_url) throw new Error('upload_failed');
      step = 'uploading';
      setBusy('uploading');
      await uploadToMux(reservation.upload_url, picked.uri);
      Alert.alert('Video subido', 'Lo estamos procesando. Se publica en cuanto esté listo.');
      setPicked(null);
      setCaption('');
      onChanged();
    } catch (error) {
      // Dos fallos distintos: la reserva en nuestra API (con su estado HTTP) o el envío del archivo a Mux.
      const message =
        error instanceof ApiError
          ? uploadErrorMessage(error.status, error.message)
          : step === 'uploading'
            ? 'El video no llegó al servicio de video. Revisa tu conexión y vuelve a intentarlo.'
            : uploadErrorMessage(undefined);
      Alert.alert('No se pudo subir el video', message);
    } finally {
      setBusy('idle');
    }
  }

  function confirmDelete(video: ReelVideo) {
    Alert.alert('¿Borrar este Reel?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteVideo(video.id);
            onDeleted(video.id);
          } catch {
            Alert.alert('No se pudo borrar el Reel');
          }
        },
      },
    ]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={busy === 'idle' ? onClose : undefined} accessibilityLabel="Cerrar" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.head}>
            <Text style={styles.title}>Tus Reels</Text>
            <Pressable onPress={onClose} disabled={busy !== 'idle'} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}>
              <Icon name="close" size={22} color="#ffffff" />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Pressable onPress={() => void pick()} disabled={busy !== 'idle'} style={styles.pick} accessibilityRole="button">
              <Icon name="video" size={22} color="#ffffff" />
              <Text style={styles.pickText}>{picked ? `Elegido: ${picked.name}` : 'Elegir un video de la galería'}</Text>
            </Pressable>
            <Text style={styles.hint}>Hasta 60 segundos y 100 MB. Mejor en vertical.</Text>

            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Escribe un texto (opcional)"
              placeholderTextColor="#9ca3af"
              maxLength={MAX_CAPTION}
              multiline
              editable={busy === 'idle'}
              style={styles.input}
              accessibilityLabel="Texto del Reel"
            />

            <Pressable
              onPress={() => void submit()}
              disabled={!picked || busy !== 'idle'}
              accessibilityRole="button"
              style={[styles.submit, (!picked || busy !== 'idle') && styles.submitOff]}
            >
              {busy === 'idle' ? (
                <Text style={styles.submitText}>Subir Reel</Text>
              ) : (
                <View style={styles.busy}>
                  <ActivityIndicator color="#ffffff" />
                  <Text style={styles.submitText}>{busy === 'reserving' ? 'Preparando…' : 'Subiendo… no cierres la app'}</Text>
                </View>
              )}
            </Pressable>

            {mine.length ? <Text style={styles.section}>Tus videos</Text> : null}
            {mine.map((video) => (
              <View key={video.id} style={styles.mine}>
                <View style={styles.mineText}>
                  <Text style={styles.mineTitle} numberOfLines={1}>
                    {video.caption || 'Sin texto'}
                  </Text>
                  <Text style={styles.mineStatus}>{statusText(video)}</Text>
                </View>
                <Pressable onPress={() => confirmDelete(video)} accessibilityRole="button" accessibilityLabel="Borrar Reel" hitSlop={8}>
                  <Text style={styles.delete}>Borrar</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { maxHeight: '85%', backgroundColor: '#18181b', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#27272a', borderRadius: 12, padding: 14 },
  pickText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  hint: { color: '#9ca3af', fontSize: 12 },
  input: { color: '#fff', backgroundColor: '#27272a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 64, textAlignVertical: 'top' },
  submit: { backgroundColor: '#7c3aed', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  submitOff: { opacity: 0.45 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  section: { color: '#d4d4d8', fontSize: 13, fontWeight: '700', marginTop: 8 },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  mineText: { flex: 1 },
  mineTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  mineStatus: { color: '#9ca3af', fontSize: 12 },
  delete: { color: '#fca5a5', fontSize: 13, fontWeight: '700' },
});
