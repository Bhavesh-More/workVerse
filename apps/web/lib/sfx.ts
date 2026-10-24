// Tiny synthesized sound effects + background music (Web Audio, no asset files).
// Sound and music on/off persist per browser; both are decoration only and fail silently.
export type Cue =
  | "send"
  | "receive"
  | "discover"
  | "objective"
  | "error"
  | "complete"
  | "click"
  | "soft"
  | "nav"
  | "toggle";

type Note = { f: number; t: number; type?: OscillatorType; vol?: number };

const NOTES: Record<Cue, Note[]> = {
  send: [{ f: 660, t: 0.05 }],
  receive: [{ f: 520, t: 0.06 }, { f: 780, t: 0.06 }],
  discover: [{ f: 880, t: 0.07 }, { f: 1175, t: 0.1 }],
  objective: [{ f: 523, t: 0.08 }, { f: 659, t: 0.08 }, { f: 784, t: 0.16 }],
  error: [{ f: 196, t: 0.12, type: "square" }],
  complete: [{ f: 523, t: 0.1 }, { f: 659, t: 0.1 }, { f: 784, t: 0.1 }, { f: 1047, t: 0.25 }],
  // UI clicks: short and quiet so rapid clicking never gets tiring.
  click: [{ f: 1046, t: 0.035, type: "triangle", vol: 0.06 }, { f: 1568, t: 0.04, type: "triangle", vol: 0.04 }],
  soft: [{ f: 784, t: 0.035, type: "triangle", vol: 0.045 }],
  nav: [{ f: 587, t: 0.045, vol: 0.05 }, { f: 880, t: 0.07, vol: 0.05 }],
  toggle: [{ f: 1318, t: 0.03, type: "square", vol: 0.025 }, { f: 988, t: 0.04, type: "square", vol: 0.025 }],
};

const KEY = "wv-sfx-muted";
const MUSIC_KEY = "wv-music-on";
let ctx: AudioContext | null = null;

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the setting just won't persist */
  }
}

export function isMuted(): boolean {
  return read(KEY) === "1";
}

export function setMuted(muted: boolean): void {
  write(KEY, muted ? "1" : "0");
}

export function play(cue: Cue): void {
  if (typeof window === "undefined" || isMuted()) return;
  try {
    const ac = audio();
    let at = ac.currentTime;
    for (const n of NOTES[cue]) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(n.vol ?? 0.08, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + n.t);
      osc.connect(gain).connect(ac.destination);
      osc.start(at);
      osc.stop(at + n.t + 0.02);
      at += n.t * 0.9;
    }
  } catch {
    /* audio unavailable */
  }
}

/** Pick a click cue from the element that was clicked (used by the global SoundLayer). */
export function cueFor(el: Element): Cue | null {
  const override = el.closest("[data-sfx]")?.getAttribute("data-sfx");
  if (override === "none") return null;
  if (override && override in NOTES) return override as Cue;
  if (el.matches("input[type=checkbox], input[type=radio], [role=switch], [role=tab], [aria-pressed]")) return "toggle";
  if (el.matches("a[href]")) return "nav";
  if (el.matches(".btn--ghost, summary, select")) return "soft";
  return "click";
}

// ---- Background music -------------------------------------------------------------------------
// A slow arpeggio over a 4-chord loop with a soft pad, scheduled just ahead of time.
// "calm" for menus and reports; "focus" (minor, a little faster, pulsing bass) during an incident.
export type Mood = "calm" | "focus";

const MOODS: Record<Mood, { bpm: number; chords: number[][]; bass: boolean; wave: OscillatorType }> = {
  calm: { bpm: 76, chords: [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]], bass: false, wave: "sine" },
  focus: { bpm: 96, chords: [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]], bass: true, wave: "triangle" },
};
const MUSIC_VOL = 0.035;
const ARP = [0, 1, 2, 1, 2, 0, 1, 2]; // chord-tone order per eighth note, upper octave

let music: { mood: Mood; out: GainNode; timer: number; step: number; next: number } | null = null;
let ducked = false;

export function isMusicOn(): boolean {
  return read(MUSIC_KEY) !== "0"; // on by default; it only starts after the first click
}

export function setMusicOn(on: boolean, mood: Mood = "calm"): void {
  write(MUSIC_KEY, on ? "1" : "0");
  if (on) startMusic(mood);
  else stopMusic();
}

function tone(ac: AudioContext, out: AudioNode, f: number, at: number, dur: number, vol: number, type: OscillatorType) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = f;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.4, dur / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** Start (or switch mood of) the loop. Safe to call repeatedly; no-op if music is off. */
export function startMusic(mood: Mood): void {
  if (typeof window === "undefined" || !isMusicOn()) return;
  if (music?.mood === mood) return;
  stopMusic();
  try {
    const ac = audio();
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    const out = ac.createGain();
    out.gain.setValueAtTime(0.0001, ac.currentTime);
    out.gain.exponentialRampToValueAtTime(ducked ? 0.0001 : MUSIC_VOL, ac.currentTime + 1.5);
    filter.connect(out).connect(ac.destination);
    const m = MOODS[mood];
    const eighth = 60 / m.bpm / 2;
    const state = { mood, out, timer: 0, step: 0, next: ac.currentTime + 0.1 };
    state.timer = window.setInterval(() => {
      while (state.next < ac.currentTime + 0.4) {
        const bar = Math.floor(state.step / 8) % m.chords.length;
        const chord = m.chords[bar]!;
        const beat = state.step % 8;
        if (beat === 0) {
          for (const f of chord) tone(ac, filter, f, state.next, eighth * 8, 0.18, "sine"); // pad
          if (m.bass) tone(ac, filter, chord[0]! / 2, state.next, eighth * 3, 0.5, "triangle");
        }
        if (m.bass && beat === 4) tone(ac, filter, chord[0]! / 2, state.next, eighth * 3, 0.4, "triangle");
        tone(ac, filter, chord[ARP[beat]!]! * 2, state.next, eighth * 1.6, 0.22, m.wave); // arpeggio
        state.next += eighth;
        state.step += 1;
      }
    }, 150);
    music = state;
  } catch {
    music = null;
  }
}

export function stopMusic(): void {
  if (!music || !ctx) return;
  const { out, timer } = music;
  window.clearInterval(timer);
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
  window.setTimeout(() => out.disconnect(), 1200);
  music = null;
}

/** Fade music out while something else needs the ear (e.g. a live voice meeting). */
export function duckMusic(on: boolean): void {
  ducked = on;
  if (!music || !ctx) return;
  music.out.gain.cancelScheduledValues(ctx.currentTime);
  music.out.gain.setTargetAtTime(on ? 0.0001 : MUSIC_VOL, ctx.currentTime, 0.3);
}

/** Pause/resume all audio, e.g. when the tab is hidden. */
export function suspendAudio(hidden: boolean): void {
  if (!ctx) return;
  void (hidden ? ctx.suspend() : ctx.resume());
}
