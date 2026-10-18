# Procesado de videos cortos (ADR-046): valida por CONTENIDO, descarta lo que no sea video y lo
# normaliza a MP4 (H.264 + AAC, hasta 720p y 30 fps, con `faststart`), que suena y se ve en todos los
# navegadores y en la app. Igual que con imágenes y notas de voz, el original nunca se guarda: se
# descartan los metadatos (GPS, dispositivo) y cualquier carga escondida tras el video.
#
# Defensas, pensadas para un archivo de un desconocido pasando por un demuxer de ffmpeg:
#   · el contenedor se reconoce por su CABECERA (no por extensión ni Content-Type) y de una lista
#     cerrada; `format=` queda fijado a lo detectado, ffmpeg no adivina;
#   · un video y como mucho un audio; subtítulos y adjuntos se ignoran (no se copian);
#   · tope de tamaño de entrada, de resolución, de duración y de fotogramas, comprobados MIENTRAS se
#     decodifica: un archivo pequeño que expande a horas de video no llega a terminar.

import io
import logging
import os
import tempfile
from fractions import Fraction

import av
from av.audio.resampler import AudioResampler
from PIL import Image

from app.domain.media.video import (
    MAX_VIDEO_FRAMES,
    MAX_VIDEO_INPUT_SIDE,
    MAX_VIDEO_OUTPUT_BYTES,
    MAX_VIDEO_SECONDS,
    MAX_VIDEO_UPLOAD_BYTES,
    OUTPUT_LONG_SIDE,
    OUTPUT_MAX_FPS,
    OUTPUT_SHORT_SIDE,
    VIDEO_DURATION_TOLERANCE_SECONDS,
    InvalidVideoError,
    VideoTooLargeError,
    VideoTooLongError,
)

_logger = logging.getLogger(__name__)

AUDIO_RATE = 44100
AUDIO_BITRATE = 96000
_AAC_FRAME_SIZE = 1024
THUMBNAIL_WIDTH = 480
THUMBNAIL_QUALITY = 75
# Un fotograma representativo: no el primero (suele ser negro) sino el primero pasado este instante.
THUMBNAIL_AT_SECONDS = 0.4


def sniff_container(raw):
    """Nombre del demuxer de ffmpeg según la cabecera, o `None` si no es uno admitido."""
    if raw[:4] == b"\x1a\x45\xdf\xa3":
        return "matroska,webm"
    if raw[4:8] == b"ftyp":
        return "mp4"  # incluye .mov (QuickTime) y 3gp
    return None


