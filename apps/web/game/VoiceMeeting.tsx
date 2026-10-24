"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversation,
  type MessagePayload,
} from "@elevenlabs/react";
import { api } from "../lib/api";
import { isSignOff } from "../lib/signoff";
import type { SessionView, VoiceNpc, VoiceTranscriptEntry } from "../lib/types";

export type VoicePhase =
  | "connecting"
  | "listening"
  | "speaking"
  | "ended"
  | "error";

type Props = {
  sessionId: string;
  npc: VoiceNpc;
  voiceSessionId: string;
  conversationToken: string;
  contextGrant: string | null;
  dynamicVariables?: Record<string, string>;
  onEnd: () => void;
  /** Skip the talk: get what they know and the next step straight away. */
  onSkip?: () => void;
  /** Called when a voice turn taught the learner something (the server returns the new session). */
  onSession?: (session: SessionView) => void;
  /** Shown once this colleague has told the learner everything: where to go next. */
  handoff?: { text: string; goLabel: string; onGo: () => void; secs: number } | null;
};

const PHASE_LABEL: Record<VoicePhase, string> = {
  connecting: "connecting",
  listening: "listening",
  speaking: "speaking",
  ended: "ended",
  error: "error",
};

/**
 * Wraps the ElevenAgents conversation in a provider. SDK usage is contained here so the rest
 * of the UI never depends on SDK internals.
 */
export function VoiceMeeting(props: Props) {
  return (
    <ConversationProvider>
      <VoiceSession {...props} />
    </ConversationProvider>
  );
}

