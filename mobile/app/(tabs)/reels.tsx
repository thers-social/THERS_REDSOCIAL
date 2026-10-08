import { Screen } from '@shared/ui/Screen';
import { StateMessage } from '@shared/ui/StateMessage';

/**
 * Reels: marcador honesto. El backend no tiene video (publicaciones solo de
 * texto, `ADR-004`), así que no hay nada real que mostrar y no se inventa
 * contenido. Se habilita cuando exista el ADR de medios.
 */
export default function Reels() {
  return (
    <Screen title="Reels" scroll={false} withBottomInset={false}>
      <StateMessage
        kind="empty"
        title="Próximamente"
        message="Reels, el video vertical de THERS, llegará pronto."
      />
    </Screen>
  );
}
