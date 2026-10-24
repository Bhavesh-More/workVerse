// Company-built worlds: the saved document (WorldDoc), the asset catalog it references, and the
// compiled runtime map that both the editor canvas and the game render.
//
// Coordinates are tiles unless a name says px. One tile is 32 world px (16 art px exported at 2x),
// the same grid the default office uses, so every asset keeps its native pixel size.

export const TILE = 32;
export const WORLD_VERSION = 1;
export const MIN_W = 16;
export const MIN_H = 12;
export const MAX_W = 96;
export const MAX_H = 72;

export type FloorKind = "stone" | "oak" | "walnut" | "concrete" | "carpet" | "checker";
export type Paint = "reception" | "meeting" | "manager" | "corridor" | "engineering" | "collab" | "break";
export type Dir = "down" | "left" | "right" | "up";

/** One character per cell in WorldDoc.floor rows; "." is wall (or empty space). */
export const FLOOR_CODES: Record<FloorKind, string> = {
  stone: "s",
  oak: "o",
  walnut: "w",
  concrete: "c",
  carpet: "p",
  checker: "k",
};
export const CODE_FLOORS: Record<string, FloorKind> = Object.fromEntries(
  Object.entries(FLOOR_CODES).map(([k, v]) => [v, k as FloorKind]),
);

/** What a room is for. The scenario's locations are matched by purpose (one room each). */
export type RoomPurpose =
  | "reception"
  | "meeting_room"
  | "manager_office"
  | "engineering_workspace"
  | "collaboration_area"
  | "break_area"
  | "corridor_main"
  | "other";

export const PURPOSES: { id: RoomPurpose; label: string }[] = [
  { id: "reception", label: "Reception" },
  { id: "meeting_room", label: "Meeting room" },
  { id: "manager_office", label: "Manager's office" },
  { id: "engineering_workspace", label: "Team workspace" },
  { id: "collaboration_area", label: "Collaboration area" },
  { id: "break_area", label: "Break area" },
  { id: "corridor_main", label: "Corridor" },
  { id: "other", label: "Other" },
];

export type Room = {
  id: string;
  name: string;
  purpose: RoomPurpose;
  x: number;
  y: number;
  w: number;
  h: number;
  paint: Paint;
  floor: FloorKind;
};

export type PlacedObject = {
  id: string;
  asset: string;
  x: number;
  y: number;
  /** Free-placement nudge in world px (multiple of 2, under one tile), for snap-off placement. */
  ox?: number;
  oy?: number;
};

/** Where a person starts. `ref` points at their identity: "judge:<slot>", "member:<id>", "pet:<sprite>". */
export type PersonPlacement = {
  id: string;
  ref: string;
  x: number;
  y: number;
  face: Dir;
};

export type WorldDoc = {
  version: typeof WORLD_VERSION;
  name: string;
  width: number;
  height: number;
  floor: string[];
  rooms: Room[];
  objects: PlacedObject[];
  people: PersonPlacement[];
  spawn: { x: number; y: number };
};

/** A team member shown in the office (display only: not a login, not an AI judge). */
export type Member = { id: string; name: string; title: string; look: string };

// ---------------------------------------------------------------------------------- catalog
export type AssetCategory =
  | "desks"
  | "seating"
  | "tables"
  | "storage"
  | "kitchen"
  | "tech"
  | "plants"
  | "wall"
  | "interactive";

export type Asset = {
  id: string;
  label: string;
  category: AssetCategory;
  mount: "floor" | "wall";
  /** Footprint in tiles. Wall pieces are w x 2 face cells. */
  w: number;
  h: number;
  frame: string;
  img_w: number;
  img_h: number;
  /** Image top-left relative to the footprint's top-left, world px. */
  ox: number;
  oy: number;
  solid: boolean;
  interactive?: string;
  tags?: string[];
};

export type Catalog = {
  version: number;
  tile: number;
  floors: { id: FloorKind; label: string }[];
  paints: { id: Paint; label: string }[];
  assets: Asset[];
};

export type TilesMeta = {
  tile: number;
  patch: number;
  floors: Record<FloorKind, { x: number; y: number }>;
  caps: Record<string, { x: number; y: number }>;
  faces: Record<Paint, { x: number; y: number }>;
};

export type Atlas = { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> };

export type Kit = { catalog: Catalog; tiles: TilesMeta; atlas: Atlas; byId: Map<string, Asset> };

export function makeKit(catalog: Catalog, tiles: TilesMeta, atlas: Atlas): Kit {
  return { catalog, tiles, atlas, byId: new Map(catalog.assets.map((a) => [a.id, a])) };
}

// ---------------------------------------------------------------------------------- compiled
export type CompiledProp = { id: string; f: string; x: number; y: number; d: number };
export type ObjectSlot = {
  x: number;
  y: number;
  ax: number;
  ay: number;
  frame: string;
  px: number;
  py: number;
  d: number;
  mounted: boolean;
};

export type CompiledWorld = {
  kind: "custom";
  width: number;
  height: number;
  /** Floor kind per cell, null for wall/void. */
  floors: (FloorKind | null)[][];
  /** Wall-face row per cell: 0 top, 1 bottom, -1 none; and the paint it uses. */
  faces: { row: number; paint: Paint }[][];
  collision: number[][];
  spawn: { x: number; y: number };
  rooms: { id: string; name: string; x0: number; y0: number; x1: number; y1: number; paint: Paint }[];
  props: CompiledProp[];
  mounted: CompiledProp[];
  npc_slots: Record<string, { x: number; y: number; face?: Dir }>;
  object_slots: Record<string, ObjectSlot>;
  members: { id: string; name: string; title: string; look: string; x: number; y: number; face: Dir }[];
  pets: { sprite: string; x: number; y: number; room: string }[];
};
