import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { createPost } from '@features/posts/api';
import { MAX_POST_LENGTH } from '@features/posts/types';
import type { Post } from '@features/posts/types';
import { ProfileLink } from '@features/profile/ProfileLink';
import { colors, fontSize, radius, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';
import { ApiError } from '@shared/lib/api';
import { Avatar } from '@shared/ui/Avatar';
import { Banner } from '@shared/ui/Banner';
import { Button } from '@shared/ui/Button';

import { fetchPlacePosts } from './api';

/**
 * Publicaciones asociadas a un lugar (ADR-040 fase 4d). La lista usa las MISMAS reglas de
 * visibilidad que el feed (cuentas privadas, bloqueos, silenciados): lo decide el servidor.
 * El texto se pinta siempre como `<Text>`. Las fotos se suben desde el flujo normal de publicar.
 */
export function PlacePosts({ placeId }: { placeId: string }) {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setPosts(await fetchPlacePosts(placeId, signal));
        setLoadError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setLoadError(e instanceof ApiError ? e.message : 'No pudimos cargar las publicaciones.');
        setPosts((current) => current ?? []);
      }
    },
    [placeId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function publish() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createPost(content, false, placeId);
      setText('');
      await load();
    } catch (e) {
      // Lo escrito se conserva si falla (perderlo por un fallo de red es lo peor).
      setError(e instanceof ApiError ? e.message : 'No pudimos publicar. Intentá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        Publicaciones en este lugar
      </Text>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Contá algo sobre este lugar"
        placeholderTextColor={colors.fgDisabled}
        multiline
        maxLength={MAX_POST_LENGTH}
        textAlignVertical="top"
        editable={!busy}
        accessibilityLabel="Escribir una publicación sobre este lugar"
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button label="Publicar aquí" onPress={() => void publish()} loading={busy} disabled={!text.trim()} />

      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {posts && posts.length === 0 && !loadError ? (
        <Text style={styles.muted}>Todavía nadie publicó sobre este lugar.</Text>
      ) : null}

      {posts?.map((post) => (
        <Pressable
          key={post.id}
          style={styles.post}
          onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
          accessibilityRole="button"
          accessibilityLabel={`Publicación de ${post.author.name}`}
        >
          <View style={styles.author}>
            <ProfileLink userId={post.author.id} name={post.author.name} style={{ flex: 0 }}>
              <Avatar name={post.author.name} uri={post.author.avatar_url ?? null} size={28} />
              <Text style={styles.authorName} numberOfLines={1}>
                {post.author.name}
              </Text>
            </ProfileLink>
          </View>
          <Text style={styles.body} numberOfLines={5}>
            {post.is_sensitive ? 'Contenido sensible. Tocá para verlo.' : post.content}
          </Text>
          <Text style={styles.meta}>
            {post.likes_count} me gusta · {post.comments_count} comentarios
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginTop: space[6], gap: space[3] },
  title: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.fg },
  muted: { fontSize: fontSize.bodyMd, color: colors.fgMuted },
  input: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space[3],
    fontSize: fontSize.bodyMd,
    color: colors.fg,
  },
  post: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  author: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  authorName: { flex: 1, fontSize: fontSize.labelLg, fontWeight: '700', color: colors.fg },
  body: { fontSize: fontSize.bodyMd, color: colors.fg, lineHeight: 21 },
  meta: { fontSize: fontSize.labelLg, color: colors.fgMuted },
}));
