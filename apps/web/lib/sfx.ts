// 8-bit game sounds + chiptune background music, synthesised with the Web Audio API.
// No audio files: nothing to license or download (works on slow connections).
// Sound palette adapted from Crowdspawn (MIT) and classic sfxr archetypes (coin, power-up, hurt…).
// Browsers only allow audio after a user gesture; every sound follows a click or key press.

type Note = { f: number; to?: number; at?: number; len: number; wave?: OscillatorType | "noise"; vol?: number };

const SOUNDS = {
  // UI controls
  hover: [{ f: 2400, len: 0.018, wave: "sine", vol: 0.02 }],
  click: [{ f: 660, to: 990, len: 0.05, wave: "square", vol: 0.04 }],
  back: [{ f: 520, to: 330, len: 0.07, wave: "square", vol: 0.04 }],
  on: [
    { f: 523, len: 0.05, wave: "square", vol: 0.045 },
    { f: 784, at: 0.05, len: 0.07, wave: "square", vol: 0.045 },
  ],
  off: [
    { f: 784, len: 0.05, wave: "square", vol: 0.04 },
    { f: 392, at: 0.05, len: 0.08, wave: "square", vol: 0.04 },
  ],
  nav: [{ f: 330, to: 990, len: 0.11, wave: "triangle", vol: 0.1 }],
  confirm: [
    { f: 523, len: 0.06, wave: "square", vol: 0.045 },
    { f: 659, len: 0.06, wave: "square", vol: 0.035 },
    { f: 1047, at: 0.06, len: 0.12, wave: "square", vol: 0.045 },
  ],
  pop: [{ f: 1400, to: 700, len: 0.045, wave: "sine", vol: 0.1 }],
  tab: [
    { f: 880, len: 0.035, wave: "triangle", vol: 0.09 },
    { f: 1175, at: 0.035, len: 0.05, wave: "triangle", vol: 0.09 },
  ],
  select: [{ f: 440, to: 1760, len: 0.12, wave: "triangle", vol: 0.08 }],
  // Session moments
  send: [{ f: 880, to: 1320, len: 0.06, wave: "triangle", vol: 0.09 }],
  receive: [
    { f: 660, len: 0.05, wave: "triangle", vol: 0.08 },
    { f: 990, at: 0.05, len: 0.08, wave: "triangle", vol: 0.08 },
  ],
  discover: [
    // coin: new fact learned
    { f: 988, len: 0.06, wave: "square", vol: 0.045 },
    { f: 1319, at: 0.06, len: 0.18, wave: "square", vol: 0.045 },
  ],
  objective: [
    // power-up: objective complete
    { f: 392, to: 523, len: 0.07, wave: "square", vol: 0.045 },
    { f: 523, to: 659, at: 0.07, len: 0.07, wave: "square", vol: 0.045 },
    { f: 659, to: 1047, at: 0.14, len: 0.16, wave: "square", vol: 0.045 },
  ],
  error: [
    // hurt: blocked or failed action
    { f: 1, len: 0.08, wave: "noise", vol: 0.12 },
    { f: 196, to: 98, len: 0.22, wave: "sawtooth", vol: 0.045 },
  ],
  call: [
    // voice meeting ringing
    { f: 880, len: 0.08, wave: "sine", vol: 0.08 },
    { f: 1109, at: 0.1, len: 0.08, wave: "sine", vol: 0.08 },
    { f: 880, at: 0.3, len: 0.08, wave: "sine", vol: 0.08 },
    { f: 1109, at: 0.4, len: 0.08, wave: "sine", vol: 0.08 },
  ],
  complete: [
    // win: report ready
    { f: 523, len: 0.09, wave: "square", vol: 0.045 },
    { f: 659, at: 0.09, len: 0.09, wave: "square", vol: 0.045 },
    { f: 784, at: 0.18, len: 0.09, wave: "square", vol: 0.045 },
    { f: 1047, at: 0.27, len: 0.3, wave: "square", vol: 0.05 },
    { f: 1047, at: 0.27, len: 0.3, wave: "triangle", vol: 0.07 },
  ],
  // Character intro (anime opening)
  whoosh: [{ f: 300, to: 7000, len: 0.32, wave: "noise", vol: 0.14 }],
  slam: [
    { f: 120, to: 38, len: 0.32, wave: "sine", vol: 0.32 },
    { f: 900, to: 200, len: 0.14, wave: "noise", vol: 0.2 },
  ],
  shimmer: [
    { f: 1568, len: 0.09, wave: "triangle", vol: 0.04 },
    { f: 2093, at: 0.035, len: 0.09, wave: "triangle", vol: 0.04 },
    { f: 2637, at: 0.07, len: 0.09, wave: "triangle", vol: 0.04 },
    { f: 3136, at: 0.105, len: 0.16, wave: "triangle", vol: 0.04 },
  ],
  type: [{ f: 1900, len: 0.014, wave: "square", vol: 0.012 }],
  stat: [{ f: 520, to: 1240, len: 0.16, wave: "triangle", vol: 0.045 }],
  stamp: [
    { f: 95, to: 42, len: 0.4, wave: "sine", vol: 0.34 },
    { f: 400, to: 120, len: 0.22, wave: "noise", vol: 0.22 },
    { f: 523, at: 0.12, len: 0.5, wave: "square", vol: 0.03 },
    { f: 659, at: 0.12, len: 0.5, wave: "square", vol: 0.03 },
    { f: 784, at: 0.12, len: 0.5, wave: "square", vol: 0.03 },
  ],
} satisfies Record<string, Note[]>;

