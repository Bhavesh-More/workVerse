"use client";

// Who to invite: typed rows, a pasted list or a CSV. Reports the parsed, de-duplicated people.
import { useEffect, useMemo, useRef, useState } from "react";
import { parseCandidates } from "../../lib/company";

export type Person = { email: string; name?: string };

export function CandidateEntry({ onChange, resetKey = 0, exclude = [] }: { onChange: (people: Person[]) => void; resetKey?: number; exclude?: string[] }) {
  const [tab, setTab] = useState<"manual" | "paste" | "csv">("manual");
  const [rows, setRows] = useState([{ name: "", email: "" }]);
  const [paste, setPaste] = useState("");
  const [csv, setCsv] = useState<{ file: string; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRows([{ name: "", email: "" }]);
    setPaste("");
    setCsv(null);
  }, [resetKey]);

  const parsed = useMemo(() => {
    const src =
      tab === "manual"
        ? rows.filter((r) => r.email.trim()).map((r) => `${r.name} <${r.email.trim()}>`).join("\n")
        : tab === "paste"
          ? paste
          : csv?.text ?? "";
    return parseCandidates(src);
  }, [tab, rows, paste, csv]);
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  const fresh = parsed.filter((p) => !skip.has(p.email.toLowerCase()));

  useEffect(() => {
    onChange(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fresh)]);

  const readFile = async (f: File | undefined) => {
    if (f) setCsv({ file: f.name, text: await f.text() });
  };

  return (
    <div className="stack">
      <div className="co-tabs" role="tablist">
        {(
          [
            ["manual", "Type"],
            ["paste", "Paste list"],
            ["csv", "Upload CSV"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "manual" && (
        <div className="stack--sm stack">
          {rows.map((r, i) => (
            <div key={i} className="co-manual-row">
              <input className="input" aria-label={`Candidate ${i + 1} name`} placeholder="Full name (optional)" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input" type="email" aria-label={`Candidate ${i + 1} email`} placeholder="email@example.com" value={r.email} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
              <button type="button" className="btn btn--ghost btn--small" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--small" style={{ justifySelf: "start" }} onClick={() => setRows([...rows, { name: "", email: "" }])}>+ Add another</button>
        </div>
      )}
      {tab === "paste" && (
        <div className="field">
          <label htmlFor="invite-paste">Emails</label>
          <textarea id="invite-paste" className="textarea" rows={6} placeholder={"One per line, or separated by commas:\nAsha Patel <asha@example.com>\nben@example.com, chen@example.com"} value={paste} onChange={(e) => setPaste(e.target.value)} />
        </div>
      )}
      {tab === "csv" && (
        <div
          className={`co-dropzone${over ? " is-over" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void readFile(e.dataTransfer.files[0]);
          }}
        >
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden data-testid="csv-input" onChange={(e) => void readFile(e.target.files?.[0])} />
          <p><strong>{csv ? csv.file : "Drop a CSV here or click to choose"}</strong></p>
          <p className="xsmall muted">Needs an <span className="mono">email</span> column; <span className="mono">name</span> (or first/last name) is optional.</p>
        </div>
      )}
      {parsed.length > 0 && (
        <div className="stack--sm stack">
          <span className="eyebrow" style={{ marginBottom: 0 }}>
            {fresh.length} candidate{fresh.length === 1 ? "" : "s"} ready
            {parsed.length > fresh.length && ` · ${parsed.length - fresh.length} already on the list`}
          </span>
          <div className="co-preview">
            {fresh.map((p) => (
              <span key={p.email} className="chip chip--static">{p.name ? `${p.name} · ` : ""}{p.email}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
