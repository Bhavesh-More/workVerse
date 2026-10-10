"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import { RequireAuth } from "../../../components/RequireAuth";
import { PhaserGame, type PhaserGameHandle } from "../../../game/PhaserGame";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import type { SessionView, TranscriptMessage, WorldAction } from "../../../lib/types";

function statusBadge(status: string) {
  if (status === "completed") return "badge badge--ok";
  if (status === "active") return "badge badge--active";
  return "badge";
}

function Simulation() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { token } = useAuth();
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

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, t] = await Promise.all([api.getSession(token, sessionId), api.transcript(token, sessionId)]);
      setSession(s);
      setMessages(t.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the session.");
    }
  }, [token, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages.length]);

  const actions = session?.world.actions ?? [];
  const characters = session?.world.characters ?? [];

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
      if (!token || !session) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await api.submitAction(token, sessionId, {
          client_action_id: crypto.randomUUID(),
          expected_state_version: session.state_version,
          type: action.id,
          payload: payload ?? {},
        });
        setSession(res.session);
        const t = await api.transcript(token, sessionId);
        setMessages(t.items);
        if (res.state_delta && Array.isArray(res.state_delta.newly_discovered_fact_ids)) {
          const newly = res.state_delta.newly_discovered_fact_ids as string[];
          if (newly.length) setNotice(`New information: ${newly.join(", ")}`);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          await load();
          setError("The session changed; state refreshed. Try again.");
        } else if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError("Action failed.");
        }
      } finally {
        setBusy(false);
      }
    },
    [token, session, sessionId, load],
  );

  const interactObject = useCallback(
    (objectId: string) => {
      const list = actionsByObject.get(objectId) ?? [];
      if (list.length === 0) {
        setNotice("Nothing to do here yet.");
        return;
      }
      const ready = list.find((a) => a.ready) ?? list[0];
      if (!ready) return;
      if (!ready.ready) {
        setError(ready.locked_reason ?? "This action is not available yet.");
        return;
      }
      if (ready.requires_text) {
        setNotice(`Compose your text for “${ready.label}” in the panel, then submit.`);
        return;
      }
      runAction(ready);
    },
    [actionsByObject, runAction],
  );

  const openCharacter = useCallback((characterId: string) => {
    setActiveCharacter(characterId);
    gameRef.current?.focusCharacter(characterId);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!token || !session || !activeCharacter || !chatInput.trim()) return;
    setSending(true);
    setError(null);
    const text = chatInput.trim();
    setChatInput("");
    try {
      const res = await api.submitTurn(token, sessionId, {
        client_turn_id: crypto.randomUUID(),
        expected_state_version: session.state_version,
        character_id: activeCharacter,
        message: text,
      });
      setSession(res.session);
      const t = await api.transcript(token, sessionId);
      setMessages(t.items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await load();
        setError("The session changed; state refreshed. Please resend.");
      } else if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Message failed.");
      }
    } finally {
      setSending(false);
    }
  }, [token, session, activeCharacter, chatInput, sessionId, load]);

  const finish = useCallback(
    async (force: boolean) => {
      if (!token || !session) return;
      setBusy(true);
      setError(null);
      try {
        await api.complete(token, sessionId, {
          expected_state_version: session.state_version,
          force,
        });
        router.push(`/session/${sessionId}/debrief`);
      } catch (e) {
        if (e instanceof ApiError) setError(e.message);
        else setError("Could not complete the session.");
        setBusy(false);
      }
    },
    [token, session, sessionId, router],
  );

  if (!session) {
    return <main className="app-main spinner">{error ?? "Loading simulation…"}</main>;
  }

  const incident = session.incident as Record<string, unknown>;
  const activeName = characters.find((c) => c.id === activeCharacter)?.name;
  const chatMessages = activeCharacter
    ? messages.filter(
        (m) =>
          (m.speaker_type === "learner" && !m.character_id) ||
          m.character_id === activeCharacter,
      )
    : [];

  return (
    <main className="app-main app-main--wide">
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <p className="eyebrow">
            Incident · {String(incident.service ?? "service")} · severity {String(incident.severity ?? "?")}
          </p>
          <h1 className="page-title" style={{ fontSize: "1.4rem" }}>
            {session.phase} · v{session.state_version}
          </h1>
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

      {error && (
        <div className="banner banner--error" style={{ marginBottom: 12 }} role="alert">
          {error}
        </div>
      )}
      {notice && <div className="banner banner--info" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="sim-layout">
        <div className="stack">
          <div className="game-frame">
            <PhaserGame
              ref={gameRef}
              world={session.world}
              sessionId={sessionId}
              playerTexture="blonde_man"
              onPrompt={setPrompt}
              onInteractCharacter={openCharacter}
              onInteractObject={interactObject}
              onLocationChange={() => {}}
              onReady={() => setGameReady(true)}
            />
            {!gameReady && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  color: "#e7e6db",
                }}
                className="spinner"
              >
                Loading office…
              </div>
            )}
            {prompt && (
              <div
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "#e7e6db",
                  border: "1px solid #222c21",
                  padding: "6px 12px",
                  fontSize: 12,
                }}
              >
                Press <strong>E</strong> to interact with {prompt}
              </div>
            )}
          </div>

          <div className="panel stack stack--sm">
            <div className="row between">
              <span className="section-title">Quick navigation</span>
              <span className="small muted">Keyboard: WASD/arrows · E to interact</span>
            </div>
            <div className="row">
              {session.world.locations
                .filter((l) => l.kind === "room")
                .map((l) => (
                  <button
                    key={l.id}
                    className="btn btn--ghost btn--small"
                    onClick={() => gameRef.current?.travelTo(l.id)}
                  >
                    {l.name}
                  </button>
                ))}
            </div>
            <div className="row">
              <span className="section-title">Talk to</span>
              {characters.map((c) => (
                <button
                  key={c.id}
                  data-testid={`talk-${c.id}`}
                  className={c.id === activeCharacter ? "btn btn--small" : "btn btn--ghost btn--small"}
                  onClick={() => openCharacter(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="sim-side">
          <section className="panel stack stack--sm">
            <h2 className="section-title">Objectives</h2>
            <ul className="list-reset">
              {session.objectives.map((o) => (
                <li key={o.id} className="objective">
                  <span>{o.label}</span>
                  <span className={o.status === "completed" ? "badge badge--ok" : "badge"}>
                    {o.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel stack stack--sm">
            <h2 className="section-title">Workplace actions</h2>
            <ul className="list-reset stack stack--sm">
              {actions
                .filter((a) => a.action_type !== "navigate")
                .map((a) => (
                  <li key={a.id}>
                    <button
                      key={a.id}
                      data-testid={`action-${a.id}`}
                      className="btn btn--ghost btn--small"
                      style={{ width: "100%", textAlign: "left" }}
                      disabled={busy || !a.ready}
                      onClick={() =>
                        a.requires_text
                          ? setNotice(`Use the “Stakeholder update” panel to submit “${a.label}”.`)
                          : runAction(a)
                      }
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

          <section className="panel stack stack--sm" style={{ flex: 1, minHeight: 220 }}>
            <h2 className="section-title">
              {activeName ? `Chat · ${activeName}` : "Conversation"}
            </h2>
            {!activeCharacter ? (
              <p className="small muted">
                Walk to a colleague or use “Talk to” above, then ask a question.
              </p>
            ) : (
              <>
                <div
                  ref={transcriptRef}
                  data-testid="chat-log"
                  style={{ flex: 1, overflowY: "auto", maxHeight: 260, display: "flex", flexDirection: "column", gap: 10 }}
                >
                  {chatMessages.length === 0 && (
                    <p className="small muted">Start the conversation.</p>
                  )}
                  {chatMessages.map((m) => (
                    <div key={m.id} className="small">
                      <span className="eyebrow" style={{ fontSize: 9 }}>
                        {m.speaker_type === "learner" ? "You" : activeName}
                      </span>
                      <p style={{ marginTop: 2 }}>{m.content}</p>
                    </div>
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
                  <button
                    className="btn btn--small"
                    data-testid="chat-send"
                    onClick={sendMessage}
                    disabled={sending || !chatInput.trim()}
                  >
                    {sending ? "…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function SessionPage() {
  return (
    <div className="app-shell">
      <AppNav />
      <RequireAuth>
        <Simulation />
      </RequireAuth>
    </div>
  );
}