export type Cue = keyof typeof SOUNDS;

const KEY = "wv-sfx-muted";
const MUSIC_KEY = "wv-music-on";
let ctx: AudioContext | null = null;
let sfxOut: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const listeners = new Set<() => void>();

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    const soften = ctx.createBiquadFilter(); // take the harsh edge off square waves
    soften.type = "lowpass";
    soften.frequency.value = 5200;
    sfxOut = ctx.createGain();
    sfxOut.gain.value = 2.2; // notes are written quiet; this sets overall loudness
    sfxOut.connect(soften).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
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
  listeners.forEach((l) => l());
}

/** Re-render toggles when sound/music settings change anywhere on the page. */
export function onSoundChange(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function isMuted(): boolean {
  return read(KEY) === "1";
}

export function setMuted(muted: boolean): void {
  write(KEY, muted ? "1" : "0");
}

/** One synthesized voice; shared by sound effects and music. */
function voice(ac: AudioContext, dest: AudioNode, n: Note, start: number) {
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(n.vol ?? 0.05, start + Math.min(0.01, n.len / 4));
  env.gain.exponentialRampToValueAtTime(0.0001, start + n.len);
  env.connect(dest);
  let src: AudioScheduledSourceNode;
  if (n.wave === "noise") {
    const b = ac.createBufferSource();
    b.buffer = noiseBuf;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(n.f > 1 ? n.f : 1000, start);
    if (n.to) hp.frequency.exponentialRampToValueAtTime(n.to, start + n.len); // filter sweep (whoosh)
    b.connect(hp).connect(env);
    src = b;
  } else {
    const osc = ac.createOscillator();
    osc.type = n.wave ?? "square";
    osc.frequency.setValueAtTime(n.f, start);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.len);
    osc.connect(env);
    src = osc;
  }
  src.start(start);
  src.stop(start + n.len + 0.02);
}

let lastHover = 0;

export function play(cue: Cue): void {
  if (isMuted()) return;
  if (cue === "hover" || cue === "type") {
    const now = performance.now();
    if (now - lastHover < 60) return;
    lastHover = now;
  }
  try {
    const ac = audio();
    if (!ac || !sfxOut) return;
    const t0 = ac.currentTime + 0.005;
    for (const n of SOUNDS[cue] as Note[]) voice(ac, sfxOut, n, t0 + (n.at ?? 0));
  } catch {
    /* audio unavailable: sounds are decoration only */
  }
}

/** Pick a sound for the clicked control (used by the global SoundLayer). Null = silent. */
export function cueFor(el: Element): Cue | null {
  const named = el.closest("[data-sfx]")?.getAttribute("data-sfx");
  if (named === "none") return null;
  if (named && named in SOUNDS) return named as Cue;
  const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().toLowerCase();
  if (el.matches("[role=tab]")) return "tab";
  if (el.matches("[aria-pressed], [role=switch], input[type=checkbox], input[type=radio]")) {
    const on = el.getAttribute("aria-pressed") === "true" || (el as HTMLInputElement).checked;
    return on ? "off" : "on"; // capture phase: state before the toggle
  }
  if (el.matches("summary")) return (el.parentElement as HTMLDetailsElement).open ? "back" : "select";
  if (/^(close|cancel|back|end|dismiss|collapse)/.test(label) || el.matches(".sidebar__collapse")) return "back";
  if (el.matches("a[href]")) return "nav";
  if (el.matches(".btn--ghost, select")) return "click";
  if (el.matches(".btn")) return "confirm";
  return "click";
}

// ---- Background music ----------------------------------------------------------------------
// A chiptune loop scheduled a little ahead of time: pad + arpeggio + bass + drums, 8 steps a bar.
// "calm" (lo-fi, menus and reports) and "focus" (driving minor groove with a lead, during incidents).
export type Mood = "calm" | "focus";

