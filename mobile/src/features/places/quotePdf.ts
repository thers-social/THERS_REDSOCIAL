import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { request } from '@shared/lib/api';

/** Bytes de un PDF válido empiezan por «%PDF». */
function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Descarga el PDF de una cotización (ADR-040 fase 11) y abre el menú de compartir de Android para
 * guardarlo o enviarlo. El servidor lo arma con los importes ya guardados; la app no calcula nada.
 * El archivo queda en la caché de la app, no en una carpeta pública.
 */
export async function shareQuotePdf(quoteId: string): Promise<void> {
  await sharePdf(`/quotes/${quoteId}/pdf`, `cotizacion-${quoteId.slice(0, 8)}.pdf`, 'Cotización en PDF');
}

/** Comprobante de una reserva propia en PDF (`ADR-052`), con el mismo menú de compartir. */
export async function shareReservationPdf(reservationId: string): Promise<void> {
  await sharePdf(`/reservations/${reservationId}/pdf`, `reserva-${reservationId.slice(0, 8)}.pdf`, 'Reserva en PDF');
}

async function sharePdf(path: string, fileName: string, dialogTitle: string): Promise<void> {
  const bytes = await request<Uint8Array>(path, {
    authenticated: true,
    binary: true,
    timeoutMs: 30000,
  });
  if (!isPdf(bytes)) throw new Error('El servidor no devolvió un PDF válido.');

  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(bytes);

  if (!(await Sharing.isAvailableAsync())) throw new Error('Este dispositivo no puede compartir archivos.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle });
}
