"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cueFor, isMusicOn, isMuted, onSoundChange, play, setMusicOn, setMuted, startMusic, stopMusic, suspendAudio, type Mood } from "../lib/sfx";

const CLICKABLE =
  "button, a[href], summary, select, label, [role=button], [role=tab], [role=switch], input[type=checkbox], input[type=radio]";

/** Music mood per page; null = no music (landing and auth pages stay quiet). */
export function moodFor(pathname: string): Mood | null {
  if (pathname === "/" || /^\/(login|signup|onboarding)/.test(pathname)) return null;
  return pathname.startsWith("/session/") && !pathname.endsWith("/debrief") ? "focus" : "calm";
}

/** Mounted once at the root: a click sound for every control, plus background music by page. */
export function SoundLayer() {
  const pathname = usePathname();
  const mood = moodFor(pathname);
  const gestured = useRef(false);
  const moodRef = useRef(mood);

  useEffect(() => {
    let hovered: Element | null = null;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t instanceof HTMLInputElement && t.closest("label")) return; // the label's synthetic re-click
      const el = t?.closest?.(CLICKABLE);
      if (el && !el.matches(":disabled, [aria-disabled=true]")) {
        const cue = cueFor(el);
        if (cue) play(cue);
      }
    };
    // Browsers only allow audio after a user gesture, so music starts on the first press of
    // anything — a key (walking with WASD/arrows counts) or the mouse, not just a click.
    const onGesture = (e: Event) => {
      if (gestured.current || (e instanceof KeyboardEvent && e.key === "Escape")) return;
      gestured.current = true;
      if (moodRef.current) startMusic(moodRef.current);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.(CLICKABLE) ?? null;
      if (el && el !== hovered && !el.matches(":disabled")) play("hover");
      hovered = el;
    };
    const onVisibility = () => suspendAudio(document.hidden);
    document.addEventListener("click", onClick, true);
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    moodRef.current = mood;
    if (!gestured.current) return;
    if (mood) startMusic(mood);
    else stopMusic();
  }, [mood]);

  return null;
}

/** "Sound on/off" and "Music on/off" buttons; shown in the sidebar and the session top bar. */
export function SoundToggles() {
  const pathname = usePathname();
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicState] = useState(true);
  useEffect(() => {
    const sync = () => {
      setSfxOn(!isMuted());
      setMusicState(isMusicOn());
    };
    sync();
    return onSoundChange(sync);
  }, []);

  return (
    <div className="row" style={{ gap: 6 }}>
      <button
        className="btn btn--ghost btn--small"
        aria-pressed={sfxOn}
        title={sfxOn ? "Mute sound effects" : "Turn sound effects on"}
        onClick={() => {
          setMuted(sfxOn);
          setSfxOn(!sfxOn);
          if (!sfxOn) play("on"); // the click listener ran while still muted
        }}
      >
        {sfxOn ? "Sound on" : "Sound off"}
      </button>
      <button
        className="btn btn--ghost btn--small"
        aria-pressed={musicOn}
        title={musicOn ? "Turn background music off" : "Turn background music on"}
        onClick={() => {
          setMusicOn(!musicOn, moodFor(pathname) ?? "calm");
          setMusicState(!musicOn);
        }}
      >
        {musicOn ? "Music on" : "Music off"}
      </button>
    </div>
  );
}
