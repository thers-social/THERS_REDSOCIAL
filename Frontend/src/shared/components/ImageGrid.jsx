import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@shared/components/Icon";
import { currentIndex, frameAspect, stepIndex } from "@shared/lib/imageCarousel";

/**
 * Imágenes de una publicación o de un mensaje (ADR-039), con visor al tocarlas.
 *
 * `images`: `[{ url, width, height }]` tal como las entrega la API. Las
 * dimensiones reservan el espacio antes de que cargue la imagen, para que el
 * feed no salte al ir apareciendo las fotos (Core Web Vitals, CLS).
 *
 * Una foto conserva su proporción. Varias (hasta 10) van en un carrusel, como en Instagram: se
 * desplazan con el dedo o el trackpad y con las flechas, y un contador y unos puntos dicen en cuál estás.
 *
 * `compact`: miniaturas más pequeñas, para dentro de una burbuja de chat.
 */
export default function ImageGrid({ images: allImages, alt = "Imagen adjunta", compact = false }) {
  const [openIndex, setOpenIndex] = useState(null);

  if (!allImages || allImages.length === 0) return null;

  // Moderación (ADR-044): una imagen que aún no está aprobada llega SIN URL, solo a quien la subió.
  // No se dibuja; se avisa con una nota en lugar de dejar un hueco roto.
  const images = allImages.filter((image) => image.url);
  const underReview = allImages.length - images.length;
  if (images.length === 0) {
    return (
      <p className="rounded-2xl border border-th-border px-3 py-2 text-sm text-th-text-muted">
        {underReview === 1 ? "Tu imagen está en revisión." : "Tus imágenes están en revisión."}
      </p>
    );
  }

  const count = images.length;
  const maxWidth = compact ? "max-w-[16rem]" : "max-w-full";
  const frame = `${compact ? "rounded-[13px]" : "rounded-2xl border border-th-border"} ${maxWidth}`;

  return (
    <>
      {count === 1 ? (
        <div className={`overflow-hidden ${frame}`}>
          <button
            type="button"
            onClick={() => setOpenIndex(0)}
            aria-label={`Ver ${alt.toLowerCase()} 1 de 1 en grande`}
            className="block w-full overflow-hidden bg-th-surface-subtle th-focus-ring"
          >
            <img
              src={images[0].url}
              alt={`${alt} 1 de 1`}
              width={images[0].width}
              height={images[0].height}
              loading="lazy"
              decoding="async"
              style={{ aspectRatio: `${images[0].width} / ${images[0].height}` }}
              className={`w-full object-cover ${compact ? "max-h-64" : "max-h-[32rem]"}`}
            />
          </button>
        </div>
      ) : (
        <Carousel images={images} alt={alt} className={frame} onOpen={setOpenIndex} />
      )}

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

  // En `document.body` y no dentro de la burbuja: un ancestro con `transform`/animación crea su propio
  // contexto de apilado y deja el visor (aunque sea `fixed`) por debajo de los mensajes siguientes,
  // así que al abrir una foto antigua se veía por encima la del último mensaje.
  return createPortal(
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
    ,
    document.body,
  );
}

function Carousel({ images, alt, className, onOpen }) {
  const trackRef = useRef(null);
  const frame = useRef(0);
  const [index, setIndex] = useState(0);
  const count = images.length;

  // El índice sale del desplazamiento real, así que dedo, rueda, teclado y flechas quedan siempre de acuerdo.
  const syncIndex = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const track = trackRef.current;
      if (track) setIndex(currentIndex(track.scrollLeft, track.clientWidth, count));
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const goTo = (target) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: target * track.clientWidth, behavior: "smooth" });
  };
  const step = (delta) => goTo(stepIndex(index, delta, count));

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  };

  const arrow =
    "absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow transition hover:bg-black/75 th-focus-ring md:flex";

  return (
    <div
      role="group"
      aria-roledescription="carrusel"
      aria-label={`${alt}: ${count} fotos`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`relative overflow-hidden bg-th-surface-subtle ${className}`}
    >
      <div
        ref={trackRef}
        onScroll={syncIndex}
        style={{ aspectRatio: String(frameAspect(images)) }}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((image, i) => (
          <button
            key={image.url}
            type="button"
            onClick={() => onOpen(i)}
            aria-label={`Ver ${alt.toLowerCase()} ${i + 1} de ${count} en grande`}
            className="h-full w-full flex-none snap-center snap-always th-focus-ring"
          >
            <img
              src={image.url}
              alt={`${alt} ${i + 1} de ${count}`}
              width={image.width}
              height={image.height}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
        {index + 1}/{count}
      </span>

      {index > 0 && (
        <button type="button" onClick={() => step(-1)} aria-label="Foto anterior" className={`${arrow} left-2`}>
          <Icon name="chevron_left" size={22} />
        </button>
      )}
      {index < count - 1 && (
        <button type="button" onClick={() => step(1)} aria-label="Foto siguiente" className={`${arrow} right-2`}>
          <Icon name="chevron_right" size={22} />
        </button>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden="true">
        {images.map((image, i) => (
          <span
            key={image.url}
            className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/55"}`}
          />
        ))}
      </div>
    </div>
  );
}
