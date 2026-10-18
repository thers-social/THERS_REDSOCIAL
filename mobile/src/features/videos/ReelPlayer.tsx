import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';

import { radius } from '@shared/design/tokens';

type Props = { hlsUrl: string; label: string };

/**
 * Reproductor de un Reel (HLS firmado por espectador, ADR-043-A) con `expo-video`.
 *
 * Es un módulo NATIVO: exige recompilar la app. NO se ha probado en un teléfono (no hay credenciales
 * de Mux ni dispositivo disponible); solo se verifica el tipado. Se monta únicamente cuando la
 * persona pulsa «Reproducir», así la lista no abre un reproductor por cada tarjeta.
 */
export function ReelPlayer({ hlsUrl, label }: Props) {
  const player = useVideoPlayer({ uri: hlsUrl }, (instance) => {
    instance.loop = true;
    instance.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      contentFit="contain"
      accessibilityLabel={label}
    />
  );
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 9 / 16, borderRadius: radius.card, backgroundColor: '#000' },
});
