// Warm the heavy lazy chunks before they're needed. Same module specifiers as the real
// imports, so the bundler serves one chunk and the browser caches it.
export function preloadGame() {
  void import("./office").catch(() => {});
}

export function preloadVoice() {
  void import("./VoiceMeeting").catch(() => {});
}

/** Run after the page settles so preloading never competes with first paint. */
export function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 300);
  return () => window.clearTimeout(id);
}
