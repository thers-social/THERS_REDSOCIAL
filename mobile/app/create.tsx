import { useRouter } from 'expo-router';

import { useAuth } from '@features/auth/context/AuthContext';
import { Composer } from '@features/posts/Composer';
import { messageOf, usePosts } from '@features/posts/PostsContext';
import { Screen } from '@shared/ui/Screen';
import { Banner } from '@shared/ui/Banner';

/**
 * Crear (T-Rayo): reutiliza el `Composer` y el `create` de `PostsContext` que ya
 * usa Inicio; no hay un segundo camino de publicación. Al publicar se vuelve.
 */
export default function Create() {
  const { user } = useAuth();
  const posts = usePosts();
  const router = useRouter();

  if (!user) return null;

  return (
    <Screen title="Crear" back>
      {user.profile_completed ? (
        <Composer
          onPublish={async (content, sensitive) => {
            try {
              await posts.create(content, sensitive);
            } catch (e) {
              throw new Error(messageOf(e));
            }
            router.back();
          }}
        />
      ) : (
        <Banner tone="info">
          Completa tu perfil, incluida tu fecha de nacimiento, para publicar. Puedes hacerlo desde la
          web de THERS.
        </Banner>
      )}
    </Screen>
  );
}