type Groove = {
  bpm: number;
  chords: number[][]; // root-position triads, Hz
  arp: number[]; // chord-tone index per step, -1 = rest
  arpWave: OscillatorType;
  bass: number[]; // steps that play the root an octave down
  kick: number[];
  snare: number[];
  hat: number[];
  lead?: (number | 0)[][]; // per bar, one Hz per step (0 = rest)
};

const A3 = 220, C4 = 261.6, D4 = 293.7, E4 = 329.6, F4 = 349.2, G4 = 392, B3 = 246.9, A4 = 440, C5 = 523.3, D5 = 587.3, E5 = 659.3, G3 = 196, F3 = 174.6, E3 = 164.8;

const GROOVES: Record<Mood, Groove> = {
  calm: {
    bpm: 78,
    chords: [[C4, E4, G4], [A3, C4, E4], [F3, A3, C4], [G3, B3, D4]],
    arp: [0, 2, 1, 2, -1, 2, 1, 2],
    arpWave: "triangle",
    bass: [0, 5],
    kick: [0, 5],
    snare: [4],
    hat: [2, 6],
  },
  focus: {
    bpm: 112,
    chords: [[A3, C4, E4], [F3, A3, C4], [G3, B3, D4], [E3, G3, B3]],
    arp: [0, 1, 2, 1, 0, 1, 2, 1],
    arpWave: "square",
    bass: [0, 1, 2, 3, 4, 5, 6, 7],
    kick: [0, 3, 4],
    snare: [2, 6],
    hat: [0, 1, 2, 3, 4, 5, 6, 7],
    lead: [
      [E5, 0, D5, C5, 0, A4, C5, 0],
      [C5, 0, A4, 0, F4, 0, A4, C5],
      [D5, 0, E5, D5, 0, B3 * 2, G4, 0],
      [E5, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
};
const MUSIC_VOL = 0.05;

let music: { mood: Mood; out: GainNode; timer: number } | null = null;
let ducked = false;

export function isMusicOn(): boolean {
  return read(MUSIC_KEY) !== "0"; // on by default; it only starts after the first click
}

export function setMusicOn(on: boolean, mood: Mood = "calm"): void {
  write(MUSIC_KEY, on ? "1" : "0");
  if (on) startMusic(mood);
  else stopMusic();
}

/** Start (or switch the mood of) the loop. Safe to call repeatedly; no-op if music is off. */
export function startMusic(mood: Mood): void {
  if (typeof window === "undefined" || !isMusicOn()) return;
  if (music?.mood === mood) return;
  stopMusic();
  try {
    const ac = audio();
    if (!ac) return;
    const soften = ac.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = mood === "calm" ? 2200 : 3600;
    const out = ac.createGain();
    out.gain.setValueAtTime(0.0001, ac.currentTime);
    out.gain.exponentialRampToValueAtTime(ducked ? 0.0001 : MUSIC_VOL, ac.currentTime + 0.5);
    soften.connect(out).connect(ac.destination);
    const g = GROOVES[mood];
    const step = 60 / g.bpm / 2; // eighth notes
    let i = 0;
    let next = ac.currentTime + 0.1;
    const timer = window.setInterval(() => {
      while (next < ac.currentTime + 0.4) {
        const bar = Math.floor(i / 8) % g.chords.length;
        const s = i % 8;
        const chord = g.chords[bar]!;
        if (s === 0) for (const f of chord) voice(ac, soften, { f, len: step * 8, wave: "sine", vol: 0.12 }, next); // pad
        const tone = g.arp[s]!;
        if (tone >= 0) voice(ac, soften, { f: chord[tone]! * 2, len: step * 0.9, wave: g.arpWave, vol: g.arpWave === "square" ? 0.08 : 0.18 }, next);
        if (g.bass.includes(s)) voice(ac, soften, { f: chord[0]! / 2, len: step * 0.9, wave: "triangle", vol: 0.45 }, next);
        if (g.kick.includes(s)) voice(ac, soften, { f: 150, to: 45, len: 0.14, wave: "sine", vol: 0.7 }, next);
        if (g.snare.includes(s)) voice(ac, soften, { f: 1800, len: 0.09, wave: "noise", vol: 0.18 }, next);
        if (g.hat.includes(s)) voice(ac, soften, { f: 7000, len: 0.03, wave: "noise", vol: 0.08 }, next);
        const lead = g.lead?.[bar]?.[s];
        // Lead only on every other pass so the loop breathes.
        if (lead && Math.floor(i / 32) % 2 === 1) voice(ac, soften, { f: lead, len: step * 1.6, wave: "square", vol: 0.07 }, next);
        next += step;
        i += 1;
      }
    }, 150);
    music = { mood, out, timer };
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
