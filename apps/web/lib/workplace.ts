// Company workplace API: default-vs-custom choice, setup wizard progress, team members, world.
import { request } from "./api";
import type { Member, WorldDoc } from "./world/types";

export type WorldSetup = {
  step?: "choose" | "presets" | "people" | "done";
  presets?: string[];
  completed?: boolean;
};

export type WorkplaceState = {
  mode: "default" | "custom" | null;
  setup: WorldSetup;
  members: Member[];
  world: null | {
    draft: WorldDoc;
    draft_version: number;
    published: boolean;
    published_version: number | null;
    published_at: string | null;
    updated_at: string | null;
  };
};

export const workplaceApi = {
  get: () => request<WorkplaceState>("/company/workplace"),
  patch: (body: { mode?: "default" | "custom"; setup?: WorldSetup; members?: Member[] }) =>
    request<WorkplaceState>("/company/workplace", { method: "PATCH", body }),
  saveDraft: (doc: WorldDoc, baseVersion: number) =>
    request<{ draft_version: number; saved_at: string }>("/company/workplace/draft", { method: "PUT", body: { doc, base_version: baseVersion } }),
  publish: (baseVersion: number, activate = true) =>
    request<WorkplaceState>("/company/workplace/publish", { method: "POST", body: { base_version: baseVersion, activate } }),
  revert: () => request<WorkplaceState>("/company/workplace/revert", { method: "POST" }),
};
