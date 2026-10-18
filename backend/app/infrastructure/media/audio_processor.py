# Procesado de notas de voz (ADR-042): valida por CONTENIDO, descarta lo que no sea
# audio y lo normaliza a AAC en MP4, que suena en todos los navegadores y en la app.
#
# Chrome graba webm/opus, Safari e iOS mp4/aac, la app m4a. Safari/iOS no reproduce de
# forma fiable webm/opus, así que el servidor devuelve SIEMPRE el mismo formato. Igual
# que con las imágenes (image_processor.py), el original nunca se guarda: se descartan
# los metadatos y cualquier carga escondida tras el audio.
#
# Defensas, pensadas para un archivo de un desconocido pasando por un demuxer de ffmpeg:
#   · el contenedor se reconoce por su CABECERA (no por extensión ni Content-Type) y de una
#     lista cerrada; `format=` queda fijado a lo detectado, ffmpeg no adivina;
#   · exactamente UN flujo de audio y ningún vídeo/subtítulo;
#   · tope de tamaño de entrada y de duración, comprobado MIENTRAS se decodifica (una
#     grabación corta de 3 MiB que expande a horas de silencio no llega a terminar).

import io
import logging

import av
from av.audio.resampler import AudioResampler

from app.domain.media.audio import (
    MAX_VOICE_SECONDS,
    MAX_VOICE_UPLOAD_BYTES,
    VOICE_CONTENT_TYPE,
    VOICE_DURATION_TOLERANCE_SECONDS,
    AudioTooLargeError,
    AudioTooLongError,
    InvalidAudioError,
)

_logger = logging.getLogger(__name__)

OUTPUT_RATE = 24000
OUTPUT_BITRATE = 40000
_AAC_FRAME_SIZE = 1024


def sniff_container(raw):
    """Nombre del demuxer de ffmpeg según la cabecera, o `None` si no es uno admitido."""
    if raw[:4] == b"\x1a\x45\xdf\xa3":
        return "matroska,webm"
    if raw[:4] == b"OggS":
        return "ogg"
    if raw[4:8] == b"ftyp":
        return "mp4"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        return "wav"
    return None


def process_voice(raw):
    """Devuelve `(bytes_m4a, content_type, duration_ms)` o lanza `InvalidAudioError`,
    `AudioTooLargeError` o `AudioTooLongError`."""
    if len(raw) > MAX_VOICE_UPLOAD_BYTES:
        raise AudioTooLargeError()
    container_format = sniff_container(raw)
    if container_format is None:
        raise InvalidAudioError()

    max_seconds = MAX_VOICE_SECONDS + VOICE_DURATION_TOLERANCE_SECONDS
    source = output = None
    try:
        source = av.open(io.BytesIO(raw), mode="r", format=container_format)

        kinds = [stream.type for stream in source.streams]
        if kinds.count("audio") != 1 or any(kind in ("video", "subtitle") for kind in kinds):
            raise InvalidAudioError()
        audio_stream = source.streams.audio[0]

        out_buffer = io.BytesIO()
        # Sin `faststart`: ese ajuste reabre el archivo por nombre y falla escribiendo a memoria.
        # Con menos de 1 MiB por nota, que el índice quede al final no se nota al reproducir.
        output = av.open(out_buffer, mode="w", format="mp4")
        encoder = output.add_stream("aac", rate=OUTPUT_RATE, layout="mono")
        encoder.bit_rate = OUTPUT_BITRATE
        resampler = AudioResampler(
            format="fltp", layout="mono", rate=OUTPUT_RATE, frame_size=_AAC_FRAME_SIZE
        )

        decoded_seconds = 0.0
        for packet in source.demux(audio_stream):
            for frame in packet.decode():
                if not frame.sample_rate:
                    raise InvalidAudioError()
                decoded_seconds += frame.samples / frame.sample_rate
                if decoded_seconds > max_seconds:
                    raise AudioTooLongError()
                # Sin esto PyAV conserva los tiempos del origen y el MP4 sale con huecos.
                frame.pts = None
                for resampled in resampler.resample(frame):
                    for out_packet in encoder.encode(resampled):
                        output.mux(out_packet)

        for resampled in resampler.resample(None):
            for out_packet in encoder.encode(resampled):
                output.mux(out_packet)
        for out_packet in encoder.encode(None):
            output.mux(out_packet)
        output.close()
        output = None

        if decoded_seconds <= 0:
            raise InvalidAudioError()
        duration_ms = max(1, round(decoded_seconds * 1000))
        return out_buffer.getvalue(), VOICE_CONTENT_TYPE, duration_ms
    except (InvalidAudioError, AudioTooLongError, AudioTooLargeError):
        raise
    except Exception as error:  # noqa: BLE001 -- cualquier fallo del decodificador = archivo inválido
        # No se devuelve el texto de ffmpeg al cliente (detalles internos); queda en el log.
        _logger.info("Audio rechazado: %s: %s", type(error).__name__, error)
        raise InvalidAudioError() from error
    finally:
        for handle in (source, output):
            if handle is not None:
                try:
                    handle.close()
                except Exception:  # noqa: BLE001
                    pass
