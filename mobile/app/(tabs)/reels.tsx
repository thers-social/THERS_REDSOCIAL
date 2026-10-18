import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import { ApiError } from '@shared/lib/api';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';
import { deleteVideo, fetchFeed, fetchMine, reserveUpload, uploadToMux } from '@features/videos/api';
import { ReelPlayer } from '@features/videos/ReelPlayer';
import {
  POLL_INTERVAL_MS,
  canPlay,
  isInProgress,
  makeIdempotencyKey,
  mergeVideos,
  statusText,
  uploadErrorMessage,
  validatePicked,
} from '@features/videos/reelsLogic';
import type { ReelVideo } from '@features/videos/types';

/**
 * Reels (ADR-043, ADR-043-A). Con el módulo apagado en el servidor (`VIDEOS_ENABLED`, por defecto) la
 * API responde 404 y la pestaña muestra «Próximamente», igual que antes. La subida pública sigue
 * bloqueada por D3: solo las cuentas de la lista de prueba pueden subir; para el resto el servidor
 * responde 404 a la reserva. Nada de esto concede permisos: el servidor lo comprueba siempre.
 *
 * Reproducción con `expo-video` (módulo nativo, requiere recompilar): sin verificar en teléfono.
 */
export default function Reels() {
  const [state, setState] = useState<'loading' | 'ready' | 'off' | 'error'>('loading');
  const [feed, setFeed] = useState<ReelVideo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [mine, setMine] = useState<ReelVideo[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadUnavailable, setUploadUnavailable] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      setMine(await fetchMine());
    } catch {
      /* secundario */
    }
  }, []);

  const loadFeed = useCallback(async (offset = 0) => {
    try {
      const data = await fetchFeed(offset);
      setFeed((current) => (offset ? mergeVideos(current, data.videos) : data.videos));
      setHasMore(data.has_more);
      setState('ready');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'off' : 'error');
    }
  }, []);

  useEffect(() => {
    void loadFeed();
    void loadMine();
  }, [loadFeed, loadMine]);

  useEffect(() => {
    if (!mine.some(isInProgress)) return undefined;
    const timer = setInterval(() => void loadMine(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [mine, loadMine]);

  async function pickAndUpload() {
    if (uploading) return;
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
    setUploading(true);
    try {
      const reservation = await reserveUpload('', makeIdempotencyKey());
      if (!reservation.upload_url) throw new Error('upload_failed');
      await uploadToMux(reservation.upload_url, asset.uri);
      Alert.alert('Video subido', 'Lo estamos procesando. Se publica cuando lo aprueba el equipo.');
      void loadMine();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setUploadUnavailable(true);
      Alert.alert(
        'No se pudo subir el video',
        e instanceof ApiError ? uploadErrorMessage(e.status, e.message) : uploadErrorMessage(undefined),
      );
    } finally {
      setUploading(false);
    }
  }

  async function remove(video: ReelVideo) {
    try {
      await deleteVideo(video.id);
      setMine((current) => current.filter((v) => v.id !== video.id));
      setFeed((current) => current.filter((v) => v.id !== video.id));
    } catch {
      Alert.alert('No se pudo borrar el Reel');
    }
  }

  if (state === 'loading') {
    return (
      <Screen title="Reels" scroll={false} withBottomInset={false}>
        <StateMessage kind="loading" />
      </Screen>
    );
  }
  if (state === 'off') {
    return (
      <Screen title="Reels" scroll={false} withBottomInset={false}>
        <StateMessage kind="empty" title="Próximamente" message="Reels, el video vertical de THERS, llegará pronto." />
      </Screen>
    );
  }
  if (state === 'error') {
    return (
      <Screen title="Reels" scroll={false} withBottomInset={false}>
        <StateMessage kind="error" title="No se pudieron cargar los Reels" actionLabel="Reintentar" onAction={() => void loadFeed()} />
      </Screen>
    );
  }

  return (
    <Screen title="Reels" scroll={false} withBottomInset={false}>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {!uploadUnavailable && (
              <Pressable onPress={pickAndUpload} disabled={uploading} style={[styles.upload, uploading && styles.disabled]} accessibilityRole="button">
                {uploading ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.uploadText}>Subir un Reel</Text>}
              </Pressable>
            )}
            {mine.map((video) => (
              <View key={video.id} style={styles.mine}>
                <View style={styles.mineText}>
                  <Text style={styles.mineTitle}>{video.caption || 'Sin texto'}</Text>
                  <Text style={styles.mineStatus}>{statusText(video)}</Text>
                </View>
                <Pressable onPress={() => void remove(video)} accessibilityRole="button" accessibilityLabel="Borrar Reel">
                  <Text style={styles.delete}>Borrar</Text>
                </Pressable>
              </View>
            ))}
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Todavía no hay Reels para mostrar.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.author}>@{item.author.username}</Text>
            {canPlay(item) && item.playback ? (
              playing === item.id ? (
                <ReelPlayer hlsUrl={item.playback.hls_url} label={item.caption || 'Reel'} />
              ) : (
                <Pressable onPress={() => setPlaying(item.id)} style={styles.play} accessibilityRole="button" accessibilityLabel="Reproducir Reel">
                  <Text style={styles.playText}>▶ Reproducir</Text>
                </Pressable>
              )
            ) : (
              <Text style={styles.empty}>No disponible.</Text>
            )}
            {item.caption ? <Text style={styles.caption}>{item.caption}</Text> : null}
          </View>
        )}
        onEndReached={() => hasMore && void loadFeed(feed.length)}
        onEndReachedThreshold={0.5}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  list: { padding: space[4], gap: space[4] },
  header: { gap: space[2] },
  upload: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: space[2], alignItems: 'center' as const },
  uploadText: { color: colors.onBrand, fontSize: fontSize.bodyMd, fontWeight: '700' as const },
  disabled: { opacity: 0.5 },
  mine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space[2], paddingVertical: space[1] },
  mineText: { flex: 1 },
  mineTitle: { color: colors.fg, fontSize: fontSize.bodyMd, fontWeight: '600' as const },
  mineStatus: { color: colors.fgMuted, fontSize: fontSize.bodySm },
  delete: { color: colors.dangerFg, fontSize: fontSize.bodySm, fontWeight: '600' as const },
  card: { gap: space[1] },
  author: { color: colors.fg, fontSize: fontSize.bodySm, fontWeight: '700' as const },
  caption: { color: colors.fg, fontSize: fontSize.bodyMd },
  play: { aspectRatio: 9 / 16, backgroundColor: '#000', borderRadius: radius.card, alignItems: 'center' as const, justifyContent: 'center' as const },
  playText: { color: '#fff', fontSize: fontSize.bodyLg, fontWeight: '700' as const },
  empty: { color: colors.fgMuted, fontSize: fontSize.bodyMd, textAlign: 'center' as const, padding: space[4] },
}));
