"use client";

// The company's AI judges: any number (1..max) of simulated colleagues. Each plays one of the
// scenario's five roles (that decides what they know), with a name, avatar, voice and manner the
// company picks. Used full screen as a modal (workplace setup) and inline (AI judges page).
import { useEffect, useMemo, useRef, useState } from "react";
import { companyApi, type Avatar, type Company, type JudgeCatalog, type JudgeRole, type RosterJudge } from "../../lib/company";
import { CharThumb } from "../world/Thumbs";
import type { WorldJudge } from "../../lib/world/types";

const TEXT_FIELDS = ["personality", "greeting", "focus"] as const;
const STRICT_LABEL = ["", "Helpful", "Easy", "Balanced", "Tough", "Very tough"];

export function effectiveRoster(company: Company, catalog: JudgeCatalog | null): RosterJudge[] {
  return company.judge_roster ?? catalog?.default_roster ?? [];
}

/** A role's stock judge (the defaults every text field resets to). */
function stock(catalog: JudgeCatalog, role: JudgeRole): RosterJudge {
  return catalog.default_roster.find((j) => j.role === role) ?? catalog.default_roster[0]!;
}

export function avatarOf(catalog: JudgeCatalog, id: string): Avatar | undefined {
  return catalog.avatars.find((a) => a.id === id);
}

const newId = () => `j_${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;

function problems(roster: RosterJudge[], max: number): string[] {
  const out: string[] = [];
  if (!roster.length) out.push("Keep at least one judge.");
  if (roster.length > max) out.push(`Keep at most ${max} judges.`);
  roster.forEach((j, i) => {
    if (!j.name.trim()) out.push(`Judge ${i + 1} needs a name.`);
  });
  const names = roster.map((j) => j.name.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) out.push("Two judges have the same name.");
  return out;
}

// ------------------------------------------------------------------------------- editor
export function JudgeRosterEditor({ catalog, value, onChange }: { catalog: JudgeCatalog; value: RosterJudge[]; onChange: (next: RosterJudge[]) => void }) {
  const [selected, setSelected] = useState<string>(value[0]?.id ?? "");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const current = value.find((j) => j.id === selected) ?? value[0];
  const roleLabel = (r: string) => catalog.roles.find((x) => x.id === r)?.label ?? r;
  const covered = new Set(value.map((j) => j.role));
  const uncovered = catalog.roles.filter((r) => !covered.has(r.id));

  const update = (id: string, patch: Partial<RosterJudge>) => onChange(value.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const add = () => {
    const role = (uncovered[0]?.id ?? "coworker") as JudgeRole;
    const taken = new Set(value.map((j) => j.name.toLowerCase()));
    const slot = catalog.slots.find((s) => s.id === role);
    const name = slot?.names.find((n) => !taken.has(n.name.toLowerCase()))?.name ?? `New judge ${value.length + 1}`;
    const base = stock(catalog, role);
    const avatar = avatarOf(catalog, name) ?? avatarOf(catalog, base.avatar)!;
    const j: RosterJudge = { ...base, id: newId(), name, avatar: avatar.id, voice: defaultVoice(catalog, role, avatar.gender) };
    onChange([...value, j]);
    setSelected(j.id);
  };
  const duplicate = (j: RosterJudge) => {
    const copy = { ...j, id: newId(), name: `${j.name} (copy)`.slice(0, 40) };
    const i = value.findIndex((x) => x.id === j.id);
    onChange([...value.slice(0, i + 1), copy, ...value.slice(i + 1)]);
    setSelected(copy.id);
  };
  const remove = (id: string) => {
    const i = value.findIndex((x) => x.id === id);
    const next = value.filter((x) => x.id !== id);
    onChange(next);
    setSelected(next[Math.max(0, i - 1)]?.id ?? "");
    setConfirmDelete(null);
  };
  const move = (id: string, d: -1 | 1) => {
    const i = value.findIndex((x) => x.id === id);
    const k = i + d;
    if (k < 0 || k >= value.length) return;
    const next = [...value];
    [next[i], next[k]] = [next[k]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="jr">
      <aside className="jr-list" aria-label="Judges">
        <div className="jr-list__head">
          <span className="eyebrow" style={{ margin: 0 }}>Your judges</span>
          <span className="badge" data-testid="judge-count">{value.length} / {catalog.max_judges}</span>
        </div>
        <ul className="list-reset" role="listbox" aria-label="Select a judge to edit">
          {value.map((j, i) => {
            const av = avatarOf(catalog, j.avatar);
            return (
              <li key={j.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={current?.id === j.id}
                  className={`jr-item${current?.id === j.id ? " is-on" : ""}`}
                  onClick={() => setSelected(j.id)}
                  data-testid={`judge-item-${i}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {av && <img src={av.portrait} alt="" width={40} height={40} />}
                  <span>
                    <strong>{j.name.trim() || "Unnamed judge"}</strong>
                    <span className="xsmall muted">{roleLabel(j.role)} · {voiceLabel(catalog, j.voice)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn btn--ghost btn--small jr-add" onClick={add} disabled={value.length >= catalog.max_judges} data-testid="add-judge">
          + Add judge
        </button>
        {value.length >= catalog.max_judges && <p className="xsmall muted">That&apos;s the maximum of {catalog.max_judges} judges.</p>}
        <div className="jr-cover">
          <span className="eyebrow" style={{ marginBottom: 6 }}>Roles in the incident</span>
          <ul className="list-reset">
            {catalog.roles.map((r) => {
              const n = value.filter((j) => j.role === r.id).length;
              return (
                <li key={r.id} className={n ? "is-ok" : ""}>
                  <span aria-hidden="true">{n ? "✓" : "○"}</span> {r.label}
                  {n > 1 && <span className="xsmall muted"> ×{n}</span>}
                </li>
              );
            })}
          </ul>
          {uncovered.length > 0 && value[0] && (
            <p className="xsmall muted" data-testid="cover-note">
              Nobody plays {uncovered.map((r) => r.label.toLowerCase()).join(", ")}. {value[0].name.trim() || "Your first judge"} will also know what they would know, so the incident stays solvable.
            </p>
          )}
        </div>
      </aside>

      {current ? (
        <JudgeForm
          key={current.id}
          catalog={catalog}
          judge={current}
          index={value.findIndex((j) => j.id === current.id)}
          total={value.length}
          onChange={(patch) => update(current.id, patch)}
          onDuplicate={() => duplicate(current)}
          onMove={(d) => move(current.id, d)}
          confirmingDelete={confirmDelete === current.id}
          onDelete={() => (value.length > 1 ? setConfirmDelete(current.id) : undefined)}
          onConfirmDelete={(yes) => (yes ? remove(current.id) : setConfirmDelete(null))}
          canAdd={value.length < catalog.max_judges}
        />
      ) : (
        <div className="jr-empty">
          <p>No judges yet.</p>
          <button type="button" className="btn" onClick={add}>+ Add your first judge</button>
        </div>
      )}
    </div>
  );
}

