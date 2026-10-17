/**
 * Datos de EJEMPLO de la fase 1. Toda pantalla que los muestre lo dice
 * (`isMock`): no se presentan como actividad real de la persona.
 */

import type { TeroSummary } from '../types';

export const mockSummary: TeroSummary = {
  periodLabel: 'Últimos 7 días',
  isMock: true,
  metrics: [
    { id: 'views', label: 'Visitas al perfil', value: 128, delta: 12 },
    { id: 'likes', label: 'Me gusta recibidos', value: 46, delta: 8 },
    { id: 'comments', label: 'Comentarios', value: 9, delta: -3 },
    { id: 'followers', label: 'Nuevos seguidores', value: 5, delta: 25 },
  ],
  highlights: [
    'Tu publicación más vista recibió la mitad de tus me gusta de la semana.',
    'Tres personas que sigues publicaron por primera vez en días.',
    'Tienes avisos sin leer de esta semana.',
  ],
};
