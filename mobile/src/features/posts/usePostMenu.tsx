import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@features/auth/context/AuthContext';
import { blockUser } from '@features/safety/api';
import { ReportModal } from '@features/safety/ReportModal';
import { useTeroPostActions } from '@features/tero/components/TeroContextActions';
import { useTero } from '@features/tero/context/TeroContext';
import { ActionSheet } from '@shared/ui/ActionSheet';
import type { SheetAction } from '@shared/ui/ActionSheet';
import { EditTextModal } from '@shared/ui/EditTextModal';

import { messageOf, usePosts } from './PostsContext';
import { MAX_POST_LENGTH } from './types';
import type { Post } from './types';

/**
 * Menú «⋯» de una publicación y las acciones que cuelgan de él, compartido por
 * Inicio, Buscar, Perfil y el detalle. Devuelve funciones para los botones de la
 * tarjeta y un `element` que la pantalla debe pintar una vez (hoja de acciones,
 * edición y reporte).
 */
export function usePostMenu(): {
  openMenu: (post: Post) => void;
  like: (post: Post) => void;
  follow: (post: Post) => void;
  element: ReactElement;
} {
  const { user } = useAuth();
  const posts = usePosts();
  const router = useRouter();

  const [target, setTarget] = useState<Post | null>(null);
  const [editing, setEditing] = useState<Post | null>(null);
  const [reporting, setReporting] = useState<Post | null>(null);
  const tero = useTero();
  const teroActions = useTeroPostActions(setReporting);

  const fail = useCallback((title: string, error: unknown) => {
    Alert.alert(title, messageOf(error));
  }, []);

  const like = useCallback(
    (post: Post) => {
      posts.toggleLike(post.id).catch((e) => fail('No se pudo actualizar el me gusta', e));
    },
    [posts, fail],
  );

  const follow = useCallback(
    (post: Post) => {
      posts.toggleFollow(post.author.id).catch((e) => fail('No se pudo actualizar el seguimiento', e));
    },
    [posts, fail],
  );

  function confirmDelete(post: Post) {
    Alert.alert(
      'Eliminar publicación',
      'Se eliminará para todas las personas, con sus me gusta y comentarios. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => posts.remove(post.id).catch((e) => fail('No se pudo eliminar', e)),
        },
      ],
    );
  }

  function confirmBlock(post: Post) {
    Alert.alert(
      `¿Bloquear a @${post.author.username}?`,
      'No podrá escribirte ni ver tus publicaciones, y tú dejarás de ver las suyas. Puedes desbloquearla desde tu perfil.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Bloquear',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(post.author.id);
              posts.dropAuthor(post.author.id);
            } catch (e) {
              fail('No se pudo bloquear', e);
            }
          },
        },
      ],
    );
  }

  const postActions: SheetAction[] = !target
    ? []
    : target.author.id === user?.id
      ? [
          { label: 'Editar publicación', onPress: () => setEditing(target) },
          { label: 'Eliminar publicación', destructive: true, onPress: () => confirmDelete(target) },
        ]
      : [
          {
            label: `Enviar mensaje a @${target.author.username}`,
            onPress: () =>
              router.push({
                pathname: '/chat/[userId]',
                params: {
                  userId: target.author.id,
                  name: target.author.name,
                  username: target.author.username,
                  avatar: target.author.avatar_url ?? '',
                },
              }),
          },
          { label: 'Reportar publicación', onPress: () => setReporting(target) },
          {
            label: `Bloquear a @${target.author.username}`,
            destructive: true,
            onPress: () => confirmBlock(target),
          },
        ];

  // Acciones de Tero (vista previa, `EXPO_PUBLIC_TERO_ENABLED`): solo una
  // entrada aquí; el resto vive en `useTeroPostActions`.
  const teroEntry: SheetAction[] =
    tero.enabled && target
      ? [{ label: 'Preguntar a Tero…', onPress: () => teroActions.open(target, target.author.id === user?.id) }]
      : [];

  const actions = [...teroEntry, ...postActions];

  const element = (
    <>
      <ActionSheet
        visible={target !== null}
        title={target ? `Publicación de @${target.author.username}` : undefined}
        actions={actions}
        onClose={() => setTarget(null)}
      />
      <EditTextModal
        visible={editing !== null}
        title="Editar publicación"
        initialValue={editing?.content ?? ''}
        maxLength={MAX_POST_LENGTH}
        onSubmit={async (text) => {
          if (!editing) return;
          try {
            await posts.edit(editing.id, text);
          } catch (e) {
            throw new Error(messageOf(e));
          }
        }}
        onClose={() => setEditing(null)}
      />
      <ReportModal
        visible={reporting !== null}
        targetType="post"
        targetId={reporting?.id ?? ''}
        targetLabel="esta publicación"
        onClose={() => setReporting(null)}
      />
      {teroActions.element}
    </>
  );

  return { openMenu: setTarget, like, follow, element };
}
