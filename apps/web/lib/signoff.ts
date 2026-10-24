// Spotting a colleague's goodbye in a voice call, so the call can close itself when the agent
// says goodbye but forgets to hang up.

const BYE =
  /\b(bye|goodbye|see you|talk (?:to you )?(?:soon|later|at|then|in|before|after|tomorrow)|speak (?:soon|later|then)|catch you|good luck|i'?ll (?:wait for|expect|look out for) your (?:update|message)|ping me (?:if|when)|take care|have a good)\b/i;

/** True when the line closes the conversation and doesn't hand a question back. */
export function isSignOff(text: string): boolean {
  const t = text.trim();
  return BYE.test(t) && !/\?\s*$/.test(t);
}
