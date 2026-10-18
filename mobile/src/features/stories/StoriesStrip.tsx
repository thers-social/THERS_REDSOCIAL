import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { Avatar } from '@shared/ui/Avatar';
import { Icon } from '@shared/ui/Icon';

import { ApiError } from '@shared/lib/api';

import { fetchStrip } from './api';
import type { PickedImage } from './api';
import { StoryComposerModal } from './StoryComposerModal';
import { StoryViewerModal } from './StoryViewerModal';
import type { StripAuthor } from './types';

type Props = {
  me: { name: string; avatar_url?: string | null };
  /** Con el perfil incompleto no se puede publicar (compuerta de edad, ADR-034). */
  canPublish: boolean;
};

/**
 * Tira de historias del inicio (ADR-042): «Tu historia» con «+» para publicar, seguida de las
 * personas con historias vigentes que puedes ver. Todo viene de `GET /api/stories`; sin
 * historias lo dice, no inventa nada.
 */
export function StoriesStrip({ me, canPublish }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'disabled'>('loading');
  const [authors, setAuthors] = useState<StripAuthor[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [picked, setPicked] = useState<PickedImage | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setAuthors(await fetchStrip(signal));
      setStatus('ready');
    } catch (error) {
      if (signal?.aborted) return;
      // 404 = el módulo está apagado en el servidor (STORIES_ENABLED, ADR-042 §11): no hay
      // historias, así que la tira se oculta, sin error ni botón de crear.
      setStatus(error instanceof ApiError && error.status === 404 ? 'disabled' : 'error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function pickImage() {
    if (!canPublish) {
      Alert.alert('Completa tu perfil', 'Necesitas completar tu perfil, incluida tu fecha de nacimiento, para publicar.');
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Permite el acceso a tus fotos para elegir la imagen de una historia.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      // Reduce la foto del teléfono antes de subirla; el servidor la vuelve a validar.
      allowsEditing: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setPicked({ uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName });
  }

  if (status === 'disabled') return null;

  const myIndex = authors.findIndex((item) => item.is_me);
  const others = authors.map((item, index) => ({ item, index })).filter(({ item }) => !item.is_me);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable
          onPress={() => (myIndex >= 0 ? setViewerIndex(myIndex) : pickImage())}
          style={styles.story}
          accessibilityRole="button"
          accessibilityLabel={myIndex >= 0 ? 'Ver tu historia' : 'Crear una historia'}
        >
          <View style={myIndex >= 0 ? styles.ringSeen : undefined}>
            <Avatar name={me.name} uri={me.avatar_url} size={56} />
          </View>
          <Pressable
            onPress={pickImage}
            style={styles.plus}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Agregar una historia"
          >
            <Icon name="plus" size={12} color={colors.onBrand} />
          </Pressable>
          <Text style={styles.label} numberOfLines={1}>
            Tu historia
          </Text>
        </Pressable>

        {others.map(({ item, index }) => (
          <Pressable
            key={item.author.id}
            onPress={() => setViewerIndex(index)}
            style={styles.story}
            accessibilityRole="button"
            accessibilityLabel={`Ver las historias de ${item.author.name}${item.has_unseen ? ' (sin ver)' : ''}`}
          >
            <View style={item.has_unseen ? styles.ringUnseen : styles.ringSeen}>
              {item.latest_image_url ? (
                <Image source={{ uri: item.latest_image_url }} style={styles.thumb} accessibilityIgnoresInvertColors />
              ) : (
                <Avatar name={item.author.name} uri={item.author.avatar_url} size={56} />
              )}
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {item.author.name}
            </Text>
          </Pressable>
        ))}

        {status === 'loading' ? <ActivityIndicator style={styles.state} color={colors.brand} /> : null}
      </ScrollView>

      {status === 'error' ? (
        <Pressable onPress={() => load()} accessibilityRole="button">
          <Text style={styles.hint}>No se pudieron cargar las historias. Toca para reintentar.</Text>
        </Pressable>
      ) : null}
      {status === 'ready' && authors.length === 0 ? (
        <Text style={styles.hint}>Nadie a quien sigues tiene historias ahora.</Text>
      ) : null}

      {viewerIndex !== null ? (
        <StoryViewerModal
          authors={authors}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onChanged={() => load()}
        />
      ) : null}
      {picked ? (
        <StoryComposerModal image={picked} onClose={() => setPicked(null)} onPublished={() => load()} />
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { paddingBottom: space[3], gap: space[3] },
  story: { alignItems: 'center', width: 72 },
  ringUnseen: { padding: 2, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.brand },
  ringSeen: { padding: 2, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.border },
  thumb: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.bgSubtle },
  plus: {
    position: 'absolute',
    right: 4,
    top: 38,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: fontSize.labelSm, color: colors.fgMuted, marginTop: space[1] },
  state: { alignSelf: 'center', marginLeft: space[3] },
  hint: { fontSize: fontSize.labelMd, color: colors.fgMuted, marginBottom: space[3] },
}));
