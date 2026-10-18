# Videos de prueba (ADR-046), generados al vuelo con PyAV y Pillow: nada de archivos binarios en el
# repositorio y nada de depender de ffmpeg instalado en la máquina.

import array
import io
import math

import av
from PIL import Image


def make_video(
    width=320,
    height=240,
    seconds=1.0,
    fps=30,
    audio=True,
    container="mp4",
    rotation=0,
    codec="libx264",
):
    """Bytes de un video sintético: color que cambia en cada fotograma y, si `audio`, un tono."""
    buffer = io.BytesIO()
    out = av.open(buffer, "w", format=container)
    video = out.add_stream(codec, rate=fps)
    video.width, video.height = width, height
    video.pix_fmt = "yuv420p"
    if rotation:
        video.set_display_rotation(rotation)

    audio_stream = None
    if audio:
        audio_stream = out.add_stream("aac" if container == "mp4" else "libopus", rate=44100, layout="mono")

    frames = max(1, round(seconds * fps))
    for index in range(frames):
        shade = (index * 9) % 255
        image = Image.new("RGB", (width, height), (shade, 255 - shade, 128))
        frame = av.VideoFrame.from_image(image)
        frame.pts = index
        frame.time_base = av.time_base and __import__("fractions").Fraction(1, fps)
        for packet in video.encode(frame):
            out.mux(packet)
    for packet in video.encode(None):
        out.mux(packet)

    if audio_stream is not None:
        total = int(44100 * seconds)
        position = 0
        while position < total:
            count = min(1024, total - position)
            samples = array.array(
                "h",
                (int(12000 * math.sin(2 * math.pi * 440 * (position + i) / 44100)) for i in range(count)),
            )
            frame = av.AudioFrame(format="s16", layout="mono", samples=count)
            frame.sample_rate = 44100
            frame.planes[0].update(samples.tobytes())
            frame.pts = position
            for packet in audio_stream.encode(frame):
                out.mux(packet)
            position += count
        for packet in audio_stream.encode(None):
            out.mux(packet)

    out.close()
    return buffer.getvalue()


def video_info(data):
    """`(ancho, alto, duración_s, tiene_audio, códec_de_video)` de un MP4 ya procesado."""
    source = av.open(io.BytesIO(data), format="mp4")
    try:
        stream = source.streams.video[0]
        return (
            stream.width,
            stream.height,
            float(source.duration) / av.time_base,
            len(source.streams.audio) == 1,
            stream.codec_context.name,
        )
    finally:
        source.close()
