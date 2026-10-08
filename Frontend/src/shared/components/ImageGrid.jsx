import { useEffect, useState } from "react";
import Icon from "@shared/components/Icon";

/**
 * Imágenes de una publicación o de un mensaje (ADR-039), con visor al tocarlas.
 *
 * `images`: `[{ url, width, height }]` tal como las entrega la API. Las
 * dimensiones reservan el espacio antes de que cargue la imagen, para que el
 * feed no salte al ir apareciendo las fotos (Core Web Vitals, CLS).
 *
 * `compact`: miniaturas más pequeñas, para dentro de una burbuja de chat.
 */
export default function ImageGrid({ images, alt = "Imagen adjunta", compact = false }) {
  const [openIndex, setOpenIndex] = useState(null);

  if (!images || images.length === 0) return null;

  const count = images.length;
  const maxWidth = compact ? "max-w-[16rem]" : "max-w-full";

  return (
    <>
      <div
        className={`grid gap-1 overflow-hidden rounded-2xl border border-th-border ${maxWidth} ${
          count === 1 ? "grid-cols-1" : "grid-cols-2"
        }`}
      >
        {images.map((image, index) => {
          // Una sola imagen conserva su proporción (con tope de alto); varias se
          // recortan a cuadrados parejos, y la primera de tres ocupa dos columnas.
          const single = count === 1;
          const wide = count === 3 && index === 0;
          return (
            <button
              key={image.url}
              type="button"
              onClick={() => setOpenIndex(index)}
              aria-label={`Ver ${alt.toLowerCase()} ${index + 1} de ${count} en grande`}
              className={`block overflow-hidden bg-th-surface-subtle th-focus-ring ${
                wide ? "col-span-2" : ""
              }`}
            >
              <img
                src={image.url}
                alt={`${alt} ${index + 1} de ${count}`}
                width={image.width}
                height={image.height}
                loading="lazy"
                decoding="async"
                style={single ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
                className={`w-full object-cover ${
                  single
                    ? compact
                      ? "max-h-64"
                      : "max-h-[32rem]"
                    : wide
                      ? "aspect-video"
                      : "aspect-square"
                }`}
              />
            </button>
          );
        })}
      </div>

      {openIndex !== null && (
        <Lightbox
          images={images}
          index={openIndex}
          alt={alt}
          onChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

function Lightbox({ images, index, alt, onChange, onClose }) {
  const image = images[index];
  const count = images.length;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && index < count - 1) onChange(index + 1);
      if (event.key === "ArrowLeft" && index > 0) onChange(index - 1);
    };
    document.addEventListener("keydown", onKeyDown);
    // Evita que la página de fondo se desplace mientras el visor está abierto.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [index, count, onChange, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} ${index + 1} de ${count}`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 th-focus-ring"
      >
        <Icon name="close" size={24} />
      </button>

      {index > 0 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onChange(index - 1);
          }}
          aria-label="Imagen anterior"
          className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 th-focus-ring"
        >
          <Icon name="chevron_left" size={28} />
        </button>
      )}
      {index < count - 1 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onChange(index + 1);
          }}
          aria-label="Imagen siguiente"
          className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 th-focus-ring"
        >
          <Icon name="chevron_right" size={28} />
        </button>
      )}

      <img
        src={image.url}
        alt={`${alt} ${index + 1} de ${count}`}
        className="max-h-[90vh] max-w-full rounded-lg object-contain"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
