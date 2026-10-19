import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Modal, Pressable, useWindowDimensions } from 'react-native';

import { themedStyles } from '@shared/design/theme';
import { colors } from '@shared/design/tokens';

import { Avatar } from './Avatar';

type Props = { name: string; uri?: string | null; size?: number };

/**
 * Foto de perfil que se agranda al tocarla, como en Instagram: círculo grande sobre un fondo oscuro.
 * Se cierra tocando en cualquier parte o con «Atrás». Sin foto (solo la inicial) no hay nada que
 * agrandar, así que se dibuja un avatar normal y no un botón que no hace nada.
 */
export function ZoomableAvatar({ name, uri, size = 88 }: Props) {
  const [open, setOpen] = useState(false);

  if (!uri) return <Avatar name={name} uri={uri} size={size} />;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Ver la foto de ${name} en grande`}
      >
        <Avatar name={name} uri={uri} size={size} />
      </Pressable>
      <AvatarViewer visible={open} name={name} uri={uri} onClose={() => setOpen(false)} />
    </>
  );
}

function AvatarViewer({
  visible,
  name,
  uri,
  onClose,
}: {
  visible: boolean;
  name: string;
  uri: string;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const diameter = Math.min(width - 48, 420);
  const scale = useRef(new Animated.Value(0.6)).current;

  // El zoom parte de más pequeño cada vez que se abre.
  useEffect(() => {
    if (!visible) return;
    scale.setValue(0.6);
    Animated.spring(scale, { toValue: 1, friction: 8, tension: 70, useNativeDriver: true }).start();
  }, [visible, scale]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cerrar la foto"
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <Image
            source={{ uri }}
            style={[styles.photo, { width: diameter, height: diameter, borderRadius: diameter / 2 }]}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            accessibilityLabel={`Foto de ${name}`}
          />
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  // Fondo oscuro fijo (no del tema): una foto se mira mejor sobre negro, en claro y en oscuro.
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  photo: { backgroundColor: colors.bgSubtle },
}));
