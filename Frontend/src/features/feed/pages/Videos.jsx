import Reels from "@features/videos/pages/Reels";

/**
 * Videos y Cortos: Reels (ADR-043, ADR-043-A).
 *
 * Con el módulo apagado en el servidor (por defecto) `Reels` muestra «Próximamente», como esta ruta
 * hacía antes con su marcador. La subida pública sigue bloqueada por D3.
 */
export default function Videos() {
  return <Reels />;
}
