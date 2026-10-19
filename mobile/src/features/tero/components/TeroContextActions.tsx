import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import type { Post } from '@features/posts/types';
import { setPostSaved } from '@features/posts/api';
import { ApiError } from '@shared/lib/api';
import { ActionSheet } from '@shared/ui/ActionSheet';
import type { SheetAction } from '@shared/ui/ActionSheet';

type Target = { post: Post; isOwn: boolean };

/**
 * Acciones de Tero sobre una publicación («Preguntar a Tero…» en el menú «⋯»).
 * Reutiliza `ActionSheet` y, para «Reportar», el `ReportModal` que el menú ya
 * tiene (`onReport`), en vez de abrir uno propio.
 *
 * «Ver autor» abre su perfil y «Guardar» usa `POST /api/posts/<id>/save` (ADR-047).
 */
export function useTeroPostActions(onReport: (post: Post) => void): {
  open: (post: Post, isOwn: boolean) => void;
  element: ReactElement;
} {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);

  const open = useCallback((post: Post, isOwn: boolean) => setTarget({ post, isOwn }), []);

  const actions: SheetAction[] = !target
    ? []
    : [
        {
          label: 'Resumir publicación',
          onPress: () => router.push({ pathname: '/tero/chat', params: { postId: target.post.id } }),
        },
        ...(target.isOwn
          ? []
          : [
              {
                label: `Ver a @${target.post.author.username}`,
                onPress: () =>
                  router.push({ pathname: '/user/[userId]', params: { userId: target.post.author.id } }),
              },
              {
                label: 'Guardar',
                onPress: () => {
                  setPostSaved(target.post.id, true)
                    .then(() => Alert.alert('Guardada', 'La encuentras en Configuración > Guardado.'))
                    .catch((e) =>
                      Alert.alert('No se pudo guardar', e instanceof ApiError ? e.message : 'Inténtalo de nuevo.'),
                    );
                },
              },
              { label: 'Reportar', destructive: true, onPress: () => onReport(target.post) },
            ]),
      ];

  const element = (
    <ActionSheet
      visible={target !== null}
      title="Tero"
      actions={actions}
      onClose={() => setTarget(null)}
    />
  );

  return { open, element };
}