function VoiceSession({
  sessionId,
  npc,
  voiceSessionId,
  conversationToken,
  contextGrant,
  dynamicVariables,
  onEnd,
  onSkip,
  onSession,
  handoff,
}: Props) {
  const goRef = useRef(handoff?.onGo);
  const byeRef = useRef(false);
  const byeTimer = useRef<number | undefined>(undefined);
  const endRef = useRef<() => void>(() => {});
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;
  const [entries, setEntries] = useState<VoiceTranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("connecting");
  const logRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const conversationIdRef = useRef<string | null>(null);

  const persist = useCallback(
    (id: string, speaker: "user" | "npc", text: string) => {
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);
      // Debounce so an updated/partial segment replaces the stored turn instead of duplicating.
      timersRef.current.set(
        id,
        setTimeout(() => {
          timersRef.current.delete(id);
          api
            .ingestVoiceMessage(sessionId, voiceSessionId, {
              speaker,
              text,
              provider_message_id: id,
              provider_conversation_id: conversationIdRef.current,
            })
            .then((res) => {
              if (res.session) onSessionRef.current?.(res.session);
            })
            .catch(() => {
              /* transcript persistence is best-effort; the server also reconciles */
            });
        }, 600),
      );
    },
    [sessionId, voiceSessionId],
  );

  const handleMessage = useCallback(
    (message: MessagePayload) => {
      const id: string = message.response_id ?? `evt-${message.event_id}`;
      const speaker: "user" | "npc" = message.role === "user" ? "user" : "npc";
      // Drop expressive voice tags like "[calm]": they steer the voice, they aren't words.
      const text = (message.message || "").replace(/\[[a-z][a-z \-]*\]\s*/gi, "").trim();
      if (!text) return;
      // A goodbye from the colleague closes the call once they've finished saying it; anything the
      // learner says afterwards cancels that.
      if (speaker === "npc" && isSignOff(text)) byeRef.current = true;
      if (speaker === "user") {
        byeRef.current = false;
        window.clearTimeout(byeTimer.current);
      }
      setEntries((prev) => {
        const index = prev.findIndex((entry) => entry.id === id);
        if (index === -1) return [...prev, { id, speaker, text, status: "final" }];
        const current = prev[index];
        if (!current) return prev;
        const next = prev.slice();
        next[index] = { ...current, text, speaker, status: "final" };
        return next;
      });
      persist(id, speaker, text);
    },
    [persist],
  );

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      conversationIdRef.current = conversationId;
      setPhase("listening");
    },
    onDisconnect: (details) => {
      const reason = details.reason;
      const closeCode = "closeCode" in details ? details.closeCode : undefined;
      const closeReason = "closeReason" in details ? details.closeReason : undefined;
      const close = closeCode ?? closeReason;
      setPhase("ended");
      if (reason === "agent") {
        // The colleague said goodbye and hung up: close the call like the End button would, after a
        // moment so the last line is saved and seen, and carry on to the next step if there is one.
        setDetail(`${npc.name.split(" ")[0]} ended the call.`);
        window.setTimeout(() => {
          endRef.current();
          goRef.current?.();
        }, 1500);
        return;
      }
      console.warn("[voice] disconnect", details);
      setDetail(`Disconnected (${reason}${close ? ` ${close}` : ""}).`);
    },
    onError: (message, context) => {
      console.error("[voice] error", message, context);
      // The SDK reports provider-side cut-offs (e.g. credits running out mid-call) as a bare "Unknown error".
      setError(
        !message || /unknown error/i.test(message)
          ? "The voice service ended the call (often because voice credits ran out). You can keep going in text chat."
          : message,
      );
      setPhase("error");
    },
    onMessage: handleMessage,
    onModeChange: ({ mode }) => {
      setPhase(mode === "speaking" ? "speaking" : "listening");
      window.clearTimeout(byeTimer.current);
      if (mode !== "speaking" && byeRef.current) {
        byeTimer.current = window.setTimeout(() => {
          setDetail(`${npc.name.split(" ")[0]} ended the call.`);
          endRef.current();
          goRef.current?.();
        }, 2500);
      }
    },
  });

  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  useEffect(() => {
    // Defer the start by a tick and cancel on cleanup. React StrictMode (Next.js dev)
    // mounts, unmounts, then remounts; the provider ends any session on unmount, so
    // starting synchronously would connect and be torn down immediately. Only the
    // surviving mount actually starts the conversation.
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        conversationRef.current.startSession({
          conversationToken,
          customLlmExtraBody: contextGrant ? { context_grant: contextGrant } : undefined,
          dynamicVariables,
        });
      } catch {
        setError("Could not start the voice connection.");
        setPhase("error");
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // dynamicVariables are fixed for the call (set when it starts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationToken, contextGrant]);

  // Stick to the newest line like a chat app, including while a line is still growing.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const node = logRef.current;
      node?.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [entries, handoff]);

  useEffect(() => {
    const timers = timersRef.current;
    const bye = byeTimer;
    return () => {
      window.clearTimeout(bye.current);
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const endMeeting = useCallback(() => {
    try {
      conversation.endSession();
    } catch {
      /* already disconnected */
    }
    api.endVoiceSession(sessionId, voiceSessionId, "user_ended").catch(() => {});
    onEnd();
  }, [conversation, sessionId, voiceSessionId, onEnd]);

  endRef.current = endMeeting;
  // The handoff countdown reached zero: hang up properly and move on.
  goRef.current = handoff?.onGo;
  const autoEnd = handoff != null && handoff.secs <= 0;
  useEffect(() => {
    if (!autoEnd) return;
    endMeeting();
    goRef.current?.();
  }, [autoEnd, endMeeting]);

  const connected = conversation.status === "connected";
  // Only the learner's own Mute button touches the mic. Toggling it on every speaking/listening
  // flip raced the WebRTC track swap and left the mic dead; "let them finish" is the agents'
  // server-side setting instead (interruptions off, scripts/create_voice_agents.py).
  const [userMuted, setUserMuted] = useState(false);
  useEffect(() => {
    if (!connected) return;
    try {
      conversationRef.current.setMuted(userMuted);
    } catch {
      /* disconnected mid-toggle */
    }
  }, [connected, userMuted]);

  return (
    <div
      className="overlay voice-meeting"
      role="dialog"
      aria-label={`Voice meeting with ${npc.name}, ${npc.role}`}
      data-testid="voice-meeting"
    >
      <div className="voice-meeting__head">
        <div>
          <span className="eyebrow">Voice · {npc.role}</span>
          <strong className="section-title" style={{ fontSize: 18 }}>
            {npc.name}
          </strong>
        </div>
        <span
          className={`badge${connected ? " badge--active" : ""}`}
          data-testid="voice-status"
        >
          <span className={`voice-bars${phase === "speaking" || phase === "listening" ? "" : " is-still"}`} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {PHASE_LABEL[phase]}
        </span>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Voice status: {PHASE_LABEL[phase]}
      </p>

      <div className="voice-transcript" ref={logRef} data-testid="voice-transcript" aria-live="polite">
        {entries.length === 0 ? (
          <p className="xsmall muted">Speak naturally — {npc.name} will reply. Your words appear here.</p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`voice-entry voice-entry--${entry.speaker}`}
              data-speaker={entry.speaker}
            >
              <span className="voice-entry__who">{entry.speaker === "user" ? "You" : npc.name}</span>
              {entry.text}
            </div>
          ))
        )}
      </div>

      {error && (
        <div className="banner banner--error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {detail && (
        <p className="xsmall muted" data-testid="voice-detail" style={{ marginTop: 4 }}>
          {detail}
        </p>
      )}

      {handoff && (
        <div className="handoff" role="status" data-testid="voice-handoff" style={{ marginTop: 8 }}>
          <strong>✓ {npc.name.split(" ")[0]} has told you what they know.</strong>
          <span className="xsmall">Next: {handoff.text}</span>
          <div className="chip-row">
            <button
              className="btn btn--small"
              data-testid="voice-handoff-go"
              onClick={() => {
                endMeeting();
                handoff.onGo();
              }}
            >
              {handoff.goLabel} ({handoff.secs}s)
            </button>
          </div>
        </div>
      )}

      <div className="voice-meeting__controls">
        {onSkip && (
          <button type="button" className="btn btn--ghost btn--small" data-testid="voice-skip" onClick={onSkip}>
            Skip ▶ what they know
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          data-testid="voice-mute"
          disabled={!connected}
          aria-pressed={userMuted}
          onClick={() => setUserMuted((v) => !v)}
        >
          {userMuted ? "Unmute mic" : "Mute mic"}
        </button>
        <button
          type="button"
          className="btn btn--small"
          data-testid="voice-end"
          onClick={endMeeting}
        >
          End voice
        </button>
      </div>
    </div>
  );
}