function defaultVoice(catalog: JudgeCatalog, role: JudgeRole, gender: string): string {
  const base = stock(catalog, role);
  const v = catalog.voices.find((x) => x.id === base.voice);
  if (v && v.gender === gender) return v.id;
  return catalog.voices.find((x) => x.gender === gender)?.id ?? base.voice;
}

function voiceLabel(catalog: JudgeCatalog, id: string) {
  return catalog.voices.find((v) => v.id === id)?.label.split(" - ")[0] ?? id;
}

function JudgeForm({
  catalog,
  judge,
  index,
  total,
  onChange,
  onDuplicate,
  onMove,
  confirmingDelete,
  onDelete,
  onConfirmDelete,
  canAdd,
}: {
  catalog: JudgeCatalog;
  judge: RosterJudge;
  index: number;
  total: number;
  onChange: (patch: Partial<RosterJudge>) => void;
  onDuplicate: () => void;
  onMove: (d: -1 | 1) => void;
  confirmingDelete: boolean;
  onDelete: () => void;
  onConfirmDelete: (yes: boolean) => void;
  canAdd: boolean;
}) {
  const [gender, setGender] = useState<"all" | "female" | "male">("all");
  const base = stock(catalog, judge.role);
  const av = avatarOf(catalog, judge.avatar);
  const id = (f: string) => `jr-${judge.id}-${f}`;
  const roleSlot = catalog.slots.find((s) => s.id === judge.role);
  const knows = roleSlot?.defaults.backend?.knows;

  const setRole = (role: JudgeRole) => {
    // Text still at the old role's defaults follows the new role; edited text is kept.
    const next = stock(catalog, role);
    const patch: Partial<RosterJudge> = { role };
    for (const f of TEXT_FIELDS) if (judge[f] === base[f]) patch[f] = next[f];
    if (judge.tone === base.tone) patch.tone = next.tone;
    if (judge.strictness === base.strictness) patch.strictness = next.strictness;
    onChange(patch);
  };
  const setAvatar = (a: Avatar) => {
    const patch: Partial<RosterJudge> = { avatar: a.id };
    const cur = catalog.voices.find((v) => v.id === judge.voice);
    if (cur && cur.gender !== a.gender) patch.voice = defaultVoice(catalog, judge.role, a.gender);
    onChange(patch);
  };
  const avatars = catalog.avatars.filter((a) => gender === "all" || a.gender === gender);

  return (
    <section className="jr-form" aria-label={`Edit ${judge.name || "judge"}`} data-testid="judge-form">
      <header className="jr-form__head">
        <div className="jr-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {av && <img src={av.portrait} alt="" width={84} height={84} />}
          {av && (
            <span className="jr-hero__sprite" title="How they look in the office">
              <CharThumb sheet={av.sheet} box={44} />
            </span>
          )}
        </div>
        <div className="jr-form__title">
          <span className="eyebrow" style={{ marginBottom: 4 }}>Judge {index + 1} of {total}</span>
          <h2 className="section-title">{judge.name.trim() || "Unnamed judge"}</h2>
          <span className="small muted">{catalog.roles.find((r) => r.id === judge.role)?.label} · {voiceLabel(catalog, judge.voice)} voice</span>
        </div>
        <div className="jr-form__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">↑</button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down">↓</button>
          <button type="button" className="btn btn--ghost btn--small" onClick={onDuplicate} disabled={!canAdd} data-testid="judge-duplicate">Duplicate</button>
          <button type="button" className="btn btn--ghost btn--small jr-danger" onClick={onDelete} disabled={total <= 1} title={total <= 1 ? "Keep at least one judge" : undefined} data-testid="judge-delete">
            Remove
          </button>
        </div>
      </header>
      {confirmingDelete && (
        <div className="banner banner--warn jr-confirm" role="alert">
          <span>Remove {judge.name || "this judge"}? Their placement in your office goes too.</span>
          <span className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--small" onClick={() => onConfirmDelete(true)} data-testid="judge-delete-confirm">Remove</button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => onConfirmDelete(false)}>Keep</button>
          </span>
        </div>
      )}

      <div className="jr-grid">
        <div className="field">
          <label htmlFor={id("name")}>Name</label>
          <input id={id("name")} className="input" value={judge.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={!judge.name.trim()} data-testid="judge-name" />
          {!judge.name.trim() && <span className="field__hint xsmall jr-err">A name is required.</span>}
        </div>
        <div className="field">
          <label htmlFor={id("role")}>Role in the incident</label>
          <select id={id("role")} className="select" value={judge.role} onChange={(e) => setRole(e.target.value as JudgeRole)} data-testid="judge-role">
            {catalog.roles.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          {knows && <span className="field__hint xsmall muted">Knows: {knows.toLowerCase()}. Sets which facts they can share.</span>}
        </div>
      </div>

      <fieldset className="jr-fieldset">
        <legend>Appearance</legend>
        <div className="jr-seg" role="radiogroup" aria-label="Filter avatars">
          {(["all", "female", "male"] as const).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={gender === g} className={gender === g ? "is-on" : ""} onClick={() => setGender(g)}>
              {g === "all" ? "All" : g === "female" ? "Women" : "Men"}
            </button>
          ))}
        </div>
        <div className="jr-avatars" role="radiogroup" aria-label="Avatar">
          {avatars.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={judge.avatar === a.id} aria-label={`Avatar ${a.id}`} className={judge.avatar === a.id ? "is-on" : ""} onClick={() => setAvatar(a)} data-testid={`avatar-${a.id.replace(/\s+/g, "-").toLowerCase()}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.portrait} alt="" loading="lazy" width={52} height={52} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="jr-fieldset">
        <legend>Voice</legend>
        <p className="xsmall muted" style={{ marginTop: 0 }}>The voices set up for your voice calls. Candidates hear this one when they talk to {judge.name.trim() || "this judge"}.</p>
        <div className="jr-voices" role="radiogroup" aria-label="Voice">
          {catalog.voices.map((v) => (
            <VoiceOption key={v.id} voice={v} on={judge.voice === v.id} onPick={() => onChange({ voice: v.id })} />
          ))}
        </div>
      </fieldset>

      <fieldset className="jr-fieldset">
        <legend>Behaviour</legend>
        <div className="jr-grid">
          <div className="field">
            <label htmlFor={id("tone")}>Tone</label>
            <select id={id("tone")} className="select" value={judge.tone} onChange={(e) => onChange({ tone: e.target.value })}>
              {catalog.tones.map((t) => (
                <option key={t.id} value={t.id}>{t.id[0]!.toUpperCase() + t.id.slice(1)} — {t.description}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={id("strict")}>How demanding · {judge.strictness}/5 · {STRICT_LABEL[judge.strictness]}</label>
            <input id={id("strict")} type="range" min={1} max={5} step={1} value={judge.strictness} onChange={(e) => onChange({ strictness: Number(e.target.value) })} />
            <span className="field__hint xsmall muted">{catalog.strictness.find((s) => s.level === judge.strictness)?.description}</span>
          </div>
        </div>
        <TextField label="Personality" rows={3} max={600} value={judge.personality} stock={base.personality} onChange={(v) => onChange({ personality: v })} testid="judge-personality" />
        <TextField label="Opening line" rows={2} max={300} value={judge.greeting} stock={base.greeting} onChange={(v) => onChange({ greeting: v })} testid="judge-greeting" />
        <TextField label="What they probe for" rows={2} max={400} value={judge.focus} stock={base.focus} onChange={(v) => onChange({ focus: v })} testid="judge-focus" />
        <p className="xsmall muted">Judges stay in role and never give away the cause or the fix. These settings change their manner, how hard they push and what they ask about.</p>
      </fieldset>
    </section>
  );
}

function TextField({ label, rows, max, value, stock: def, onChange, testid }: { label: string; rows: number; max: number; value: string; stock: string; onChange: (v: string) => void; testid: string }) {
  const id = `jr-${testid}`;
  const isDefault = value === def;
  return (
    <div className="field">
      <div className="row between">
        <label htmlFor={id}>{label}</label>
        {isDefault ? (
          <span className="badge" title="Default text adapts to each topic's incident">Default</span>
        ) : (
          <button type="button" className="text-link xsmall" onClick={() => onChange(def)} data-testid={`${testid}-reset`}>Reset to default</button>
        )}
      </div>
      <textarea id={id} className="textarea" rows={rows} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
      <span className="field__hint xsmall muted">{value.length}/{max}{!value.trim() ? " · empty uses the default" : ""}</span>
    </div>
  );
}

let playing: HTMLAudioElement | null = null;

function VoiceOption({ voice, on, onPick }: { voice: JudgeCatalog["voices"][number]; on: boolean; onPick: () => void }) {
  const [busy, setBusy] = useState(false);
  const [name, ...rest] = voice.label.split(" - ");
  const play = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!voice.sample) return;
    playing?.pause();
    const a = new Audio(voice.sample);
    playing = a;
    setBusy(true);
    a.onended = a.onerror = a.onpause = () => setBusy(false);
    a.play().catch(() => setBusy(false));
  };
  return (
    <div className={`jr-voice${on ? " is-on" : ""}`} data-testid={`voice-${voice.id}`}>
      <button type="button" role="radio" aria-checked={on} className="jr-voice__pick" onClick={onPick}>
        <span className="jr-voice__dot" aria-hidden="true" />
        <span>
          <strong>{name}</strong>
          <span className="xsmall muted">{rest.join(" - ") || "Voice"} · {voice.gender === "female" ? "female" : "male"}</span>
        </span>
      </button>
      {voice.sample && (
        <button type="button" className="jr-voice__play" onClick={play} aria-label={`Play a sample of ${name}`}>
          {busy ? "■" : "▶"}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------- modal
export function JudgeRosterModal({ company, onClose, onSaved }: { company: Company; onClose: () => void; onSaved: (c: Company) => void }) {
  const [catalog, setCatalog] = useState<JudgeCatalog | null>(null);
  const [roster, setRoster] = useState<RosterJudge[]>([]);
  const [initial, setInitial] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    companyApi.catalog().then(
      (c) => {
        setCatalog(c);
        const r = effectiveRoster(company, c);
        setRoster(r);
        setInitial(JSON.stringify(r));
      },
      (e: unknown) => setError(e instanceof Error ? e.message : "Could not load judges."),
    );
  }, [company]);

  const dirty = catalog !== null && JSON.stringify(roster) !== initial;
  const issues = useMemo(() => (catalog ? problems(roster, catalog.max_judges) : []), [roster, catalog]);
  const close = () => (dirty ? setAskDiscard(true) : onClose());

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      playing?.pause();
    };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") (dirty ? setAskDiscard(true) : onClose());
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [dirty, onClose]);

  const save = async () => {
    if (issues.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await companyApi.update({ judge_roster: roster.map((j) => ({ ...j, name: j.name.trim() })) });
      onSaved(res.company);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your judges.");
      setBusy(false);
    }
  };

  return (
    <div className="jr-modal" role="dialog" aria-modal="true" aria-labelledby="jr-title" ref={ref} tabIndex={-1} data-testid="judge-modal">
      <header className="jr-modal__bar">
        <div>
          <span className="eyebrow" style={{ margin: 0 }}>{company.name} · AI judges</span>
          <h1 id="jr-title" className="jr-modal__title">Configure your judges</h1>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {dirty && <span className="xsmall muted">Unsaved changes</span>}
          <button type="button" className="btn btn--ghost" onClick={close} data-testid="judge-cancel">Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={busy || !catalog || issues.length > 0} data-testid="judge-save">
            {busy ? <span className="busy-dots">Saving</span> : "Save judges"}
          </button>
        </div>
      </header>
      {(error || issues.length > 0 || askDiscard) && (
        <div className="jr-modal__notes">
          {error && <div className="banner banner--error" role="alert">{error}</div>}
          {issues.length > 0 && <div className="banner banner--warn" role="status" data-testid="judge-issues">{issues.join(" ")}</div>}
          {askDiscard && (
            <div className="banner banner--warn jr-confirm" role="alert">
              <span>Discard your unsaved changes to the judges?</span>
              <span className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn--small" onClick={onClose} data-testid="judge-discard">Discard</button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setAskDiscard(false)}>Keep editing</button>
              </span>
            </div>
          )}
        </div>
      )}
      <div className="jr-modal__body">
        {catalog ? <JudgeRosterEditor catalog={catalog} value={roster} onChange={setRoster} /> : !error && <div className="skeleton" style={{ height: 420, margin: 24 }} />}
      </div>
    </div>
  );
}

/** Compact list of the judges (setup wizard card, dashboards). */
export function RosterSummary({ catalog, roster, legacy }: { catalog: JudgeCatalog; roster: RosterJudge[]; legacy: boolean }) {
  return (
    <ul className="list-reset ws-roster" data-testid="roster-summary">
      {roster.map((j) => {
        const av = avatarOf(catalog, j.avatar);
        return (
          <li key={j.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {av ? <img src={av.portrait} alt="" width={36} height={36} className="jr-mini" /> : <span />}
            <span>
              <strong>{legacy ? "Random cast member" : j.name}</strong>
              <span className="xsmall muted">
                {catalog.roles.find((r) => r.id === j.role)?.label}
                {legacy ? "" : ` · ${voiceLabel(catalog, j.voice)} voice`}
              </span>
            </span>
            <span className="badge">AI judge</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The roster as the world editor needs it (who can be placed, their label and look). */
export function worldJudges(roster: RosterJudge[], catalog: JudgeCatalog | null, legacy = false): WorldJudge[] {
  return roster.map((j) => {
    const title = catalog?.roles.find((r) => r.id === j.role)?.label ?? j.role;
    return { id: j.id, name: legacy ? title : j.name, role: j.role, title, sheet: (catalog && avatarOf(catalog, j.avatar)?.sheet) || "m1" };
  });
}
