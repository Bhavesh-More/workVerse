"use client";

import { useState } from "react";

export const ROLES = [
  "Junior Backend Engineer",
  "Junior Frontend Engineer",
  "Full-Stack Developer",
  "Mobile Developer",
  "DevOps / SRE Engineer",
  "Data Analyst",
  "Data Scientist",
  "ML Engineer",
  "QA / Test Engineer",
  "Product Manager",
  "UI/UX Designer",
  "Business Analyst",
];
const OTHER = "__other__";

/** Target-role dropdown; "Other…" reveals a text box so any role still works. */
export function RoleSelect({ id, value, onChange }: { id: string; value: string; onChange: (role: string) => void }) {
  const [custom, setCustom] = useState(() => value !== "" && !ROLES.includes(value));
  return (
    <>
      <select
        id={id}
        className="select"
        value={custom ? OTHER : value}
        onChange={(e) => {
          const next = e.target.value;
          setCustom(next === OTHER);
          onChange(next === OTHER ? "" : next);
        }}
      >
        {!custom && value === "" && <option value="">Choose a role…</option>}
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {custom && (
        <input
          className="input"
          style={{ marginTop: 8 }}
          aria-label="Your target role"
          placeholder="Type your role, e.g. Cloud Engineer"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      )}
    </>
  );
}
