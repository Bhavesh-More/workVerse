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
import { duckMusic, play } from "../../../../lib/sfx";
import { SoundToggles } from "../../../../components/Sound";
import { ShiftComplete } from "../../../../components/ShiftComplete";
import { ToolPopup, type ToolView } from "../../../../components/ToolPopup";
import { TeamIntro } from "../../../../components/TeamIntro";
import { Glyph } from "../../../../components/Glyph";

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
  dynamicVariables?: Record<string, string>;
};

function statusBadge(status: string) {
  if (status === "completed") return "badge badge--ok";
  if (status === "active") return "badge badge--active";
  return "badge";
}

/** Numbers for the end-of-shift slideshow, from what the page already has. */
function shiftStats(session: SessionView, messages: TranscriptMessage[]) {
  const talks = new Map<string, number>();
  for (const msg of messages) {
    if (msg.speaker_type === "learner" && msg.character_id) talks.set(msg.character_id, (talks.get(msg.character_id) ?? 0) + 1);
  }
  const first = messages.find((msg) => msg.created_at)?.created_at;
  return {
    facts: session.facts_known,
    talks: [...talks].map(([id, count]) => ({ id, count })),
    seconds: first ? Math.max(0, Math.round((Date.now() - Date.parse(first)) / 1000)) : 0,
  };
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
  // Fade the background music out while a live voice meeting is running.
  useEffect(() => {
    duckMusic(Boolean(voice));
    return () => duckMusic(false);
  }, [voice]);
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

  // Chat sticks to the newest message, like any chat app (after layout, so new bubbles are measured).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const log = transcriptRef.current;
      log?.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [messages.length, pendingText, activeCharacter]);

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

  const [toolView, setToolView] = useState<ToolView | null>(null);
  const closeTool = useCallback(() => setToolView(null), []);

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
        (res.findings ?? []).forEach((f) => toolFactIds.current.add(f.id));
        if (res.tool && action.action_type === "inspect") {
          // Inspecting a tool opens it: the findings show inside a pixel window styled like the tool.
          setToolView({ ...res.tool, findings: res.findings ?? [], service: String(res.session.incident?.service ?? "") || undefined });
          if (newly?.length) play("discover");
        } else if (newly?.length) {
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

  // Profile cards: "all" (team intro) or one colleague's id. `afterIntro` runs when it closes.
  const [intro, setIntro] = useState<string | null>(null);
  const afterIntro = useRef<(() => void) | null>(null);
  const met = useRef<Set<string> | null>(null);
  const metKey = `wv-met-${sessionId}`;
  const metSet = useCallback(() => {
    if (!met.current) {
      try {
        met.current = new Set(JSON.parse(sessionStorage.getItem(metKey) ?? "[]") as string[]);
      } catch {
        met.current = new Set();
      }
    }
    return met.current;
  }, [metKey]);
  const markMet = useCallback(
    (id: string) => {
      const seen = metSet().add(id);
      try {
        sessionStorage.setItem(metKey, JSON.stringify([...seen]));
      } catch {
        // storage blocked: remembered for this page only
      }
    },
    [metKey, metSet],
  );
  /** First time meeting someone: show their card, then carry on with `then`. */
  const meetFirst = useCallback(
    (id: string, then: () => void) => {
      const hasProfile = characters.some((c) => c.id === id && c.profile);
      if (!hasProfile || metSet().has(id)) return then();
      afterIntro.current = then;
      setIntro(id);
    },
    [characters, metSet],
  );

  const openCharacter = useCallback(
    (characterId: string) => {
      setActiveCharacter(characterId);
      gameRef.current?.focusCharacter(characterId);
      meetFirst(characterId, () => {});
    },
    [meetFirst],
  );

  // Handoff: when the colleague you're talking to has told you everything they hold, point at the next
  // step; if that's another person, switch the chat to them after a short, cancellable countdown.
  const [handoff, setHandoff] = useState<{ from: string; to: string | null; secs: number } | null>(null);
  const doneBefore = useRef<Set<string> | null>(null);
  const navBefore = useRef<SessionView["navigation"]>(null);
  // Whoever the learner is talking to right now: the voice call wins over the open chat.
  const talkingTo = voice?.npc.id ?? activeCharacter;
  useEffect(() => {
    if (!session) return;
    const nav = session.navigation;
    const done = new Set(session.characters_done ?? []);
    const before = doneBefore.current;
    const prevNav = navBefore.current;
    doneBefore.current = done;
    navBefore.current = nav;
    if (!before || !talkingTo) return;
    const atThem = (n: SessionView["navigation"]) => n?.target_type === "character" && n.target_id === talkingTo;
    // Hand on when they've told you everything, or as soon as the step you came to them for is done
    // (e.g. you only needed the impact from the manager: the path has moved on to the logs).
    const toldAll = done.has(talkingTo) && !before.has(talkingTo);
    const stepDone = atThem(prevNav) && !atThem(nav);
    if (!toldAll && !stepDone) return;
    const to = nav?.target_type === "character" && nav.target_id !== talkingTo ? nav.target_id : null;
    setHandoff({ from: talkingTo, to, secs: 6 });
  }, [session, talkingTo]);
  useEffect(() => {
    // Counts down to switching chat to the next person, or (in a call) to ending the call;
    // paused while the "told you" box is open so there's time to read it.
    if (!handoff || toolView || (!handoff.to && !voice)) return;
    if (handoff.secs <= 0) {
      if (voice) return; // the call ends itself at 0 (VoiceMeeting), then runs onGo
      openCharacter(handoff.to!);
      setHandoff(null);
      return;
    }
    const t = setTimeout(() => setHandoff((h) => h && { ...h, secs: h.secs - 1 }), 1000);
    return () => clearTimeout(t);
  }, [handoff, voice, toolView, openCharacter]);
  useEffect(() => {
    // Picking someone else yourself cancels the handoff.
    setHandoff((h) => (h && h.from !== talkingTo ? null : h));
  }, [talkingTo]);

  // Facts a colleague tells you (typed or spoken) pop up as a dialogue box, like tool findings do.
  // Facts from tools are skipped here: the tool's own window already showed them.
  const factsBefore = useRef<Set<string> | null>(null);
  const toolFactIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!session) return;
    const known = session.facts_known;
    const before = factsBefore.current;
    factsBefore.current = new Set(known.map((f) => f.id));
    if (!before) return;
    const fresh = known.filter((f) => !before.has(f.id) && !toolFactIds.current.has(f.id));
    const who = characters.find((c) => c.id === talkingTo);
    if (!fresh.length || !who) return;
    setToolView({ id: "dialogue", label: who.name, portrait: who.profile?.portrait, from: who.id, findings: fresh.map((f) => ({ ...f, new: true })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per session update; speaker read at that moment
  }, [session]);

  const startVoiceMeeting = useCallback(
    async (characterId: string) => {
      if (interactionLocked.current || voicePending.current) return;
      if (!metSet().has(characterId) && characters.some((c) => c.id === characterId && c.profile)) {
        meetFirst(characterId, () => void startVoiceMeetingRef.current(characterId));
        return;
      }
      const npc = characters.find((c) => c.id === characterId);
      if (!npc) return;
      voicePending.current = true;
      setVoiceError(null);
      setNotice(`Calling ${npc.name}…`); // instant feedback; the token round trip can take a while
      play("call");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Microphone access is not available in this browser.");
        }
        // Mic permission (inside the E-key gesture) and the server token run in parallel.
        const [stream, res] = await Promise.all([
          navigator.mediaDevices.getUserMedia({ audio: true }),
          api.startVoiceSession(sessionId, {
            npc_id: characterId,
            client_request_id: crypto.randomUUID(),
          }),
        ]);
        stream.getTracks().forEach((t) => t.stop()); // permission check only; the SDK opens its own
        setNotice(null);
        interactionLocked.current = true;
        setVoice({
          npc: res.npc,
          voiceSessionId: res.voice_session_id,
          conversationToken: res.conversation_token,
          contextGrant: res.context_grant,
          dynamicVariables: res.dynamic_variables,
        });
      } catch (e) {
        setNotice(null);
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
    [characters, sessionId, meetFirst, metSet],
  );
  const startVoiceMeetingRef = useRef(startVoiceMeeting);
  useEffect(() => {
    startVoiceMeetingRef.current = startVoiceMeeting;
  }, [startVoiceMeeting]);

  // Q near a colleague opens their profile card (E talks).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "q" || e.repeat || !nearCharacter || intro || voice) return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return;
      if (!characters.some((c) => c.id === nearCharacter && c.profile)) return;
      setIntro(nearCharacter);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nearCharacter, intro, voice, characters]);

  const endVoiceMeeting = useCallback(async () => {
    interactionLocked.current = false;
    setVoice(null);
    await load();
  }, [load]);

  // Hang up the current call properly (server record too), e.g. when a popup's "Next" is chosen.
  const hangUp = useCallback(async () => {
    if (!voice) return;
    api.endVoiceSession(sessionId, voice.voiceSessionId, "user_ended").catch(() => {});
    await endVoiceMeeting();
  }, [voice, sessionId, endVoiceMeeting]);

  // Where to go after a colleague has told you something: always shown with the "told you" box.
  const routeFrom = (from?: string): ToolView["next"] => {
    const nav = session?.navigation;
    const leave = () => {
      setHandoff(null);
      void hangUp();
    };
    const call = voice ? "End call · " : "";
    if (!nav) return { text: "Everything's covered: send your status update and complete the shift.", label: `${call}OK`, onGo: leave };
    const step = nav.action_label ?? nav.objective_label;
    if (nav.target_type === "character" && nav.target_id !== from) {
      const c = characters.find((x) => x.id === nav.target_id);
      return {
        text: `${step}: talk to ${c?.name ?? "them"}${c ? `, the ${c.role}` : ""}.`,
        label: `${call}Talk to ${c?.name.split(" ")[0] ?? "them"}`,
        onGo: () => {
          leave();
          openCharacter(nav.target_id!);
        },
      };
    }
    if (nav.target_type === "character") return { text: `${step}: keep talking to them.`, label: "Keep going", onGo: () => {} };
    const where = session.world.locations.find((l) => l.id === nav.location_id)?.name;
    return { text: `${step}${where ? ` in the ${where}` : ""}. Follow the arrow in the office.`, label: `${call}Go there`, onGo: leave };
  };

  // "Skip to what they know": the colleague hands it all over, then the box shows it with the next step.
  const skipTo = useCallback(
    async (characterId: string) => {
      try {
        const res = await api.skipCharacter(sessionId, characterId);
        setSession(res.session);
        if (!res.revealed.length) {
          const who = characters.find((c) => c.id === characterId);
          if (who) setToolView({ id: "dialogue", label: who.name, portrait: who.profile?.portrait, from: who.id, findings: [] });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not skip.");
      }
    },
    [sessionId, characters],
  );

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
      // The reply is in the response; append locally instead of refetching the transcript.
      const at = new Date().toISOString();
      const base = { session_id: sessionId, character_id: res.character_id, modality: "text", status: "final", created_at: at };
      setMessages((prev) =>
        prev.some((m) => m.id === res.assistant_message_id)
          ? prev
          : [
              ...prev,
              { ...base, id: `local-${res.turn_id}`, sequence_number: prev.length + 1, speaker_type: "learner", content: text },
              { ...base, id: res.assistant_message_id, sequence_number: prev.length + 2, speaker_type: "character", content: res.message },
            ],
      );
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

  const [shiftDone, setShiftDone] = useState(false);
  const finish = useCallback(
    async (force: boolean) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      try {
        await api.complete(sessionId, { expected_state_version: session.state_version, force });
        router.prefetch(`/session/${sessionId}/debrief`);
        setShiftDone(true); // the end card's button (or Esc/Enter) goes on to the debrief
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not complete the session.");
        setBusy(false);
      }
    },
    [session, sessionId, router],
  );

  // Silence coaching: if the learner hasn't typed 8s after opening a chat or getting a reply,
  // surface what they could say. Any typing or a new message resets the timer.
  const [idleHint, setIdleHint] = useState(false);
  useEffect(() => {
    if (!activeCharacter || chatInput || sending) return;
    const t = window.setTimeout(() => {
      setIdleHint(true);
      play("pop");
    }, 8000);
    return () => {
      window.clearTimeout(t);
      setIdleHint(false);
    };
  }, [activeCharacter, chatInput, sending, messages.length]);

  // Stuck detector: 20s with no key/pointer input and no chat open → show the next step.
  const [stuck, setStuck] = useState(false);
  const lastInput = useRef(0);
  const stuckShown = useRef(false);
  useEffect(() => {
    lastInput.current = Date.now();
    const bump = () => {
      lastInput.current = Date.now();
      stuckShown.current = false;
      setStuck(false);
    };
    const tick = window.setInterval(() => {
      if (stuckShown.current || Date.now() - lastInput.current < 20000) return;
      stuckShown.current = true;
      setStuck(true);
      play("pop");
    }, 2000);
    window.addEventListener("keydown", bump);
    window.addEventListener("pointerdown", bump);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("pointerdown", bump);
    };
  }, []);

  // "Meet the team" intro: once per session on first load.
  const hasProfiles = characters.some((c) => c.profile);
  useEffect(() => {
    if (!hasProfiles) return;
    const key = `wv-intro-${sessionId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage blocked: still show it once for this mount
    }
    setIntro("all");
  }, [hasProfiles, sessionId]);

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
  const activeChar = characters.find((c) => c.id === activeCharacter);
  const activeName = activeChar?.name;
  const activeFirst = activeName?.split(" ")[0] ?? "They";
  const activeProfile = activeChar?.profile;
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
          <SoundToggles />
          {hasProfiles && (
            <button className="btn btn--ghost btn--small" onClick={() => setIntro("all")} title="Replay the team intro">
              Meet the team
            </button>
          )}
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

      {toolView && <ToolPopup tool={toolView.id === "dialogue" ? { ...toolView, next: routeFrom(toolView.from) } : toolView} onClose={closeTool} />}
      {shiftDone && (
        <ShiftComplete
          characters={characters}
          objectives={session.objectives}
          title={String(incident.summary ?? "")}
          stats={shiftStats(session, messages)}
          onDone={() => router.push(`/session/${sessionId}/debrief`)}
        />
      )}
      {intro && (
        <TeamIntro
          characters={characters}
          title={String(incident.summary ?? "")}
          only={intro === "all" ? undefined : intro}
          onSeen={markMet}
          onDone={() => {
            setIntro(null);
            const then = afterIntro.current;
            afterIntro.current = null;
            then?.();
          }}
        />
      )}
      <div className="sim-full__body">
        <div className="sim-full__game">
          <PhaserGame
            ref={gameRef}
            world={session.world}
            sessionId={sessionId}
            playerTexture="player"
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
                  {nearCharacter && characters.some((c) => c.id === nearCharacter && c.profile) && (
                    <>
                      {" · "}
                      <span className="kbd">Q</span> profile card
                    </>
                  )}
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
              dynamicVariables={voice.dynamicVariables}
              onEnd={endVoiceMeeting}
              onSkip={() => void skipTo(voice.npc.id)}
              onSession={setSession}
              handoff={
                handoff && handoff.from === voice.npc.id
                  ? handoff.to
                    ? {
                        secs: handoff.secs,
                        text: `talk to ${characters.find((c) => c.id === handoff.to)?.name}.`,
                        goLabel: `End call · talk to ${characters.find((c) => c.id === handoff.to)?.name.split(" ")[0]}`,
                        onGo: () => {
                          const to = handoff.to!;
                          setHandoff(null);
                          openCharacter(to);
                        },
                      }
                    : {
                        secs: handoff.secs,
                        text: `${navigation?.action_label ?? navigation?.objective_label ?? "check the guide"} — follow the arrow in the office.`,
                        goLabel: "End call · go there",
                        onGo: () => setHandoff(null),
                      }
                  : null
              }
            />
          )}

          <details className="overlay hud-objectives" aria-label="Objectives" open>
            <summary className="hud-objectives__summary">
              <span className="hud-objectives__head">
                <span className="eyebrow">Objectives</span>
                <span className="mono">
                  {doneCount}/{session.objectives.length}
                </span>
              </span>
              <span className="track" style={{ display: "block", height: 4 }} aria-hidden="true">
                <m.span
                  initial={false}
                  animate={{ width: `${(doneCount / Math.max(1, session.objectives.length)) * 100}%` }}
                  transition={{ type: "spring", stiffness: 200, damping: 28 }}
                  style={{ background: "var(--color-signal-green)" }}
                />
              </span>
            </summary>
            <ul className="list-reset hud-objectives__list">
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
          </details>

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

          <AnimatePresence>
            {stuck && !activeCharacter && !voice && nextStep && (
              <m.div
                key="stuck"
                className="stuck-card"
                role="status"
                initial={{ opacity: 0, y: 24, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 360, damping: 24 }}
              >
                <span className="eyebrow">Stuck? Next step</span>
                <strong>{nextStep.title}</strong>
                <span className="small">{nextStep.body}</span>
                <div className="row" style={{ gap: 8 }}>
                  {nextStep.character && (
                    <button className="btn btn--small" onClick={() => openCharacter(nextStep.character!)}>
                      Talk to them
                    </button>
                  )}
                  <button className="btn btn--ghost btn--small" onClick={() => setGuideOn(true)}>
                    Show guide
                  </button>
                </div>
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

          <details className="card panel" open>
            <summary className="panel__head">
              <h2 className="section-title">What you know</h2>
              <span className="panel__count">{session.facts_known.length}</span>
            </summary>
            {session.facts_known.length === 0 ? (
              <p className="small muted">Nothing confirmed yet</p>
            ) : (
              <ul className="list-reset checklist">
                <AnimatePresence initial={false}>
                  {session.facts_known.map((f) => (
                    <m.li
                      key={f.id}
                      initial={{ opacity: 0, x: -8, backgroundColor: "rgba(254, 204, 51, 0.6)" }}
                      animate={{ opacity: 1, x: 0, backgroundColor: "rgba(254, 204, 51, 0)" }}
                      transition={{ duration: 1.4 }}
                    >
                      <strong>{f.label}</strong>
                      {f.detail && <span className="muted">{f.detail}</span>}
                    </m.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </details>

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
            <m.details
              className="card panel"
              open
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ borderColor: "var(--color-ink)" }}
            >
              <summary className="panel__head">
                <h2 className="section-title">Stakeholder update</h2>
              </summary>
              <ul className="list-reset chip-row" aria-label="Cover these">
                {["Impact", "Cause", "Action", "Next update", "Owner"].map((k) => (
                  <li key={k} className="badge">{k}</li>
                ))}
              </ul>
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
                <span className="small muted">{updateText.trim().length < 10 ? "" : `${updateText.trim().split(/\s+/).length} words`}</span>
                <button
                  className="btn"
                  data-testid="send-status-update"
                  disabled={busy || updateText.trim().length < 10}
                  onClick={() => {
                    const action = actions.find((a) => a.id === "a_send_status_update");
                    if (action) runAction(action, { text: updateText.trim() });
                  }}
                >
                  Send update
                </button>
              </div>
            </m.details>
          )}

          <details className="card panel panel--chat" open>
            <summary className="panel__head">
              <h2 className="section-title">{activeName ? `Chat · ${activeName}` : "Conversation"}</h2>
            </summary>
            <div className="stack stack--sm">
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
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
            {activeChar && (
              <button className="btn btn--ghost btn--small" data-testid="chat-skip" style={{ alignSelf: "flex-start" }} onClick={() => void skipTo(activeChar.id)}>
                Skip ▶ get {activeChar.name.split(" ")[0]}&apos;s info
              </button>
            )}
            {activeProfile && activeChar && (
              <div className="who-card">
                {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
                <img src={activeProfile.portrait} alt="" />
                <div className="who-card__id">
                  <strong>{activeChar.name}</strong>
                  <span>{activeChar.role}</span>
                </div>
                <button
                  className="btn btn--ghost btn--small who-card__more"
                  onClick={() => setIntro(activeChar.id)}
                  aria-label={`${activeChar.name}'s profile card`}
                  title="Profile card (Q)"
                >
                  ⓘ
                </button>
                <dl className="who-card__split">
                  <div>
                    <dt className="icon-label"><Glyph name="bulb" size={15} /> Knows</dt>
                    <dd>{activeProfile.knows}</dd>
                  </div>
                  {activeProfile.needs && (
                    <div>
                      <dt className="icon-label"><Glyph name="target" size={15} /> Needs</dt>
                      <dd>{activeProfile.needs}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
            {!activeCharacter ? (
              <p className="small muted">Pick a colleague, or walk up and press <span className="kbd">E</span></p>
            ) : (
              <>
                <div ref={transcriptRef} className="chat-log" data-testid="chat-log" aria-live="polite">
                  {chatMessages.length === 0 && !pendingText && (
                    <p className="small muted">Say hello or ask a question</p>
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
                <AnimatePresence>
                  {handoff && (
                    <m.div
                      key="handoff"
                      className="handoff"
                      role="status"
                      data-testid="handoff"
                      initial={{ opacity: 0, transform: "translateY(8px) scale(0.97)" }}
                      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                      exit={{ opacity: 0, transform: "translateY(4px) scale(0.98)" }}
                      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <strong>✓ {characters.find((c) => c.id === handoff.from)?.name.split(" ")[0]} has told you what they know.</strong>
                      {handoff.to ? (
                        <>
                          <span className="small">
                            Next: talk to {characters.find((c) => c.id === handoff.to)?.name}
                            {voice ? " after this call." : ` — switching in ${handoff.secs}s…`}
                          </span>
                          <div className="chip-row">
                            <button className="btn btn--small" data-testid="handoff-go" onClick={() => { const to = handoff.to!; setHandoff(null); openCharacter(to); }}>
                              Talk to {characters.find((c) => c.id === handoff.to)?.name.split(" ")[0]} now
                            </button>
                            <button className="btn btn--ghost btn--small" data-testid="handoff-stay" onClick={() => setHandoff(null)}>
                              Stay here
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="small">
                            Next: {navigation?.action_label ?? navigation?.objective_label ?? "check the guide"}
                            {navigation?.location_id && ` in the ${session.world.locations.find((l) => l.id === navigation.location_id)?.name ?? "office"}`}
                            {" "}— follow the arrow in the office.
                          </span>
                          <div className="chip-row">
                            <button className="btn btn--ghost btn--small" data-testid="handoff-stay" onClick={() => setHandoff(null)}>
                              Got it
                            </button>
                          </div>
                        </>
                      )}
                    </m.div>
                  )}
                  {idleHint && suggestions.length > 0 && !handoff && (
                    <m.div
                      key="coach"
                      className="coach-nudge"
                      role="status"
                      initial={{ opacity: 0, y: 14, scale: 0.94, filter: "blur(4px)" }}
                      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: 8, scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 380, damping: 26 }}
                    >
                      <span className="coach-nudge__spark" aria-hidden="true" />
                      <strong>{activeName} is waiting for you.</strong>
                      <span className="small">Try one:</span>
                      <div className="chip-row">
                        {suggestions.slice(0, 2).map((q, i) => (
                          <m.button
                            key={q}
                            className="chip chip--glow"
                            data-sfx="none"
                            disabled={sending}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.12 + i * 0.08 }}
                            onClick={() => sendMessage(q)}
                          >
                            {q}
                          </m.button>
                        ))}
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>
                {suggestions.length > 0 && !idleHint && (
                  <div className="stack stack--sm" aria-label="Suggested questions">
                    <span className="eyebrow" style={{ margin: 0 }}>Ask {activeFirst}</span>
                    <div className="chip-row">
                      {suggestions.map((q) => (
                        <button
                          key={q}
                          className="chip"
                          data-testid="suggested-question"
                          disabled={sending}
                          data-sfx="none"
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
                    placeholder={`Message ${activeFirst}…`}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <button className="btn" data-sfx="none" data-testid="chat-send" onClick={() => sendMessage()} disabled={sending || !chatInput.trim()}>
                    Send
                  </button>
                </div>
                {draftWords > 30 && (
                  <p className="small" style={{ color: "var(--color-ember)" }} role="status">
                    {draftWords} words — keep it short
                  </p>
                )}
              </>
            )}
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
