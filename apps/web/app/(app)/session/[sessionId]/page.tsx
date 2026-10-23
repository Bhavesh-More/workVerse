"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, m } from "framer-motion";
import { PhaserGame, type PhaserGameHandle } from "../../../../game/PhaserGame";
import { preloadVoice } from "../../../../game/preload";
import { SimSkeleton } from "../../../../components/Skeletons";
import type { NavigationStatus } from "../../../../game/navigation";
import { api, ApiError } from "../../../../lib/api";
import type { SessionView, TranscriptMessage, VoiceNpc, WorldAction } from "../../../../lib/types";
import {
  actionsByObject as groupActionsByObject,
  buildGuideSteps,
  destinationLabel,
  nextObjective as findNextObjective,
  suggestedQuestions,
  wordCount,
} from "../../../../lib/practice";
import { isMuted, play, setMuted } from "../../../../lib/sfx";

// Browser-only SDK; never evaluated during SSR.
const VoiceMeeting = dynamic(
  () => import("../../../../game/VoiceMeeting").then((mod) => mod.VoiceMeeting),
  { ssr: false },
);

type VoiceStartState = {
  npc: VoiceNpc;
  voiceSessionId: string;
  conversationToken: string;
  contextGrant: string | null;
};

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
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  useEffect(() => setMutedState(isMuted()), []);
  const completedIds = useRef<Set<string> | null>(null);
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

  // The voice SDK (~600 KB) is only needed once the learner can press E next to someone.
  useEffect(() => {
    if (nearCharacter) preloadVoice();
  }, [nearCharacter]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pendingText]);

  // Celebrate each objective the moment the server marks it complete (not on first load).
  useEffect(() => {
    if (!session) return;
    const done = new Set(session.objectives.filter((o) => o.status === "completed").map((o) => o.id));
    const prev = completedIds.current;
    completedIds.current = done;
    if (!prev) return;
    const fresh = session.objectives.find((o) => done.has(o.id) && !prev.has(o.id));
    if (fresh) {
      setToast(fresh.label);
      play("objective");
    }
  }, [session]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

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

  const guideSteps = useMemo(() => (session ? buildGuideSteps(session) : []), [session]);

  useEffect(() => {
    if (guideOn) setGuideIndex(0);
  }, [guideOn]);

  const actionsByObject = useMemo(() => groupActionsByObject(actions), [actions]);

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
        if (newly?.length) {
          const labels = newly.map((id) => res.session.facts_known.find((f) => f.id === id)?.label ?? id);
          setNotice(`New information: ${labels.join(" · ")}`);
          play("discover");
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          await load();
          setError("The session changed; state refreshed. Try again.");
        } else {
          setError(e instanceof ApiError ? e.message : "Action failed.");
          play("error");
        }
      } finally {
        setBusy(false);
      }
    },
    [session, sessionId, load],
  );

  const interactObject = useCallback(
    (objectId: string) => {
      const list = actionsByObject.get(objectId) ?? [];
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

  const sendMessage = useCallback(async (override?: string) => {
    const text = (override ?? chatInput).trim();
    if (!session || !activeCharacter || !text) return;
    setSending(true);
    setError(null);
    play("send");
    setChatInput("");
    setPendingText(text);
    try {
      const res = await api.submitTurn(sessionId, {
        client_turn_id: crypto.randomUUID(),
        expected_state_version: session.state_version,
        character_id: activeCharacter,
        message: text,
      });
      setSession(res.session);
      setMessages((await api.transcript(sessionId)).items);
      play(res.newly_discovered_facts.length ? "discover" : "receive");
    } catch (e) {
      play("error");
      if (e instanceof ApiError && e.status === 409) {
        await load();
        setError("The session changed; state refreshed. Please resend.");
      } else {
        setError(e instanceof ApiError ? e.message : "Message failed.");
      }
      setChatInput(text); // give the learner their words back to resend
    } finally {
      setPendingText(null);
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
        play("complete");
        router.push(`/session/${sessionId}/debrief`);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not complete the session.");
        setBusy(false);
      }
    },
    [session, sessionId, router],
  );

  if (!session && !error) return <SimSkeleton />;
  if (!session) {
    return (
      <div className="sim-full" style={{ display: "grid", placeItems: "center" }}>
        {error ? (
          <div className="stack" style={{ maxWidth: 420, padding: 16 }}>
            <div className="banner banner--error" role="alert">
              {error}
            </div>
            <Link className="btn btn--ghost" href="/dashboard" style={{ alignSelf: "flex-start" }}>
              Back to dashboard
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  const incident = session.incident as Record<string, unknown>;
  const activeName = characters.find((c) => c.id === activeCharacter)?.name;
  const chatMessages = activeCharacter
    ? messages.filter((msg) => msg.character_id === activeCharacter)
    : [];
  const draftWords = wordCount(chatInput);
  const suggestions = activeCharacter ? suggestedQuestions(session, activeCharacter) : [];
  const currentStep = guideSteps[Math.min(guideIndex, guideSteps.length - 1)];
  const doneCount = session.objectives.filter((o) => o.status === "completed").length;
  const nextObjective = findNextObjective(session.objectives);
  const nextStep = guideSteps[0];
  const menuLabel = objectMenu
    ? session.world.objects.find((o) => o.id === objectMenu)?.label ?? "Actions"
    : "";
  const destLabel = destinationLabel(session);
  const live = session.status === "active";
  const pop = { initial: { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } };

  return (
    <div className="sim-full">
      <div className="sim-full__bar">
        <div className="sim-full__title">
          <Link href="/dashboard" className="sidebar__mark" aria-label="Back to dashboard" title="Dashboard">
            W
          </Link>
          <div>
            <span className="eyebrow" style={{ marginBottom: 6 }}>
              {String(incident.service ?? "service")} · {String(incident.severity ?? "?")} severity
            </span>
            <span className="mono">
              {session.phase} · {doneCount}/{session.objectives.length} done
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn--ghost btn--small"
            aria-pressed={!muted}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
            title={muted ? "Turn sound effects on" : "Mute sound effects"}
          >
            {muted ? "Sound off" : "Sound on"}
          </button>
          <span className={statusBadge(session.status)}>
            <span className={`dot${live ? " dot--live" : " dot--idle"}`} aria-hidden="true" />
            {session.status}
          </span>
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
            <div className="game-loading">
              <span className="mono busy-dots">Loading office</span>
            </div>
          )}
          <AnimatePresence>
            {!voice && prompt && !guideOn && (
              <m.div key="prompt" className="overlay prompt-chip" {...pop} transition={{ duration: 0.18 }}>
                <span>
                  Press <span className="kbd">E</span>{" "}
                  {nearCharacter
                    ? `to talk to ${characters.find((c) => c.id === nearCharacter)?.name ?? prompt}`
                    : `to interact with ${prompt}`}
                </span>
              </m.div>
            )}
          </AnimatePresence>
          {voiceError && !voice && (
            <div
              className="banner banner--error"
              role="alert"
              data-testid="voice-error"
              style={{ position: "absolute", top: 56, left: "50%", translate: "-50% 0", width: "min(420px, calc(100% - 24px))", zIndex: 3 }}
            >
              {voiceError}
            </div>
          )}
          {navigation && !voice && (
            <div className="overlay nav-chip" data-testid="nav-chip">
              <div className="row between" style={{ gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
                <span className="eyebrow">Route</span>
                {navigation.target_type === "none" ? (
                  <span className="xsmall muted" style={{ flex: 1 }}>
                    {navigation.reason ?? "Complete this step in the side panel."}
                  </span>
                ) : (
                  <>
                    <strong className="xsmall" style={{ flex: 1 }} data-testid="nav-destination">
                      {destLabel}
                    </strong>
                    <button
                      className="btn btn--ghost btn--small"
                      data-testid="toggle-route"
                      aria-pressed={!routeVisible}
                      onClick={() => setRouteVisible((v) => !v)}
                    >
                      {routeVisible ? "Hide route" : "Show route"}
                    </button>
                  </>
                )}
              </div>
              {navigation.target_type !== "none" && (
                <p
                  className={`xsmall${navStatus === "unreachable" ? " nav-chip__warn" : " muted"}`}
                  data-testid="nav-status"
                  style={{ marginTop: 6 }}
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

          <div className="overlay hud-objectives" aria-label="Objectives">
            <div className="hud-objectives__head">
              <span className="eyebrow">Objectives</span>
              <span className="mono">
                {doneCount}/{session.objectives.length}
              </span>
            </div>
            <div className="track" style={{ height: 4, marginBottom: 8 }} aria-hidden="true">
              <m.span
                initial={false}
                animate={{ width: `${(doneCount / Math.max(1, session.objectives.length)) * 100}%` }}
                transition={{ type: "spring", stiffness: 200, damping: 28 }}
                style={{ background: "var(--color-signal-green)" }}
              />
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
                    <m.span
                      key={done ? "done" : "todo"}
                      className="hud-objective__mark"
                      initial={done ? { scale: 0.4 } : false}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 600, damping: 18 }}
                      aria-hidden="true"
                    >
                      {done ? "✓" : ""}
                    </m.span>
                    <span>
                      <span className="sr-only">{done ? "Done: " : "To do: "}</span>
                      {o.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            {nextStep && (
              <div className="hud-objectives__next">
                <span className="eyebrow">Next</span>
                <p>
                  <strong>{nextStep.title}.</strong> {nextStep.body}
                </p>
              </div>
            )}
          </div>

          <AnimatePresence>
            {objectMenu && (
              <m.div
                key="menu"
                className="overlay object-menu"
                role="dialog"
                aria-label={`Actions at ${menuLabel}`}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.16 }}
              >
                <div className="row between" style={{ marginBottom: 12 }}>
                  <h3 className="section-title" style={{ fontSize: 18 }}>
                    {menuLabel}
                  </h3>
                  <button className="btn btn--ghost btn--small" onClick={() => setObjectMenu(null)}>
                    Close
                  </button>
                </div>
                <ul className="list-reset stack stack--sm">
                  {(actionsByObject.get(objectMenu) ?? []).map((a) => (
                    <li key={a.id}>
                      <button
                        data-testid={`menu-action-${a.id}`}
                        className="btn btn--ghost btn--block"
                        style={{ justifyContent: "space-between", whiteSpace: "normal", textAlign: "left" }}
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
                        {!a.ready && <span className="muted">locked</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </m.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {guideOn && currentStep && (
              <m.div
                className="overlay guide-panel"
                initial={{ opacity: 0, y: 20, x: "-50%" }}
                animate={{ opacity: 1, y: 0, x: "-50%" }}
                exit={{ opacity: 0, y: 20, x: "-50%" }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="guide-panel__head">
                  <span className="eyebrow">
                    Guide · step {guideIndex + 1} of {guideSteps.length}
                  </span>
                  <button className="btn btn--ghost btn--small" onClick={() => setGuideOn(false)}>
                    Stop guide
                  </button>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <m.div
                    key={guideIndex}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.15 }}
                  >
                    <h3 className="section-title" style={{ fontSize: 18, marginBottom: 6 }}>
                      {currentStep.title}
                    </h3>
                    <p className="small muted">{currentStep.body}</p>
                  </m.div>
                </AnimatePresence>
                <div className="row" style={{ marginTop: 14, gap: 8 }}>
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
                    <button key={i} className={i === guideIndex ? "is-on" : ""} onClick={() => setGuideIndex(i)} aria-label={`Step ${i + 1}`} aria-current={i === guideIndex ? "step" : undefined} />
                  ))}
                </div>
              </m.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {toast && (
              <m.div
                key={toast}
                className="sim-toast"
                role="status"
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ type: "spring", stiffness: 420, damping: 28 }}
              >
                <span className="dot" aria-hidden="true" />
                Objective complete: {toast}
              </m.div>
            )}
          </AnimatePresence>

          <button className={`btn guide-toggle${guideOn ? " btn--ghost" : ""}`} style={guideOn ? { background: "var(--color-paper)" } : undefined} onClick={() => setGuideOn((v) => !v)}>
            {guideOn ? "Hide guide" : "Need help? Show guide"}
          </button>
        </div>

        <aside className="sim-full__side">
          <AnimatePresence>
            {error && (
              <m.div key="err" {...pop} className="banner banner--error" role="alert">
                {error}
              </m.div>
            )}
            {notice && (
              <m.div key="notice" {...pop} className="banner banner--info" role="status">
                {notice}
              </m.div>
            )}
          </AnimatePresence>

          <section className="card stack stack--sm">
            <h2 className="section-title" style={{ fontSize: 18 }}>
              What you know
            </h2>
            {session.facts_known.length === 0 ? (
              <p className="xsmall muted">Nothing confirmed yet. Ask around and check the evidence.</p>
            ) : (
              <ul className="list-reset stack stack--sm">
                <AnimatePresence initial={false}>
                  {session.facts_known.map((f) => (
                    <m.li
                      key={f.id}
                      className="xsmall"
                      initial={{ opacity: 0, backgroundColor: "rgba(254, 204, 51, 0.6)" }}
                      animate={{ opacity: 1, backgroundColor: "rgba(254, 204, 51, 0)" }}
                      transition={{ duration: 1.4 }}
                      style={{ borderRadius: 4, padding: "2px 4px", margin: "0 -4px" }}
                    >
                      <strong>{f.label}.</strong> <span className="muted">{f.detail}</span>
                    </m.li>
                  ))}
                </AnimatePresence>
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
            <m.section
              className="card stack stack--sm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ borderColor: "var(--color-ink)" }}
            >
              <h2 className="section-title" style={{ fontSize: 18 }}>
                Stakeholder update
              </h2>
              <p className="xsmall muted">Cover impact, cause, action taken, next update time and owner.</p>
              <label className="sr-only" htmlFor="status-update">
                Stakeholder update
              </label>
              <textarea
                id="status-update"
                className="textarea"
                data-testid="status-update"
                placeholder="Impact: … Cause: … We've … Next update at … Owner: …"
                value={updateText}
                onChange={(e) => setUpdateText(e.target.value)}
              />
              <div className="row between">
                <span className="xsmall muted">{updateText.trim().length < 10 ? "A few sentences is plenty." : `${updateText.trim().split(/\s+/).length} words`}</span>
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
              </div>
            </m.section>
          )}

          <section className="card stack stack--sm" style={{ minHeight: 260 }}>
            <div className="row between">
              <h2 className="section-title" style={{ fontSize: 18 }}>
                {activeName ? `Chat · ${activeName}` : "Conversation"}
              </h2>
              <div className="row" style={{ gap: 6 }}>
                {characters.map((c) => (
                  <button
                    key={c.id}
                    data-testid={`talk-${c.id}`}
                    className={`chip`}
                    aria-pressed={c.id === activeCharacter}
                    onClick={() => openCharacter(c.id)}
                    title={`Talk to ${c.name} (${c.role})`}
                  >
                    {c.name.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
            {!activeCharacter ? (
              <p className="xsmall muted">Pick a colleague above and ask a question — or walk up to them and press E to talk out loud.</p>
            ) : (
              <>
                <div ref={transcriptRef} className="chat-log" data-testid="chat-log" aria-live="polite">
                  {chatMessages.length === 0 && !pendingText && (
                    <p className="xsmall muted">Say hello, or jump straight to your question. Specific questions get specific answers.</p>
                  )}
                  {chatMessages.map((msg) => (
                    <m.div
                      key={msg.id}
                      className={`bubble${msg.speaker_type === "learner" ? " bubble--learner" : ""}`}
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span className="bubble__who">{msg.speaker_type === "learner" ? "You" : activeName}</span>
                      {msg.content}
                    </m.div>
                  ))}
                  {pendingText && (
                    <>
                      <m.div className="bubble bubble--learner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 0.75, y: 0 }}>
                        <span className="bubble__who">You</span>
                        {pendingText}
                      </m.div>
                      <div className="typing" aria-label={`${activeName ?? "Colleague"} is typing`}>
                        <span />
                        <span />
                        <span />
                      </div>
                    </>
                  )}
                </div>
                {suggestions.length > 0 && (
                  <div className="stack stack--sm" aria-label="Suggested questions">
                    <span className="xsmall muted">Try asking — short questions get real answers:</span>
                    <div className="chip-row">
                      {suggestions.map((q) => (
                        <button
                          key={q}
                          className="chip"
                          data-testid="suggested-question"
                          disabled={sending}
                          onClick={() => sendMessage(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="chat-compose">
                  <label className="sr-only" htmlFor="chat-input">
                    Message {activeName}
                  </label>
                  <textarea
                    id="chat-input"
                    className="textarea"
                    data-testid="chat-input"
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
                  <button className="btn" data-testid="chat-send" onClick={() => sendMessage()} disabled={sending || !chatInput.trim()}>
                    Send
                  </button>
                </div>
                {draftWords > 30 && (
                  <p className="xsmall" style={{ color: "var(--color-ember)" }} role="status">
                    {draftWords} words — colleagues talk in short turns. Try one question at a time.
                  </p>
                )}
                <p className="xsmall muted">
                  <span className="kbd">Enter</span> to send · <span className="kbd">Shift</span>+<span className="kbd">Enter</span> for a new line
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
