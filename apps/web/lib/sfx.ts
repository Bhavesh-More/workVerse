// Tiny synthesized sound effects (Web Audio, no asset files). Muted state persists per browser.
type Cue = "send" | "receive" | "discover" | "objective" | "error" | "complete";

const NOTES: Record<Cue, { f: number; t: number; type?: OscillatorType }[]> = {
  send: [{ f: 660, t: 0.05 }],
  receive: [{ f: 520, t: 0.06 }, { f: 780, t: 0.06 }],
  discover: [{ f: 880, t: 0.07 }, { f: 1175, t: 0.1 }],
  objective: [{ f: 523, t: 0.08 }, { f: 659, t: 0.08 }, { f: 784, t: 0.16 }],
  error: [{ f: 196, t: 0.12, type: "square" }],
  complete: [{ f: 523, t: 0.1 }, { f: 659, t: 0.1 }, { f: 784, t: 0.1 }, { f: 1047, t: 0.25 }],
};

const KEY = "wv-sfx-muted";
let ctx: AudioContext | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    /* storage blocked: mute just won't persist */
  }
}

export function play(cue: Cue): void {
  if (typeof window === "undefined" || isMuted()) return;
  try {
    ctx ??= new AudioContext();
    let at = ctx.currentTime;
    for (const n of NOTES[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + n.t);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + n.t + 0.02);
      at += n.t * 0.9;
    }
  } catch {
    /* audio unavailable: sounds are decoration only */
  }
}
