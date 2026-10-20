// Timbre de llamada entrante: dos pitidos cada 2 segundos con Web Audio, sin archivos de audio.
// El navegador puede negarse a sonar si la persona aún no ha interactuado con la página: en ese caso
// la llamada se ve igual y simplemente no suena.
export function startRingtone() {
  let context;
  let timer;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    context = new AudioContextClass();
    context.resume?.().catch(() => {});
  } catch {
    return () => {};
  }

  const beep = (offset) => {
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 520;
      const start = context.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.4);
    } catch {
      // Sin sonido: no es un error para la persona.
    }
  };
  const ring = () => {
    beep(0);
    beep(0.5);
  };
  ring();
  timer = setInterval(ring, 2000);

  return () => {
    clearInterval(timer);
    context.close?.().catch(() => {});
  };
}
