import { radius } from '@shared/design/tokens';

/**
 * Forma común de los tres botones de las pantallas de acceso («Entrar», «Crear cuenta» y
 * «Continuar con Google»): píldora de 52 px de alto. Una sola definición para que no se desincronicen.
 *
 * El borde gris claro es solo del botón de Google (guía de marca de Google, fijo y no del tema);
 * «Entrar» y «Crear cuenta» llevan el borde del mismo morado que su fondo.
 */
export const AUTH_BUTTON_BORDER_COLOR = '#DADCE0';
export const AUTH_BUTTON_RADIUS = radius.pill;
export const AUTH_BUTTON_MIN_HEIGHT = 52;
