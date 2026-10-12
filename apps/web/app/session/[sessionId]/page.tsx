"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { PhaserGame, type PhaserGameHandle } from "../../../game/PhaserGame";
import type { NavigationStatus } from "../../../game/navigation";
import { api, ApiError } from "../../../lib/api";
import type { SessionView, TranscriptMessage, VoiceNpc, WorldAction } from "../../../lib/types";

// Browser-only SDK; never evaluated during SSR.
const VoiceMeeting = dynamic(
  () => import("../../../game/VoiceMeeting").then((mod) => mod.VoiceMeeting),
  { ssr: false },
);

type VoiceStartState = {
  npc: VoiceNpc;
  voiceSessionId: string;
  conversationToken: string;
  contextGrant: string | null;
};

type GuideStep = { title: string; body: string; room?: string; character?: string };

function statusBadge(status: string) {
  if (status === "completed") return "badge badge--ok";
  if (status === "active") return "badge badge--active";
  return "badge";
}

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();

  const gameRef = useRef<PhaserGameHandle>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const [session, setSession] = useState<SessionView | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [updateText, setUpdateText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [guideOn, setGuideOn] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [objectMenu, setObjectMenu] = useState<string | null>(null);
  const [nearCharacter, setNearCharacter] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceStartState | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [routeVisible, setRouteVisible] = useState(true);
  const [navStatus, setNavStatus] = useState<NavigationStatus>("idle");
  const interactionLocked = useRef(false);
  const voicePending = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api.getSession(sessionId), api.transcript(sessionId)]);
      setSession(s);
      setMessages(t.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the session.");
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages.length]);

  // Push the active task's destination into the Phaser navigation overlay whenever the
  // task state changes. Pathfinding stays in the scene so React never ticks per frame.
  const navigation = session?.navigation ?? null;
  useEffect(() => {
    if (!gameReady) return;
    gameRef.current?.setNavigationTarget(navigation);
  }, [gameReady, navigation]);

  useEffect(() => {
    if (!gameReady) return;
    gameRef.current?.setNavigationVisible(routeVisible);
  }, [gameReady, routeVisible]);

  const actions = session?.world.actions ?? [];
  const characters = session?.world.characters ?? [];

  const guideSteps = useMemo<GuideStep[]>(() => {
    if (!session) return [];
    const done = (id: string) => session.objectives.find((o) => o.id === id)?.status === "completed";
    const knows = (id: string) => session.facts_known.some((f) => f.id === id);
    const steps: GuideStep[] = [];
    if (!done("o_establish_impact"))
      steps.push({
        title: "Establish the impact",
        body: "Open the chat with your manager and ask what the customer impact and reporting deadline are.",
        character: "manager",
      });
    if (!knows("f_migration_ran"))
      steps.push({
        title: "Find out what shipped",
        body: "Ask your engineering teammate whether the deployment included a database migration.",
        character: "teammate",
      });
    if (!done("o_gather_evidence"))
      steps.push({
        title: "Investigate evidence",
        body: "Walk to the engineering workspace and inspect the application logs (walk up to the console and press E, or click it).",
        room: "engineering_workspace",
      });
    if (!done("o_identify_risk"))
      steps.push({
        title: "Check rollback safety",
        body: "Open the migration notes and check whether the migration is compatible before reverting.",
        room: "engineering_workspace",
      });
    if (!done("o_choose_mitigation"))
      steps.push({
        title: "Mitigate safely",
        body: "At the deployment console, choose your mitigation — roll back or apply the forward fix.",
        room: "engineering_workspace",
      });
    if (!done("o_communicate"))
      steps.push({
        title: "Update stakeholders",
        body: "Write a clear status update in the “Stakeholder update” panel: impact, cause, action, next update and owner.",
      });
    steps.push({
      title: "Finish and debrief",
      body: "When every required objective is complete, hit “Complete & debrief” to get your evidence-grounded report.",
    });
    return steps;
  }, [session]);

  useEffect(() => {
    if (guideOn) setGuideIndex(0);
  }, [guideOn]);

  const actionsByObject = useMemo(() => {
    const map = new Map<string, WorldAction[]>();
    for (const a of actions) {
      if (a.target_id) {
        const list = map.get(a.target_id) ?? [];
        list.push(a);
        map.set(a.target_id, list);
      }
    }
    return map;
  }, [actions]);

  const runAction = useCallback(
    async (action: WorldAction, payload?: Record<string, unknown>) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await api.submitAction(sessionId, {
          client_action_id: crypto.randomUUID(),
          expected_state_version: session.state_version,
          type: action.id,
          payload: payload ?? {},
        });
        setSession(res.session);
        setMessages((await api.transcript(sessionId)).items);
        const newly = res.state_delta?.newly_discovered_fact_ids as string[] | undefined;
        if (newly?.length) setNotice(`New information: ${newly.join(", ")}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          await load();
          setError("The session changed; state refreshed. Try again.");
        } else {
          setError(e instanceof ApiError ? e.message : "Action failed.");
        }
      } finally {
        setBusy(false);
      }
    },
    [session, sessionId, load],
  );

  const interactObject = useCallback(
    (objectId: string) => {
      const list = (actionsByObject.get(objectId) ?? []).filter((a) => a.action_type !== "navigate");
      if (list.length === 0) {
        setNotice("Nothing to do here yet.");
        return;
      }
      if (list.length > 1) {
        setObjectMenu(objectId);
        return;
      }
      const only = list[0];
      if (!only) return;
      if (!only.ready) {
        setError(only.locked_reason ?? "This action is not available yet.");
        return;
      }
      if (only.requires_text) {
        setNotice(`Compose your text for “${only.label}” in the panel, then submit.`);
        return;
      }
      runAction(only);
    },
    [actionsByObject, runAction],
  );

  const openCharacter = useCallback((characterId: string) => {
    setActiveCharacter(characterId);
    gameRef.current?.focusCharacter(characterId);
  }, []);

  const startVoiceMeeting = useCallback(
    async (characterId: string) => {
      if (interactionLocked.current || voicePending.current) return;
      const npc = characters.find((c) => c.id === characterId);
      if (!npc) return;
      voicePending.current = true;
      setVoiceError(null);
      setNotice(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Microphone access is not available in this browser.");
        }
        // Explain-then-request: this runs inside the E-key user gesture.
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const res = await api.startVoiceSession(sessionId, {
          npc_id: characterId,
          client_request_id: crypto.randomUUID(),
        });
        interactionLocked.current = true;
        setVoice({
          npc: res.npc,
          voiceSessionId: res.voice_session_id,
          conversationToken: res.conversation_token,
          contextGrant: res.context_grant,
        });
      } catch (e) {
        const denied = e instanceof DOMException && e.name === "NotAllowedError";
        setVoiceError(
          denied
            ? "Microphone access was denied. You can keep using text chat."
            : e instanceof ApiError
              ? e.message
              : e instanceof Error
                ? e.message
                : "Could not start the voice meeting.",
        );
      } finally {
        voicePending.current = false;
      }
    },
    [characters, sessionId],
  );

  const endVoiceMeeting = useCallback(async () => {
    interactionLocked.current = false;
    setVoice(null);
    await load();
  }, [load]);

  const sendMessage = useCallback(async () => {
    if (!session || !activeCharacter || !chatInput.trim()) return;
    setSending(true);
    setError(null);
    const text = chatInput.trim();
    setChatInput("");
    try {
      const res = await api.submitTurn(sessionId, {
        client_turn_id: crypto.randomUUID(),
        expected_state_version: session.state_version,
        character_id: activeCharacter,
        message: text,
      });
      setSession(res.session);
      setMessages((await api.transcript(sessionId)).items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await load();
        setError("The session changed; state refreshed. Please resend.");
      } else {
        setError(e instanceof ApiError ? e.message : "Message failed.");
      }
    } finally {
      setSending(false);
    }
  }, [session, activeCharacter, chatInput, sessionId, load]);

  const finish = useCallback(
    async (force: boolean) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      try {
        await api.complete(sessionId, { expected_state_version: session.state_version, force });
        router.push(`/session/${sessionId}/debrief`);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not complete the session.");
        setBusy(false);
      }
    },
    [session, sessionId, router],
  );

  if (!session) {
    return (
      <div className="sim-full">
        <div className="spinner" style={{ margin: "auto" }}>
          {error ?? "Loading simulation…"}
        </div>
      </div>
    );
  }

  const incident = session.incident as Record<string, unknown>;
  const activeName = characters.find((c) => c.id === activeCharacter)?.name;
  const chatMessages = activeCharacter
    ? messages.filter((m) => (m.speaker_type === "learner" && !m.character_id) || m.character_id === activeCharacter)
    : [];
  const currentStep = guideSteps[Math.min(guideIndex, guideSteps.length - 1)];
  const doneCount = session.objectives.filter((o) => o.status === "completed").length;
  const nextObjective =
    session.objectives.find((o) => o.required && o.status !== "completed") ??
    session.objectives.find((o) => o.status !== "completed");
  const nextStep = guideSteps[0];
  const menuLabel = objectMenu
    ? session.world.objects.find((o) => o.id === objectMenu)?.label ?? "Actions"
    : "";
  const destLabel =
    navigation?.target_type === "character" && navigation.target_id
      ? characters.find((c) => c.id === navigation.target_id)?.name ?? navigation.objective_label
      : navigation?.target_type === "object" && navigation.target_id
        ? session.world.objects.find((o) => o.id === navigation.target_id)?.label ??
          navigation.action_label ??
          navigation.objective_label
        : navigation?.action_label ?? navigation?.objective_label ?? "Destination";

  return (
    <div className="sim-full">
      <div className="sim-full__bar">
        <div>
          <p className="eyebrow" style={{ fontSize: 10 }}>
            {String(incident.service ?? "service")} · {String(incident.severity ?? "?")} severity
          </p>
          <strong style={{ letterSpacing: "0.14em", textTransform: "uppercase", fontSize: 12 }}>
            {session.phase} · v{session.state_version}
          </strong>
        </div>
        <div className="row">
          <span className={statusBadge(session.status)}>{session.status}</span>
          <button className="btn btn--ghost btn--small" onClick={() => finish(true)} disabled={busy}>
            End session
          </button>
          <button
            className="btn btn--small"
            data-testid="complete"
            onClick={() => finish(false)}
            disabled={busy || !session.completion.ready}
            title={session.completion.ready ? "Complete and get debrief" : "Finish all required objectives first"}
          >
            Complete &amp; debrief
          </button>
        </div>
      </div>

      <div className="sim-full__body">
        <div className="sim-full__game">
          <PhaserGame
            ref={gameRef}
            world={session.world}
            sessionId={sessionId}
            playerTexture="blonde_man"
            onPrompt={setPrompt}
            onNearCharacter={setNearCharacter}
            onInteractCharacter={openCharacter}
            onVoiceCharacter={startVoiceMeeting}
            onInteractObject={interactObject}
            onLocationChange={() => {}}
            onNavigationStatus={setNavStatus}
            onReady={() => setGameReady(true)}
            isLocked={() => interactionLocked.current}
          />
          {!gameReady && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#e7e6db" }} className="spinner">
              Loading office…
            </div>
          )}
          {!voice && prompt && !guideOn && (
            <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "#e7e6db", border: "1px solid #222c21", padding: "6px 12px", fontSize: 12 }}>
              {nearCharacter ? (
                <>
                  Press <strong>E</strong> to talk to{" "}
                  {characters.find((c) => c.id === nearCharacter)?.name ?? prompt}
                </>
              ) : (
                <>
                  Press <strong>E</strong> to interact with {prompt}
                </>
              )}
            </div>
          )}
          {voiceError && !voice && (
            <div
              className="banner banner--error"
              role="alert"
              data-testid="voice-error"
              style={{ position: "absolute", top: 46, left: "50%", transform: "translateX(-50%)", width: "min(420px, calc(100% - 24px))" }}
            >
              {voiceError}
            </div>
          )}
          {navigation && !voice && (
            <div className="nav-chip" data-testid="nav-chip">
              <div className="row between" style={{ gap: 8, alignItems: "center" }}>
                <span className="eyebrow" style={{ fontSize: 9 }}>
                  Route
                </span>
                {navigation.target_type === "none" ? (
                  <span className="small muted" style={{ flex: 1 }}>
                    {navigation.reason ?? "Complete this step in the side panel."}
                  </span>
                ) : (
                  <>
                    <strong className="small" style={{ flex: 1 }} data-testid="nav-destination">
                      {destLabel}
                    </strong>
                    <button
                      className="btn btn--ghost btn--small"
                      data-testid="toggle-route"
                      onClick={() => setRouteVisible((v) => !v)}
                    >
                      {routeVisible ? "Hide route" : "Show route"}
                    </button>
                  </>
                )}
              </div>
              {navigation.target_type !== "none" && (
                <p
                  className={`small${navStatus === "unreachable" ? " nav-chip__warn" : ""}`}
                  data-testid="nav-status"
                  style={{ marginTop: 4 }}
                >
                  {navStatus === "arrived"
                    ? "You’ve arrived — press E to interact."
                    : navStatus === "unreachable"
                      ? "Route unavailable — try another accessible destination."
                      : navigation.ready
                        ? "Follow the glowing path on the floor."
                        : navigation.reason ?? "Follow the path to continue."}
                </p>
              )}
            </div>
          )}
          {voice && (
            <VoiceMeeting
              sessionId={sessionId}
              npc={voice.npc}
              voiceSessionId={voice.voiceSessionId}
              conversationToken={voice.conversationToken}
              contextGrant={voice.contextGrant}
              onEnd={endVoiceMeeting}
            />
          )}

          <div className="hud-objectives" aria-label="Objectives">
            <div className="hud-objectives__head">
              <span className="eyebrow" style={{ fontSize: 10 }}>
                Objectives
              </span>
              <span className="hud-objectives__count">
                {doneCount}/{session.objectives.length}
              </span>
            </div>
            <ul className="list-reset">
              {session.objectives.map((o) => {
                const done = o.status === "completed";
                const isNext = !done && o.id === nextObjective?.id;
                return (
                  <li
                    key={o.id}
                    className={`hud-objective${done ? " is-done" : ""}${isNext ? " is-next" : ""}`}
                  >
                    <span className="hud-objective__mark">{done ? "✓" : "○"}</span>
                    <span>{o.label}</span>
                  </li>
                );
              })}
            </ul>
            {nextStep && (
              <div className="hud-objectives__next">
                <span className="eyebrow" style={{ fontSize: 9 }}>
                  Next
                </span>
                <p>
                  <strong>{nextStep.title}.</strong> {nextStep.body}
                </p>
              </div>
            )}
          </div>

          {objectMenu && (
            <div className="object-menu" role="dialog" aria-label={`Actions at ${menuLabel}`}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <h3 style={{ fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {menuLabel}
                </h3>
                <button className="btn btn--ghost btn--small" onClick={() => setObjectMenu(null)}>
                  Close
                </button>
              </div>
              <ul className="list-reset stack stack--sm">
                {(actionsByObject.get(objectMenu) ?? [])
                  .filter((a) => a.action_type !== "navigate")
                  .map((a) => (
                    <li key={a.id}>
                      <button
                        data-testid={`menu-action-${a.id}`}
                        className="btn btn--ghost btn--small"
                        style={{ width: "100%", textAlign: "left" }}
                        disabled={busy || !a.ready}
                        onClick={() => {
                          setObjectMenu(null);
                          if (a.requires_text) {
                            setNotice(`Use the “Stakeholder update” panel to submit “${a.label}”.`);
                            return;
                          }
                          runAction(a);
                        }}
                        title={a.locked_reason ?? a.description}
                      >
                        {a.label}
                        {!a.ready && <span className="muted"> · locked</span>}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <AnimatePresence>
            {guideOn && currentStep && (
              <motion.div
                className="guide-panel"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.22 }}
              >
                <div className="guide-panel__head">
                  <span className="eyebrow" style={{ fontSize: 10 }}>
                    Guide · step {guideIndex + 1} of {guideSteps.length}
                  </span>
                  <button className="btn btn--ghost btn--small" onClick={() => setGuideOn(false)}>
                    Stop guide
                  </button>
                </div>
                <h3 style={{ fontSize: 15, marginBottom: 6 }}>{currentStep.title}</h3>
                <p className="small muted">{currentStep.body}</p>
                <div className="row" style={{ marginTop: 12 }}>
                  {currentStep.character && (
                    <button className="btn btn--small" onClick={() => openCharacter(currentStep.character!)}>
                      Open chat
                    </button>
                  )}
                  {currentStep.room && (
                    <button className="btn btn--small" onClick={() => gameRef.current?.travelTo(currentStep.room!)}>
                      Take me there
                    </button>
                  )}
                  <button className="btn btn--ghost btn--small" onClick={() => setGuideIndex((i) => Math.max(0, i - 1))} disabled={guideIndex === 0}>
                    Back
                  </button>
                  <button className="btn btn--ghost btn--small" onClick={() => setGuideIndex((i) => Math.min(guideSteps.length - 1, i + 1))} disabled={guideIndex >= guideSteps.length - 1}>
                    Next
                  </button>
                </div>
                <div className="guide-step-dots">
                  {guideSteps.map((_, i) => (
                    <button key={i} className={i === guideIndex ? "is-on" : ""} onClick={() => setGuideIndex(i)} aria-label={`Step ${i + 1}`} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button className="guide-toggle" onClick={() => setGuideOn((v) => !v)}>
            {guideOn ? "Hide guide" : "Need help? Show guide"}
          </button>
        </div>

        <aside className="sim-full__side">
          {error && <div className="banner banner--error" role="alert">{error}</div>}
          {notice && <div className="banner banner--info">{notice}</div>}

          <section className="panel stack stack--sm">
            <h2 className="section-title">Known information</h2>
            {session.facts_known.length === 0 ? (
              <p className="small muted">Nothing established yet.</p>
            ) : (
              <ul className="list-reset stack stack--sm">
                {session.facts_known.map((f) => (
                  <li key={f.id} className="small">
                    <strong>{f.label}.</strong> <span className="muted">{f.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="sr-only" aria-label="All available actions">
            <h2 className="section-title">Workplace actions</h2>
            <ul className="list-reset stack stack--sm">
              {actions
                .filter((a) => a.action_type !== "navigate")
                .map((a) => (
                  <li key={a.id}>
                    <button
                      data-testid={`action-${a.id}`}
                      className="btn btn--ghost btn--small"
                      style={{ width: "100%", textAlign: "left" }}
                      disabled={busy || !a.ready}
                      onClick={() => (a.requires_text ? setNotice(`Use the “Stakeholder update” panel to submit “${a.label}”.`) : runAction(a))}
                      title={a.locked_reason ?? a.description}
                    >
                      {a.label}
                      {!a.ready && <span className="muted"> · locked</span>}
                    </button>
                  </li>
                ))}
            </ul>
          </section>

          {actions.some((a) => a.id === "a_send_status_update" && a.ready) && (
            <section className="panel stack stack--sm">
              <h2 className="section-title">Stakeholder update</h2>
              <textarea
                className="textarea"
                data-testid="status-update"
                placeholder="Impact, cause, action taken, next update time, owner…"
                value={updateText}
                onChange={(e) => setUpdateText(e.target.value)}
              />
              <button
                className="btn btn--small"
                data-testid="send-status-update"
                disabled={busy || updateText.trim().length < 10}
                onClick={() => {
                  const action = actions.find((a) => a.id === "a_send_status_update");
                  if (action) runAction(action, { text: updateText.trim() });
                }}
              >
                Send status update
              </button>
            </section>
          )}

          <section className="panel stack stack--sm" style={{ minHeight: 240 }}>
            <div className="row between">
              <h2 className="section-title">{activeName ? `Chat · ${activeName}` : "Conversation"}</h2>
              <div className="row" style={{ gap: 6 }}>
                {characters.map((c) => (
                  <button
                    key={c.id}
                    data-testid={`talk-${c.id}`}
                    className={c.id === activeCharacter ? "btn btn--small" : "btn btn--ghost btn--small"}
                    onClick={() => openCharacter(c.id)}
                    title={`Talk to ${c.name}`}
                  >
                    {c.name.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
            {!activeCharacter ? (
              <p className="small muted">Pick a colleague above, then ask a question. Or walk to them and press E.</p>
            ) : (
              <>
                <div ref={transcriptRef} data-testid="chat-log" style={{ flex: 1, overflowY: "auto", maxHeight: 260, display: "flex", flexDirection: "column", gap: 10 }}>
                  {chatMessages.length === 0 && <p className="small muted">Start the conversation.</p>}
                  {chatMessages.map((m) => (
                    <motion.div
                      key={m.id}
                      className={`bubble${m.speaker_type === "learner" ? " bubble--learner" : ""}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span className="bubble__who">{m.speaker_type === "learner" ? "You" : activeName}</span>
                      {m.content}
                    </motion.div>
                  ))}
                </div>
                <div className="row" style={{ alignItems: "flex-end" }}>
                  <textarea
                    className="textarea"
                    data-testid="chat-input"
                    style={{ minHeight: 56, flex: 1 }}
                    placeholder="Ask a question…"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <button className="btn btn--small" data-testid="chat-send" onClick={sendMessage} disabled={sending || !chatInput.trim()}>
                    {sending ? "…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
