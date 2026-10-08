import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'home'
  | 'reels'
  | 'messages'
  | 'profile'
  | 'search'
  | 'bell'
  | 'heart'
  | 'comment'
  | 'share'
  | 'bookmark'
  | 'filter'
  | 'group'
  | 'more'
  | 'chevron'
  | 'plus'
  | 'lock'
  | 'block'
  | 'devices'
  | 'trash'
  | 'logout'
  | 'at'
  | 'settings'
  | 'star'
  | 'image'
  | 'sparkle'
  | 'clock'
  | 'activity'
  | 'globe'
  | 'camera'
  | 'archive'
  | 'link'
  | 'grid'
  | 'userAdd';

type Props = {
  name: IconName;
  size?: number;
  color: ColorValue;
  /** Relleno sólido (estado activo de la barra inferior, me gusta). */
  filled?: boolean;
};

const FILLABLE: IconName[] = ['home', 'messages', 'heart', 'bookmark', 'star'];

/**
 * Iconos de línea de THERS (viewBox 24x24, trazo 2). Dibujados a mano para no
 * sumar una biblioteca de iconos; si el catálogo crece, este es el único lugar
 * que se amplía. Decorativos: quien los usa pone la etiqueta accesible.
 */
export function Icon({ name, size = 24, color, filled = false }: Props) {
  const tint = String(color);
  const stroke = {
    stroke: tint,
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: filled && FILLABLE.includes(name) ? tint : 'none',
  } as const;
  const line = { ...stroke, fill: 'none' } as const;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {name === 'home' ? (
        <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" {...stroke} />
      ) : null}
      {name === 'reels' ? (
        <>
          <Rect x="3" y="3" width="18" height="18" rx="4" {...line} />
          <Path d="M10 8.5v7l6-3.5z" {...line} />
        </>
      ) : null}
      {name === 'messages' ? (
        <Path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" {...stroke} />
      ) : null}
      {name === 'profile' ? (
        <>
          <Circle cx="12" cy="8" r="4" {...line} />
          <Path d="M4 21a8 8 0 0 1 16 0" {...line} />
        </>
      ) : null}
      {name === 'search' ? (
        <>
          <Circle cx="11" cy="11" r="7" {...line} />
          <Path d="M16.5 16.5 21 21" {...line} />
        </>
      ) : null}
      {name === 'bell' ? (
        <>
          <Path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16z" {...line} />
          <Path d="M10 21h4" {...line} />
        </>
      ) : null}
      {name === 'heart' ? (
        <Path d="M12 20.5 4.3 12.9a4.7 4.7 0 0 1 6.6-6.7L12 7.3l1.1-1.1a4.7 4.7 0 0 1 6.6 6.7z" {...stroke} />
      ) : null}
      {name === 'comment' ? <Path d="M4 5h16v11H9l-5 4z" {...line} /> : null}
      {name === 'share' ? <Path d="M21 3 3 10.5l7 3 3 7zM10 13.5 21 3" {...line} /> : null}
      {name === 'bookmark' ? <Path d="M6 3h12v18l-6-4-6 4z" {...stroke} /> : null}
      {name === 'filter' ? <Path d="M3 5h18l-7 8v6l-4-2v-4z" {...line} /> : null}
      {name === 'group' ? (
        <>
          <Circle cx="9" cy="8" r="3" {...line} />
          <Path d="M3 20a6 6 0 0 1 12 0" {...line} />
          <Path d="M16 5.5a3 3 0 0 1 0 5.5M18 20a6 6 0 0 0-3-5.2" {...line} />
        </>
      ) : null}
      {name === 'more' ? (
        <>
          <Circle cx="5" cy="12" r="1.5" fill={tint} />
          <Circle cx="12" cy="12" r="1.5" fill={tint} />
          <Circle cx="19" cy="12" r="1.5" fill={tint} />
        </>
      ) : null}
      {name === 'chevron' ? <Path d="m9 6 6 6-6 6" {...line} /> : null}
      {name === 'plus' ? <Path d="M12 5v14M5 12h14" {...line} /> : null}
      {name === 'lock' ? (
        <>
          <Rect x="5" y="11" width="14" height="10" rx="2" {...line} />
          <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...line} />
        </>
      ) : null}
      {name === 'block' ? (
        <>
          <Circle cx="12" cy="12" r="9" {...line} />
          <Path d="m5.6 5.6 12.8 12.8" {...line} />
        </>
      ) : null}
      {name === 'devices' ? (
        <>
          <Rect x="7" y="3" width="10" height="18" rx="2" {...line} />
          <Path d="M11 18h2" {...line} />
        </>
      ) : null}
      {name === 'trash' ? (
        <Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" {...line} />
      ) : null}
      {name === 'logout' ? <Path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" {...line} /> : null}
      {name === 'at' ? (
        <>
          <Circle cx="12" cy="12" r="4" {...line} />
          <Path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" {...line} />
        </>
      ) : null}
      {name === 'settings' ? (
        <>
          <Path d="M4 7h10M18 7h2M4 17h2M10 17h10" {...line} />
          <Circle cx="16" cy="7" r="2" {...line} />
          <Circle cx="8" cy="17" r="2" {...line} />
        </>
      ) : null}
      {name === 'star' ? (
        <Path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" {...stroke} />
      ) : null}
      {name === 'image' ? (
        <>
          <Rect x="3" y="4" width="18" height="16" rx="2" {...line} />
          <Circle cx="9" cy="10" r="1.5" {...line} />
          <Path d="m21 16-5-5-8 8" {...line} />
        </>
      ) : null}
      {name === 'sparkle' ? (
        <Path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" {...line} />
      ) : null}
      {name === 'clock' ? (
        <>
          <Circle cx="12" cy="12" r="9" {...line} />
          <Path d="M12 7v5l3 2" {...line} />
        </>
      ) : null}
      {name === 'activity' ? <Path d="m3 17 5-5 4 4 8-9" {...line} /> : null}
      {name === 'globe' ? (
        <>
          <Circle cx="12" cy="12" r="9" {...line} />
          <Path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" {...line} />
        </>
      ) : null}
      {name === 'camera' ? (
        <>
          <Rect x="3" y="7" width="18" height="13" rx="2" {...line} />
          <Circle cx="12" cy="13" r="3.5" {...line} />
          <Path d="m8 7 1.5-3h5L16 7" {...line} />
        </>
      ) : null}
      {name === 'archive' ? (
        <>
          <Rect x="3" y="4" width="18" height="5" rx="1" {...line} />
          <Path d="M5 9v10h14V9M10 13h4" {...line} />
        </>
      ) : null}
      {name === 'link' ? (
        <Path
          d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
          {...line}
        />
      ) : null}
      {name === 'grid' ? (
        <>
          <Rect x="4" y="4" width="7" height="7" rx="1" {...line} />
          <Rect x="13" y="4" width="7" height="7" rx="1" {...line} />
          <Rect x="4" y="13" width="7" height="7" rx="1" {...line} />
          <Rect x="13" y="13" width="7" height="7" rx="1" {...line} />
        </>
      ) : null}
      {name === 'userAdd' ? (
        <>
          <Circle cx="9" cy="8" r="4" {...line} />
          <Path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" {...line} />
        </>
      ) : null}
    </Svg>
  );
}
