const BEEPS = 3;

const GAP = 0.3;

const LENGTH = 0.2;

let context: AudioContext | null = null;

const supported = () => typeof AudioContext !== "undefined";

const running = () => context !== null && context.state === "running";

export const chime = {
  unlock: () => {
    if (!supported()) return;
    try {
      context ??= new AudioContext();
      context.resume().catch(() => {});
    } catch {
      context = null;
    }
  },
  locked: () => supported() && !running(),
  play: () => {
    if (context === null || !running()) return false;
    for (let beep = 0; beep < BEEPS; beep++) {
      const at = context.currentTime + beep * GAP;
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + LENGTH);
      tone.connect(gain);
      gain.connect(context.destination);
      tone.start(at);
      tone.stop(at + LENGTH + 0.05);
    }
    return true;
  },
};
