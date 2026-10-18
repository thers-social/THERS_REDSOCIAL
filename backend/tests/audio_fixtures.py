# Audios sintéticos para las pruebas de notas de voz (ADR-042). Se generan con PyAV y la
# biblioteca estándar (sin numpy ni archivos binarios en el repositorio): un tono de 440 Hz
# codificado en el contenedor que se pida, tal como lo grabaría cada navegador.

import array
import io
import math

import av
from av.audio.resampler import AudioResampler


def _tone_s16(seconds, rate, channels):
    count = int(seconds * rate)
    samples = array.array("h")
    for i in range(count):
        value = int(9000 * math.sin(2 * math.pi * 440 * i / rate))
        samples.extend([value] * channels)
    return samples


def make_audio(container="webm", codec="libopus", seconds=2.0, rate=48000, layout="mono"):
    """Bytes de un audio de `seconds` segundos. Contenedores usados por las pruebas:
    ("webm", "libopus") = Chrome, ("mp4", "aac") = Safari/app, ("ogg", "libopus"),
    ("wav", "pcm_s16le")."""
    channels = 1 if layout == "mono" else 2
    buffer = io.BytesIO()
    output = av.open(buffer, mode="w", format=container)
    stream = output.add_stream(codec, rate=rate, layout=layout)

    frame_size = stream.codec_context.frame_size or 960
    resampler = AudioResampler(
        format=stream.codec_context.format.name, layout=layout, rate=rate, frame_size=frame_size
    )

    samples = _tone_s16(seconds, rate, channels)
    step = 1024 * channels
    for start in range(0, len(samples), step):
        chunk = samples[start:start + step]
        frame = av.AudioFrame(format="s16", layout=layout, samples=len(chunk) // channels)
        frame.planes[0].update(chunk.tobytes())
        frame.sample_rate = rate
        for resampled in resampler.resample(frame):
            for packet in stream.encode(resampled):
                output.mux(packet)
    for resampled in resampler.resample(None):
        for packet in stream.encode(resampled):
            output.mux(packet)
    for packet in stream.encode(None):
        output.mux(packet)
    output.close()
    return buffer.getvalue()


def make_video_with_audio(seconds=1.0):
    """Un MP4 con vídeo y audio: debe rechazarse (la nota de voz es solo audio)."""
    buffer = io.BytesIO()
    output = av.open(buffer, mode="w", format="mp4")
    video = output.add_stream("mpeg4", rate=10)
    video.width, video.height, video.pix_fmt = 64, 48, "yuv420p"
    audio = output.add_stream("aac", rate=48000, layout="mono")

    for index in range(int(seconds * 10)):
        frame = av.VideoFrame(64, 48, "yuv420p")
        frame.pts = index
        for packet in video.encode(frame):
            output.mux(packet)
    for packet in video.encode(None):
        output.mux(packet)

    resampler = AudioResampler(format="fltp", layout="mono", rate=48000, frame_size=1024)
    samples = _tone_s16(seconds, 48000, 1)
    for start in range(0, len(samples), 1024):
        chunk = samples[start:start + 1024]
        frame = av.AudioFrame(format="s16", layout="mono", samples=len(chunk))
        frame.planes[0].update(chunk.tobytes())
        frame.sample_rate = 48000
        for resampled in resampler.resample(frame):
            for packet in audio.encode(resampled):
                output.mux(packet)
    for packet in audio.encode(None):
        output.mux(packet)
    output.close()
    return buffer.getvalue()