def output_size(width, height):
    """Dimensiones de salida: cabe en 1280x720 (o 720x1280 en vertical), sin ampliar y siempre pares
    (H.264 en 4:2:0 lo exige)."""
    long_side, short_side = max(width, height), min(width, height)
    scale = min(1.0, OUTPUT_LONG_SIDE / long_side, OUTPUT_SHORT_SIDE / short_side)
    out_w = max(2, int(width * scale) // 2 * 2)
    out_h = max(2, int(height * scale) // 2 * 2)
    return out_w, out_h


def _rotation(frame):
    """Grados (0, 90, 180 o 270) que hay que girar el fotograma para verlo derecho: los teléfonos
    graban en horizontal y marcan la rotación en los metadatos."""
    angle = round(getattr(frame, "rotation", 0) or 0) % 360
    return angle if angle in (90, 180, 270) else 0


def _make_rotator(stream, angle):
    """Filtro que endereza los fotogramas de `stream` (`angle` = grados antihorarios, 90/180/270)."""
    graph = av.filter.Graph()
    source = graph.add_buffer(template=stream)
    sink = graph.add("buffersink")
    steps = {90: ["transpose=dir=2"], 270: ["transpose=dir=1"], 180: ["hflip", "vflip"]}[angle]
    previous = source
    for step in steps:
        name, _, arguments = step.partition("=")
        node = graph.add(name, arguments or None)
        previous.link_to(node)
        previous = node
    previous.link_to(sink)
    graph.configure()
    return graph


def process_video(raw):
    """Devuelve `(mp4, content_type, thumbnail_webp, width, height, duration_ms)` o lanza
    `InvalidVideoError`, `VideoTooLargeError` o `VideoTooLongError`."""
    if len(raw) > MAX_VIDEO_UPLOAD_BYTES:
        raise VideoTooLargeError()
    container_format = sniff_container(raw)
    if container_format is None:
        raise InvalidVideoError()

    max_seconds = MAX_VIDEO_SECONDS + VIDEO_DURATION_TOLERANCE_SECONDS
    source = output = None
    with tempfile.TemporaryDirectory(prefix="thers-video-") as workdir:
        # A un archivo y no a memoria: `faststart` (índice al principio, para empezar a reproducir
        # sin bajar todo) reabre el destino por nombre.
        out_path = os.path.join(workdir, "out.mp4")
        try:
            source = av.open(io.BytesIO(raw), mode="r", format=container_format)
            if source.duration is not None and source.duration / av.time_base > max_seconds * 1.5:
                raise VideoTooLongError()

            videos = source.streams.video
            audios = source.streams.audio
            if len(videos) != 1 or len(audios) > 1:
                raise InvalidVideoError()
            video_in = videos[0]
            audio_in = audios[0] if audios else None
            if (
                not video_in.width
                or not video_in.height
                or video_in.width > MAX_VIDEO_INPUT_SIDE
                or video_in.height > MAX_VIDEO_INPUT_SIDE
            ):
                raise InvalidVideoError()

            # Si se rota 90/270, el ancho y el alto de salida se intercambian.
            source_fps = float(video_in.average_rate or 30)
            fps = max(1, min(OUTPUT_MAX_FPS, round(source_fps)))
            frame_time = Fraction(1, fps)

            output = av.open(out_path, mode="w", format="mp4", options={"movflags": "+faststart"})
            video_out = None
            audio_out = resampler = None
            if audio_in is not None:
                audio_out = output.add_stream("aac", rate=AUDIO_RATE, layout="stereo")
                audio_out.bit_rate = AUDIO_BITRATE
                resampler = AudioResampler(
                    format="fltp", layout="stereo", rate=AUDIO_RATE, frame_size=_AAC_FRAME_SIZE
                )

            thumbnail = first_frame = rotator = None
            last_index = -1
            last_seconds = 0.0
            decoded_frames = 0
            audio_seconds = 0.0
            streams = [video_in] + ([audio_in] if audio_in is not None else [])

            for packet in source.demux(*streams):
                if packet.stream is video_in:
                    for frame in packet.decode():
                        decoded_frames += 1
                        if decoded_frames > MAX_VIDEO_FRAMES:
                            raise VideoTooLongError()
                        if frame.pts is None:
                            continue
                        seconds = float(frame.pts * frame.time_base)
                        if seconds > max_seconds:
                            raise VideoTooLongError()
                        # Reloj fijo: `index` es el número de fotograma en la salida. Descarta los
                        # sobrantes (60 -> 30 fps) y los repetidos de una fuente de ritmo variable.
                        index = round(seconds * fps)
                        if index <= last_index:
                            continue
                        angle = _rotation(frame)
                        if video_out is None:
                            shown_w, shown_h = (
                                (frame.height, frame.width) if angle in (90, 270) else (frame.width, frame.height)
                            )
                            out_w, out_h = output_size(shown_w, shown_h)
                            video_out = output.add_stream("libx264", rate=fps)
                            video_out.width, video_out.height = out_w, out_h
                            video_out.pix_fmt = "yuv420p"
                            video_out.time_base = frame_time
                            video_out.options = {
                                "crf": "28",
                                "preset": "veryfast",
                                "profile": "main",
                                # Tope de tasa de bits: 60 s caben muy por debajo del límite de salida.
                                "maxrate": "2000k",
                                "bufsize": "4000k",
                            }
                        if angle:
                            # Girado (casi todo video vertical de un teléfono): un filtro de ffmpeg lo
                            # endereza en C; hacerlo fotograma a fotograma en Python tardaría minutos.
                            if rotator is None:
                                rotator = _make_rotator(video_in, angle)
                            rotator.push(frame)
                            turned = rotator.pull()
                            out_frame = turned.reformat(width=out_w, height=out_h, format="yuv420p")
                        else:
                            out_frame = frame.reformat(width=out_w, height=out_h, format="yuv420p")
                        if first_frame is None:
                            first_frame = out_frame
                        if thumbnail is None and seconds >= THUMBNAIL_AT_SECONDS:
                            thumbnail = out_frame.to_image()
                        out_frame.pts = index
                        out_frame.time_base = frame_time
                        for out_packet in video_out.encode(out_frame):
                            output.mux(out_packet)
                        last_index = index
                        last_seconds = seconds
                elif packet.stream is audio_in:
                    for frame in packet.decode():
                        if not frame.sample_rate:
                            raise InvalidVideoError()
                        audio_seconds += frame.samples / frame.sample_rate
                        if audio_seconds > max_seconds:
                            raise VideoTooLongError()
                        frame.pts = None
                        for resampled in resampler.resample(frame):
                            for out_packet in audio_out.encode(resampled):
                                output.mux(out_packet)

            if video_out is None:
                raise InvalidVideoError()
            for out_packet in video_out.encode(None):
                output.mux(out_packet)
            if audio_out is not None:
                for resampled in resampler.resample(None):
                    for out_packet in audio_out.encode(resampled):
                        output.mux(out_packet)
                for out_packet in audio_out.encode(None):
                    output.mux(out_packet)
            output.close()
            output = None

            if os.path.getsize(out_path) > MAX_VIDEO_OUTPUT_BYTES:
                raise VideoTooLargeError()
            with open(out_path, "rb") as handle:
                mp4 = handle.read()

            if thumbnail is None:
                thumbnail = first_frame.to_image()
            thumb = thumbnail.convert("RGB")
            if thumb.width > THUMBNAIL_WIDTH:
                thumb = thumb.resize(
                    (THUMBNAIL_WIDTH, max(1, round(thumb.height * THUMBNAIL_WIDTH / thumb.width))),
                    Image.LANCZOS,
                )
            thumb_buffer = io.BytesIO()
            thumb.save(thumb_buffer, format="WEBP", quality=THUMBNAIL_QUALITY)

            duration_seconds = max(last_seconds + 1 / fps, audio_seconds if audio_in is not None else 0)
            duration_ms = max(1, round(min(duration_seconds, max_seconds) * 1000))
            return mp4, "video/mp4", thumb_buffer.getvalue(), out_w, out_h, duration_ms
        except (InvalidVideoError, VideoTooLongError, VideoTooLargeError):
            raise
        except Exception as error:  # noqa: BLE001 -- cualquier fallo del decodificador = archivo inválido
            # No se devuelve el texto de ffmpeg al cliente (detalles internos); queda en el log.
            _logger.info("Video rechazado: %s: %s", type(error).__name__, error)
            raise InvalidVideoError() from error
        finally:
            for handle in (source, output):
                if handle is not None:
                    try:
                        handle.close()
                    except Exception:  # noqa: BLE001
                        pass
