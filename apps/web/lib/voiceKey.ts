/**
 * The player's own ElevenLabs API key, kept only in this browser. It rides along on voice starts,
 * and the server uses it only once every WorkVerse voice account is out of credits.
 */
const KEY = "workverse.elevenlabsKey";

/** Errors from a voice start that mean "ask the player for their own key". */
export const VOICE_KEY_CODES = new Set(["voice_credits_exhausted", "voice_user_key_invalid", "voice_user_key_exhausted"]);

export function readVoiceKey(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function saveVoiceKey(value: string | null): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the key only lasts until the page closes */
  }
}
