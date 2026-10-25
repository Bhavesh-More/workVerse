"use client";

import { useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { api } from "../lib/api";
import { PixelLogo } from "./PixelLogo";
import { IMOCHA_URL } from "./ImochaHub";

type Turn = { role: "user" | "assistant"; content: string };

const FALLBACK = ["What is iMocha?", "What is Skills Intelligence?", "Which assessments do you offer?", "How does this help me get hired?"];

/** Chat with Mia, the iMocha product guide. Separate from the scenario: nothing here is scored. */
export function ImochaGuide({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("Mia");
  const [suggestions, setSuggestions] = useState(FALLBACK);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .imochaGuide()
      .then((g) => {
        setName(g.name);
        setSuggestions(g.suggestions);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function ask(q = input) {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", content: question }]);
    setBusy(true);
    try {
      const { answer } = await api.imochaAsk({ question, history: turns.slice(-6) });
      setTurns((t) => [...t, { role: "assistant", content: answer }]);
    } catch {
      setTurns((t) => [...t, { role: "assistant", content: "I can't reach the iMocha desk right now — try again in a moment." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <m.section
      className="card panel im-guide"
      aria-label="iMocha guide"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <div className="im-guide__head">
        <PixelLogo variant="mark" height={32} />
        <div>
          <strong>{name}</strong>
          <span className="mono">iMocha product guide</span>
        </div>
        <button className="btn btn--ghost btn--small" onClick={onClose} aria-label="Close iMocha guide">
          ✕
        </button>
      </div>
      <div ref={logRef} className="chat-log" aria-live="polite">
        {turns.length === 0 && (
          <div className="bubble">
            <span className="bubble__who">{name}</span>
            Hi! I&apos;m {name} from iMocha. Ask me anything about our products.
          </div>
        )}
        {turns.map((t, i) => (
          <m.div
            key={i}
            className={`bubble${t.role === "user" ? " bubble--learner" : " bubble--imocha"}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="bubble__who">{t.role === "user" ? "You" : name}</span>
            {t.content}
          </m.div>
        ))}
        {busy && (
          <div className="typing" aria-label={`${name} is typing`}>
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <div className="chip-row">
        {suggestions.map((q) => (
          <button key={q} className="chip" disabled={busy} onClick={() => void ask(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="chat-compose">
        <label className="sr-only" htmlFor="im-guide-input">
          Ask {name}
        </label>
        <textarea
          id="im-guide-input"
          className="textarea"
          placeholder={`Ask ${name} about iMocha…`}
          value={input}
          maxLength={400}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <button className="btn btn--brand" onClick={() => void ask()} disabled={busy || !input.trim()}>
          Ask
        </button>
      </div>
      <a className="text-link small" href={IMOCHA_URL} target="_blank" rel="noopener noreferrer">
        Visit imocha.io ↗
      </a>
    </m.section>
  );
}
