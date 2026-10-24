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

// Tools offered on onboarding for each role; roles typed via "Other…" get the general list.
const ROLE_TOOLS: Record<string, string[]> = {
  "Junior Backend Engineer": ["Python", "FastAPI", "Node.js", "Java", "PostgreSQL", "Redis", "Docker", "Git", "AWS"],
  "Junior Frontend Engineer": ["TypeScript", "React", "Next.js", "CSS", "Tailwind", "Vite", "Jest", "Figma", "Git"],
  "Full-Stack Developer": ["TypeScript", "React", "Next.js", "Node.js", "Python", "PostgreSQL", "Docker", "Git", "AWS"],
  "Mobile Developer": ["React Native", "Expo", "Swift", "Kotlin", "Flutter", "Firebase", "Xcode", "Android Studio", "Git"],
  "DevOps / SRE Engineer": ["Linux", "Docker", "Kubernetes", "Terraform", "AWS", "GitHub Actions", "Prometheus", "Grafana", "Bash"],
  "Data Analyst": ["SQL", "Excel", "Python", "Pandas", "Power BI", "Tableau", "Google Sheets", "Looker"],
  "Data Scientist": ["Python", "Pandas", "NumPy", "scikit-learn", "Jupyter", "SQL", "Matplotlib", "Statistics"],
  "ML Engineer": ["Python", "PyTorch", "TensorFlow", "scikit-learn", "Hugging Face", "MLflow", "Docker", "AWS SageMaker"],
  "QA / Test Engineer": ["Selenium", "Playwright", "Cypress", "Jest", "Postman", "JIRA", "Python", "Git"],
  "Product Manager": ["JIRA", "Notion", "Figma", "Google Analytics", "Mixpanel", "SQL", "Confluence", "Miro"],
  "UI/UX Designer": ["Figma", "Adobe XD", "Sketch", "Framer", "Miro", "Photoshop", "Illustrator", "Maze"],
  "Business Analyst": ["Excel", "SQL", "Power BI", "Tableau", "JIRA", "Confluence", "Visio", "Google Sheets"],
};
const GENERAL_TOOLS = ["Git", "Excel", "SQL", "Python", "JIRA", "Notion", "Slack", "Figma"];

export function toolsFor(role: string): string[] {
  return ROLE_TOOLS[role] ?? GENERAL_TOOLS;
}

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
