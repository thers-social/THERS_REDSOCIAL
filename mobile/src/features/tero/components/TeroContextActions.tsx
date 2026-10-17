import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import type { Post } from '@features/posts/types';
import { comingSoon } from '@shared/lib/comingSoon';
import { ActionSheet } from '@shared/ui/ActionSheet';
import type { SheetAction } from '@shared/ui/ActionSheet';

type Target = { post: Post; isOwn: boolean };

/**
 * Acciones de Tero sobre una publicación («Preguntar a Tero…» en el menú «⋯»).
 * Reutiliza `ActionSheet` y, para «Reportar», el `ReportModal` que el menú ya
 * tiene (`onReport`), en vez de abrir uno propio.
 *
 * «Ver autor» y «Guardar» todavía no tienen pantalla ni servidor en la app
 * móvil: avisan «Próximamente» en lugar de simularlo.
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
              { label: `Ver a @${target.post.author.username}`, onPress: () => comingSoon('Ver perfiles') },
              { label: 'Guardar', onPress: () => comingSoon('Guardar publicaciones') },
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
