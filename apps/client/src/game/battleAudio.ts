export type BattleSound = "command" | "impact" | "ready" | "advance" | "warning";

/** Original short Web Audio cues. Context creation requires a real user gesture. */
export function createBattleAudio() {
  let context: AudioContext | undefined;
  let muted = false;
  let destroyed = false;
  let lastImpact = -Infinity;
  let played = 0;
  try { muted = localStorage.getItem("village-siege:sound-muted") === "true"; } catch { /* Optional preference. */ }
  const unlock = () => {
    if (destroyed || muted || typeof AudioContext === "undefined") return;
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
  const tone = (frequency: number, start: number, duration: number, volume: number, waveform: OscillatorType = "triangle") => {
    if (!context) return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = waveform; oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + duration + 0.01);
  };
  return {
    get muted() { return muted; },
    get diagnostics() { return { muted, contextState: context?.state ?? "locked", played }; },
    toggle() { muted = !muted; try { localStorage.setItem("village-siege:sound-muted", String(muted)); } catch { /* Optional preference. */ } if (!muted) unlock(); return muted; },
    play(kind: BattleSound) {
      if (destroyed || muted || context?.state !== "running") return;
      const now = context.currentTime;
      if (kind === "impact" && now - lastImpact < 0.15) return;
      played += 1;
      if (kind === "impact") { lastImpact = now; tone(92, now, 0.09, 0.06, "sawtooth"); tone(740, now, 0.045, 0.035); }
      else if (kind === "command") tone(440, now, 0.065, 0.035);
      else if (kind === "warning") { tone(196, now, 0.14, 0.055); tone(147, now + 0.15, 0.19, 0.055); }
      else { [kind === "advance" ? 392 : 440, 554, 659].forEach((frequency, index) => tone(frequency, now + index * 0.09, 0.16, 0.04)); }
    },
    destroy() { destroyed = true; document.removeEventListener("pointerdown", unlock, true); document.removeEventListener("keydown", unlock, true); if (context) void context.close().catch(() => undefined); },
  };
}
