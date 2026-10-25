"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FormError } from "../../../../../components/AuthShell";
import { effectiveRoster, worldJudges } from "../../../../../components/judges/JudgeRoster";
import { WorldEditor } from "../../../../../components/world/editor/WorldEditor";
import { companyApi } from "../../../../../lib/company";
import { workplaceApi, type WorkplaceState } from "../../../../../lib/workplace";
import { emptyWorld } from "../../../../../lib/world/doc";
import type { WorldJudge } from "../../../../../lib/world/types";
import { DEFAULT_JUDGES } from "../../../../../lib/world/validate";

export default function WorldEditorPage() {
  const [wp, setWp] = useState<WorkplaceState | null>(null);
  const [judges, setJudges] = useState<{ list: WorldJudge[]; vary: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Always fresh: the editor must start from the latest saved version.
    workplaceApi.get().then(setWp, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load your world."));
    Promise.all([companyApi.get(), companyApi.catalog()]).then(
      ([{ company }, catalog]) => {
        if (!company) return setJudges({ list: DEFAULT_JUDGES, vary: true });
        const legacy = !company.judge_roster;
        setJudges({ list: worldJudges(effectiveRoster(company, catalog), catalog, legacy), vary: legacy });
      },
      () => setJudges({ list: DEFAULT_JUDGES, vary: true }),
    );
  }, []);

  if (error)
    return (
      <main className="app-main">
        <FormError message={error} />
        <Link className="text-link" href="/company">Back to dashboard</Link>
      </main>
    );
  if (!wp || !judges) return <div className="we-boot">Opening the editor…</div>;
  return (
    <WorldEditor
      initial={wp.world?.draft ?? emptyWorld(40, 28, "Our office")}
      version={wp.world?.draft_version ?? 0}
      members={wp.members}
      judges={judges.list}
      judgesVary={judges.vary}
      publishedVersion={wp.world?.published_version ?? null}
      mode={wp.mode}
    />
  );
}
