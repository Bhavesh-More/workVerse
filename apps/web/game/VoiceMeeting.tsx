"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversation,
  type MessagePayload,
} from "@elevenlabs/react";
import { api } from "../lib/api";
import type { VoiceNpc, VoiceTranscriptEntry } from "../lib/types";

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
  onEnd: () => void;
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
  onEnd,
}: Props) {
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
      const text = (message.message || "").trim();
      if (!text) return;
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
      const message =
        reason === "agent"
          ? "The character ended the call. Check the agent's LLM/voice configuration."
          : `Disconnected (${reason}${close ? ` ${close}` : ""}).`;
      console.warn("[voice] disconnect", details);
      setDetail(message);
      setPhase("ended");
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
  }, [conversationToken, contextGrant]);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    if (nearBottom) node.scrollTo({ top: node.scrollHeight });
  }, [entries.length]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
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

      <div className="voice-meeting__controls">
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
