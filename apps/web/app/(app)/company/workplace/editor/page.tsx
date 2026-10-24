"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FormError } from "../../../../../components/AuthShell";
import { WorldEditor } from "../../../../../components/world/editor/WorldEditor";
import { companyApi } from "../../../../../lib/company";
import { workplaceApi, type WorkplaceState } from "../../../../../lib/workplace";
import { emptyWorld } from "../../../../../lib/world/doc";

export default function WorldEditorPage() {
  const [wp, setWp] = useState<WorkplaceState | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Always fresh: the editor must start from the latest saved version.
    workplaceApi.get().then(setWp, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load your world."));
    companyApi.get().then(
      ({ company }) => {
        const out: Record<string, string> = {};
        for (const [slot, cfg] of Object.entries(company?.judge_defaults ?? {})) if (cfg?.name) out[slot] = cfg.name;
        setNames(out);
      },
      () => {},
    );
  }, []);

  if (error)
    return (
      <main className="app-main">
        <FormError message={error} />
        <Link className="text-link" href="/company">Back to dashboard</Link>
      </main>
    );
  if (!wp) return <div className="we-boot">Opening the editor…</div>;
  return (
    <WorldEditor
      initial={wp.world?.draft ?? emptyWorld(40, 28, "Our office")}
      version={wp.world?.draft_version ?? 0}
      members={wp.members}
      judgeNames={names}
      publishedVersion={wp.world?.published_version ?? null}
      mode={wp.mode}
    />
  );
}
