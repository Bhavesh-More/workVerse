import * as Phaser from "phaser";
import type { NavigationTarget, WorldCharacter, WorldView } from "../lib/types";
import {
  NavigationOverlay,
  type NavigationStatus,
  type RouteTarget,
} from "./navigation";
import { buildNavGrid, findPath, nearestWalkable, smoothPath, toWorldPoints, type NavGrid } from "./pathfinding";
import { drawGround, drawWalls } from "../lib/world/render";
import { KIT } from "../lib/world/kit";
import { REQUIRED_OBJECTS } from "../lib/world/validate";
import type { CompiledWorld } from "../lib/world/types";
import { BOARD_COLORS, IM, KIOSK_COLORS, MARK_SMALL, MONITOR, PIXEL_COLORS, STANDEE } from "../lib/imocha";

// World units: art is authored on a 16px grid and exported at 2x by scripts/build_*.py, so one
// tile is 32 world px and every image is drawn 1:1 (no sprite is ever scaled in the engine).
const TILE = 32;
const CHAR_FRAME = 64;
const PET_FRAME = 32;
/** Existing interaction radius: also used as the navigation arrival distance. */
const INTERACT_RADIUS = 64;

// Movement feel. Speeds are world px/s; the walk cycle (4 frames = 2 steps) is played at a rate
// proportional to actual speed so feet keep pace with the ground (~1 tile per step).
const WALK_SPEED = 175;
const RUN_SPEED = 320; // hold Shift

const ACCEL_MS = 70; // time to reach full speed / stop (exponential smoothing)
const WALK_FPS = 11; // at WALK_SPEED
const IDLE_FPS = 4;
const PET_SPEED = 38;

// Camera: the zoom snaps to half steps so one art pixel is always a whole number of canvas px.
const VIEW_TILES_TALL = 11;
const VIEW_TILES_WIDE = 18;

const DEPTH_GROUND = 0;
const DEPTH_WALLS = 1;
const DEPTH_UI = 5000;

/** The iMocha product guide stands in the lobby; she isn't part of any scenario. */
export const GUIDE_ID = "imocha_guide";
const GUIDE_LABEL = "Mia · iMocha guide";
export const HUB_ROOM = "imocha_hub";
const HUB_LABEL = "iMocha Hub";

export type OfficeOptions = {
  world: WorldView;
  playerTexture: string;
  onPrompt: (label: string | null) => void;
  onNearCharacter: (characterId: string | null) => void;
  onInteractCharacter: (characterId: string) => void;
  onVoiceCharacter: (characterId: string) => void;
  onInteractObject: (objectId: string) => void;
  /** Talk to the iMocha guide (click or E). Without it she isn't placed. */
  onInteractGuide?: () => void;
  /** Use the iMocha Hub screen (click or E). */
  onOpenHub?: () => void;
  onLocationChange: (locationId: string) => void;
  onNavigationStatus?: (status: NavigationStatus) => void;
  onReady: () => void;
  isLocked?: () => boolean;
  /** A company-built office. Without it the default office (baked map) is used. */
  map?: CompiledWorld | null;
};

type ObjectSlot = {
  x: number;
  y: number;
  /** Approach anchor in world px (the floor in front of the object). */
  ax: number;
  ay: number;
  frame: string;
  px: number;
  py: number;
  d: number;
  mounted: boolean;
};

type MapMeta = {
  width: number;
  height: number;
  spawn: { x: number; y: number };
  rooms: { id: string; x0: number; y0: number; x1: number; y1: number }[];
  npc_slots: Record<string, { x: number; y: number; face?: Dir }>;
  object_slots: Record<string, ObjectSlot>;
  props: { f: string; x: number; y: number; d: number }[];
  pets: { sprite: string; x: number; y: number; room: string }[];
  collision: number[][];
};

type Dir = "down" | "left" | "right" | "up";

type Interactable = {
  kind: "character" | "object" | "guide" | "hub";
  id: string;
  label: string;
  x: number;
  y: number;
  gameObject: Phaser.GameObjects.GameObject & { x: number; y: number };
  /** Objects: the sprite to swap to its highlighted frame when it's the current target. */
  sprite?: Phaser.GameObjects.Image;
  frame?: string;
  tag?: Phaser.GameObjects.Text;
  npc?: Phaser.GameObjects.Sprite;
  texture?: string;
  face?: Dir;
};

type Pet = {
  sprite: Phaser.GameObjects.Sprite;
  key: string;
  room: { x0: number; y0: number; x1: number; y1: number };
  path: { x: number; y: number }[];
  restUntil: number;
};

const HUMAN_ROWS: Record<Dir, { idle: number; walk: number }> = {
  down: { idle: 0, walk: 4 },
  left: { idle: 1, walk: 5 },
  right: { idle: 2, walk: 6 },
  up: { idle: 3, walk: 7 },
};

/** Cast sheets from scripts/build_characters.py; NPCs are matched to their colleague's gender. */
const CAST = {
  player: "player",
  male: ["m1", "m2", "m3", "m4", "m5"],
  female: ["f1", "f2", "f3", "f4", "f5"],
  pets: ["cat_white", "cat_brown", "cat_brown2"],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable, distinct sheet per colleague: gender pool, starting at a hash of their name. */
export function assignCast(characters: Pick<WorldCharacter, "id" | "name" | "sprite" | "profile">[]) {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  // A company judge's avatar comes with its sprite; everyone else is matched by gender.
  for (const c of characters) if (c.profile?.sheet && !used.has(c.profile.sheet)) {
    used.add(c.profile.sheet);
    out[c.id] = c.profile.sheet;
  }
  for (const c of characters) {
    if (out[c.id]) continue;
    const female = c.profile?.gender
      ? c.profile.gender === "female"
      : c.sprite === "blue_haired_woman";
    const pool = female ? CAST.female : CAST.male;
    const start = hash(c.name || c.id) % pool.length;
    let pick = pool[start]!;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[(start + i) % pool.length]!;
      if (!used.has(candidate)) {
        pick = candidate;
        break;
      }
    }
    used.add(pick);
    out[c.id] = pick;
  }
  return out;
}

export function createOfficeGame(parent: HTMLElement, options: OfficeOptions): Phaser.Game {
  class OfficeScene extends Phaser.Scene {
    private meta!: MapMeta;
    private player!: Phaser.Physics.Arcade.Sprite;
    private keys!: Record<string, Phaser.Input.Keyboard.Key>;
    private interactables: Interactable[] = [];
    private currentTarget: Interactable | null = null;
    private lastNearCharacter: string | null = null;
    private lastLocation = "";
    private lastDir: Dir = "down";
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private playerTexture = CAST.player;
    private navGrid!: NavGrid;
    private nav!: NavigationOverlay;
    private navTarget: NavigationTarget | null = null;
    private navVisible = true;
    private navTargetId: string | null = null;
    private colliders!: Phaser.Physics.Arcade.StaticGroup;
    private velocity = new Phaser.Math.Vector2();
    private lastPos = new Phaser.Math.Vector2();
    private achieved = 0;
    private pets: Pet[] = [];

    constructor() {
      super("office");
    }

    preload() {
      if (options.map) {
        // Custom world: floors and walls are assembled from the kit at create time.
        this.load.image("kit_tiles", "/assets/game/kit/tiles.png");
        this.load.atlas("props", "/assets/game/kit/props.png", "/assets/game/kit/props.json");
      } else {
        this.load.image("ground", "/assets/game/map/ground.png");
        this.load.image("walls", "/assets/game/map/walls.png");
        this.load.atlas("props", "/assets/game/map/props.png", "/assets/game/map/props.json");
        this.load.json("mapmeta", "/assets/game/map/map.json");
      }
      for (const key of [CAST.player, ...CAST.male, ...CAST.female]) {
        this.load.spritesheet(key, `/assets/game/chars/${key}.png`, {
          frameWidth: CHAR_FRAME,
          frameHeight: CHAR_FRAME,
        });
      }
      for (const key of CAST.pets) {
        this.load.spritesheet(key, `/assets/game/chars/${key}.png`, {
          frameWidth: PET_FRAME,
          frameHeight: PET_FRAME,
        });
      }
    }

    create() {
      this.meta = options.map ? (options.map as unknown as MapMeta) : (this.cache.json.get("mapmeta") as MapMeta);
      if (!this.meta?.collision || !this.textures.exists("props") || (options.map && !this.textures.exists("kit_tiles"))) {
        // A failed asset load (e.g. an HTML page served instead of JSON) must not crash the scene.
        console.error("Office map assets failed to load (map.json / props atlas).");
        return;
      }
      const worldW = this.meta.width * TILE;
      const worldH = this.meta.height * TILE;

      if (options.map) this.buildCustomLayers(options.map);
      else {
        this.add.image(0, 0, "ground").setOrigin(0, 0).setDepth(DEPTH_GROUND);
        this.add.image(0, 0, "walls").setOrigin(0, 0).setDepth(DEPTH_WALLS);
      }
      // Free-standing furniture is y-sorted with characters by its base line.
      for (const p of this.meta.props) {
        this.add.image(p.x, p.y, "props", p.f).setOrigin(0, 0).setDepth(p.d);
      }

      this.colliders = this.physics.add.staticGroup();
      this.buildAnimations();
      const lobby = options.onInteractGuide ? this.reserveLobby() : null;
      this.buildCollision();
      this.buildIndicatorTexture();
      this.buildInteractables();
      this.buildBranding(lobby);
      this.buildPlayer();
      this.buildPets();
      if (options.map) this.buildMembers(options.map);

      this.navGrid = buildNavGrid(this.meta.collision);
      this.nav = new NavigationOverlay(this, this.navGrid, TILE, (status) =>
        options.onNavigationStatus?.(status),
      );
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.nav.destroy());

      this.physics.world.setBounds(0, 0, worldW, worldH);
      const cam = this.cameras.main;
      cam.setBounds(0, 0, worldW, worldH);
      cam.startFollow(this.player, true, 0.14, 0.14);
      cam.setRoundPixels(true);
      this.fitZoom();
      this.scale.on(Phaser.Scale.Events.RESIZE, this.fitZoom, this);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
        this.scale.off(Phaser.Scale.Events.RESIZE, this.fitZoom, this),
      );

      this.cursors = this.input.keyboard!.addKeys(
        {
          up: Phaser.Input.Keyboard.KeyCodes.UP,
          down: Phaser.Input.Keyboard.KeyCodes.DOWN,
          left: Phaser.Input.Keyboard.KeyCodes.LEFT,
          right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
          space: Phaser.Input.Keyboard.KeyCodes.SPACE,
          shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
        },
        false,
      ) as Phaser.Types.Input.Keyboard.CursorKeys;
      this.keys = this.input.keyboard!.addKeys("W,A,S,D,E", false) as Record<
        string,
        Phaser.Input.Keyboard.Key
      >;
      this.input.keyboard!.on("keydown-E", () => this.interact());
      // Phaser prevents the default on mousedown, so clicking the game never takes focus from the
      // chat box (or a button) you used last; arrows/WASD would stay blocked as "typing". Clicking
      // the office means "back to walking", so let go of that focus.
      this.input.on("pointerdown", () => {
        const el = document.activeElement as HTMLElement | null;
        if (el && el !== document.body) el.blur();
      });
      // Keys aren't captured (so chat inputs still get them), which also let arrows/space scroll the page
      // while walking. Block just that default, unless the learner is typing or on a control.
      const stopScroll = (e: KeyboardEvent) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) return;
        if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, button, [contenteditable='true'], [role='slider']")) return;
        e.preventDefault();
      };
      window.addEventListener("keydown", stopScroll);
      this.events.once(Phaser.Scenes.Events.DESTROY, () => window.removeEventListener("keydown", stopScroll));
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener("keydown", stopScroll));

      this.lastLocation = this.locationAt(this.player.x, this.player.y);
      options.onLocationChange(this.lastLocation);
      if (process.env.NODE_ENV !== "production") {
        // Dev-only handle for automated checks (movement, collisions) from the preview page.
        (window as unknown as { __officeScene?: Phaser.Scene }).__officeScene = this;
      }
      options.onReady();
    }

    /** Custom world: draw floors and walls from the kit once into two textures (1:1 pixels),
     * plus the wall-mounted pieces that aren't interactive objects. */
    private buildCustomLayers(map: CompiledWorld) {
      const src = this.textures.get("kit_tiles").getSourceImage() as HTMLImageElement;
      for (const [key, depth, paint] of [
        ["custom_ground", DEPTH_GROUND, drawGround],
        ["custom_walls", DEPTH_WALLS, drawWalls],
      ] as const) {
        if (this.textures.exists(key)) this.textures.remove(key);
        const tex = this.textures.createCanvas(key, map.width * TILE, map.height * TILE)!;
        const ctx = tex.getContext();
        ctx.imageSmoothingEnabled = false;
        paint(ctx, map, src, KIT.tiles);
        tex.refresh();
        this.add.image(0, 0, key).setOrigin(0, 0).setDepth(depth);
      }
      const interactiveFrames = new Set(Object.values(map.object_slots).map((s) => s.frame));
      for (const m of map.mounted) {
        if (interactiveFrames.has(m.f)) continue;
        this.add.image(m.x, m.y, "props", m.f).setOrigin(0, 0).setDepth(DEPTH_WALLS + 1);
      }
    }

    /** Team members the company placed: ambient colleagues with a name tag (not interactive). */
    private buildMembers(map: CompiledWorld) {
      for (const m of map.members) {
        const tex = this.textures.exists(m.look) ? m.look : CAST.male[0]!;
        const x = m.x * TILE + TILE / 2;
        const y = m.y * TILE + TILE - 2;
        const sprite = this.add.sprite(x, y, tex, 0).setOrigin(0.5, 1).setDepth(y);
        sprite.anims.play({ key: `${tex}-idle-${m.face}`, startFrame: hash(m.id) % 4 }, true);
        this.colliders.add(this.add.rectangle(x, y - 5, 20, 10, 0, 0));
        this.nameTag(x, y - 44, m.name);
      }
    }

    /** Paint a char grid (see lib/imocha.ts) into a texture: 1 art px = 2 world px, like all office art. */
    private pixelTexture(key: string, rows: string[], colors: Record<string, string>) {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          const c = colors[ch];
          if (!c) return;
          g.fillStyle(Phaser.Display.Color.HexStringToColor(c).color, 1);
          g.fillRect(x * 2, y * 2, 2, 2);
        }),
      );
      g.generateTexture(key, (rows[0]?.length ?? 0) * 2, rows.length * 2);
      g.destroy();
    }

    private buildBrandTextures() {
      const colors = { ...PIXEL_COLORS, ...BOARD_COLORS };
      this.pixelTexture("im_standee", STANDEE, colors);
      this.pixelTexture("im_monitor", MONITOR, { ...colors, ...KIOSK_COLORS });
    }

    /** Pick the guide's and standee's floor tiles in the spawn room and make them solid. */
    private reserveLobby(): { guide: { x: number; y: number }; standee: { x: number; y: number } } | null {
      const spawn = this.meta.spawn;
      const room = this.meta.rooms.find((r) => spawn.x >= r.x0 && spawn.x <= r.x1 && spawn.y >= r.y0 && spawn.y <= r.y1);
      if (!room) return null;
      const grid = this.meta.collision.map((r) => [...r]);
      const free = (x: number, y: number) =>
        x >= room.x0 && x <= room.x1 && y >= room.y0 && y <= room.y1 && grid[y]?.[x] === 0 && grid[y + 1]?.[x] === 0 && !(x === spawn.x && y === spawn.y);
      // Nearest pair of free tiles to the right side, a few rows down: clear of the wall signs and
      // far enough from the desk that the name tags don't collide. Guide on the left of her standee.
      const want = { x: room.x1 - 1, y: room.y0 + 3 };
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let y = room.y0; y < room.y1; y++)
        for (let x = room.x0; x < room.x1; x++) {
          if (!free(x, y) || !free(x + 1, y)) continue;
          const d = Math.hypot(x - want.x, y - want.y);
          if (d < bestD) [best, bestD] = [{ x, y }, d];
        }
      if (!best) return null;
      grid[best.y]![best.x] = 1;
      grid[best.y]![best.x + 1] = 1;
      this.meta = { ...this.meta, collision: grid };
      return { guide: best, standee: { x: best.x + 1, y: best.y } };
    }

    /** iMocha presence: the Hub showroom (its signs are baked into the map) and the guide at reception. */
    private buildBranding(lobby: ReturnType<OfficeScene["reserveLobby"]>) {
      this.buildBrandTextures();
      const hub = this.meta.rooms.find((r) => r.id === HUB_ROOM);
      if (hub) this.buildHub(hub);
      // Company worlds: the iMocha Hub screen the company placed from the editor's partner kit.
      const slot = this.meta.object_slots[HUB_ROOM];
      if (!hub && slot) {
        const sprite = this.add.image(slot.px, slot.py, "props", slot.frame).setOrigin(0, 0).setDepth(slot.d);
        this.hubTarget(sprite, slot.px + sprite.width / 2, slot.py, slot.ax, slot.ay);
      }
      if (lobby) this.buildGuide(lobby);
    }

    /** The Hub: two standees and the interactive screen, kept below the baked wall sign. */
    private buildHub(room: MapMeta["rooms"][number]) {
      const cx = ((room.x0 + room.x1 + 1) / 2) * TILE;
      for (const tx of [room.x0 + 1, room.x1 - 1]) {
        const y = (room.y0 + 3) * TILE;
        this.add.image(tx * TILE + TILE / 2, y, "im_standee").setOrigin(0.5, 1).setDepth(y);
      }
      // The screen stands centred on the back wall; you use it from the tile in front.
      const mon = this.textures.getFrame("im_monitor");
      const baseY = (room.y0 + 3) * TILE;
      const sprite = this.add.image(Math.round(cx - mon.width / 2), baseY - mon.height, "im_monitor").setOrigin(0, 0).setDepth(baseY);
      this.colliders.add(this.add.rectangle(cx, baseY - TILE / 2, mon.width, TILE, 0, 0));
      this.hubTarget(sprite, cx, baseY - mon.height, cx, baseY + TILE / 2);
    }

    /** Make a screen sprite open the iMocha Hub deck (E or click), with the bobbing marker. */
    private hubTarget(sprite: Phaser.GameObjects.Image, cx: number, top: number, ax: number, ay: number) {
      sprite.setInteractive({ useHandCursor: true });
      sprite.on("pointerdown", () => {
        if (options.isLocked?.()) return;
        options.onOpenHub?.();
      });
      const indicator = this.add.image(cx, top - 6, "indicator").setOrigin(0.5, 1).setDepth(DEPTH_UI - 1);
      this.tweens.add({ targets: indicator, y: top - 11, duration: 700, ease: "Sine.easeInOut", yoyo: true, repeat: -1 });
      const tag = this.nameTag(cx, top - 18, HUB_LABEL, true).setVisible(false);
      this.interactables.push({ kind: "hub", id: HUB_ROOM, label: HUB_LABEL, x: ax, y: ay, gameObject: sprite, tag });
    }

    private buildGuide(lobby: NonNullable<ReturnType<OfficeScene["reserveLobby"]>>) {
      const sx = lobby.standee.x * TILE + TILE / 2;
      const sy = lobby.standee.y * TILE + TILE;
      this.add.image(sx, sy, "im_standee").setOrigin(0.5, 1).setDepth(sy);

      const taken = new Set(Object.values(assignCast(options.world.characters)));
      const tex = CAST.female.find((f) => !taken.has(f)) ?? CAST.female[0]!;
      const x = lobby.guide.x * TILE + TILE / 2;
      const y = lobby.guide.y * TILE + TILE - 2;
      const sprite = this.add.sprite(x, y, tex, 0).setOrigin(0.5, 1).setDepth(y);
      sprite.anims.play(`${tex}-idle-down`, true);
      sprite.setInteractive({
        useHandCursor: true,
        hitArea: new Phaser.Geom.Rectangle(16, 22, 32, 42),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      });
      sprite.on("pointerdown", () => {
        if (options.isLocked?.()) return;
        options.onInteractGuide?.();
      });
      const tag = this.add
        .text(x, y - 44, GUIDE_LABEL, {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "10px",
          fontStyle: "bold",
          color: "#ffffff",
          backgroundColor: IM.orange,
          padding: { left: 4, right: 4, top: 2, bottom: 2 },
          resolution: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH_UI);
      // A small bobbing mark over her head says "ask me about iMocha".
      this.pixelTexture("im_badge", MARK_SMALL, PIXEL_COLORS);
      const badge = this.add.image(x, y - 62, "im_badge").setOrigin(0.5, 1).setDepth(DEPTH_UI);
      this.tweens.add({ targets: badge, y: y - 66, duration: 800, ease: "Sine.easeInOut", yoyo: true, repeat: -1 });
      this.interactables.push({ kind: "guide", id: GUIDE_ID, label: GUIDE_LABEL, x, y, gameObject: sprite, npc: sprite, texture: tex, face: "down", tag });
    }

    /** Largest half-step zoom that still shows a comfortable slice of the office. */
    private fitZoom() {
      const { width, height } = this.scale.gameSize;
      const raw = Math.min(height / (VIEW_TILES_TALL * TILE), width / (VIEW_TILES_WIDE * TILE));
      const zoom = Phaser.Math.Clamp(Math.floor(raw * 2) / 2, 1, 3);
      this.cameras.main.setZoom(zoom);
    }

    private buildAnimations() {
      for (const tex of [CAST.player, ...CAST.male, ...CAST.female]) {
        for (const [dir, rows] of Object.entries(HUMAN_ROWS)) {
          this.anims.create({
            key: `${tex}-walk-${dir}`,
            frames: this.anims.generateFrameNumbers(tex, { start: rows.walk * 4, end: rows.walk * 4 + 3 }),
            frameRate: WALK_FPS,
            repeat: -1,
          });
          // The idle row is a gentle 4-frame breath; ping-pong keeps it from popping.
          this.anims.create({
            key: `${tex}-idle-${dir}`,
            frames: this.anims.generateFrameNumbers(tex, { start: rows.idle * 4, end: rows.idle * 4 + 3 }),
            frameRate: IDLE_FPS,
            repeat: -1,
          });
        }
      }
      // Pet rows: idle-down, idle-up, idle-side (3 frames), walk-down, walk-up, walk-side (4 frames).
      for (const pet of CAST.pets) {
        const rows = { "idle-down": [0, 3], "idle-up": [1, 3], "idle-side": [2, 3], "walk-down": [3, 4], "walk-up": [4, 4], "walk-side": [5, 4] };
        for (const [name, [row, count]] of Object.entries(rows) as [string, [number, number]][]) {
          this.anims.create({
            key: `${pet}-${name}`,
            frames: this.anims.generateFrameNumbers(pet, { start: row * 4, end: row * 4 + count - 1 }),
            frameRate: name.startsWith("walk") ? 8 : 3,
            repeat: -1,
          });
        }
      }
    }

    private buildCollision() {
      const grid = this.meta.collision;
      const H = grid.length;
      const W = grid[0]?.length ?? 0;
      for (let y = 0; y < H; y++) {
        let runStart = -1;
        for (let x = 0; x <= W; x++) {
          const solid = x < W && (grid[y]?.[x] ?? 0) === 1;
          if (solid && runStart === -1) runStart = x;
          if (!solid && runStart !== -1) {
            const w = (x - runStart) * TILE;
            this.colliders.add(
              this.add.rectangle(runStart * TILE + w / 2, y * TILE + TILE / 2, w, TILE, 0xff0000, 0),
            );
            runStart = -1;
          }
        }
      }
      this.physics.world.setBoundsCollision(true, true, true, true);
    }

    /** A small pixel diamond that floats over things you can use. */
    private buildIndicatorTexture() {
      if (this.textures.exists("indicator")) return;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      const px = (x: number, y: number, w: number, h: number, c: number) => {
        g.fillStyle(c, 1);
        g.fillRect(x * 2, y * 2, w * 2, h * 2);
      };
      // 7x7 art px diamond: outline, gold body, highlight
      const rows = ["...#...", "..#a#..", ".#aab#.", "#aabbb#", ".#bbb#.", "..#b#..", "...#..."];
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === "#") px(x, y, 1, 1, 0x2b2232);
          if (ch === "a") px(x, y, 1, 1, 0xfff1a8);
          if (ch === "b") px(x, y, 1, 1, 0xfecc33);
        }),
      );
      g.generateTexture("indicator", 14, 14);
      g.destroy();
    }

    private nameTag(x: number, y: number, text: string, emphasis = false) {
      return this.add
        .text(x, y, text, {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "10px",
          fontStyle: "bold",
          color: emphasis ? "#1d1a26" : "#ffffff",
          backgroundColor: emphasis ? "#fecc33" : "#1d1a26d9",
          padding: { left: 4, right: 4, top: 2, bottom: 2 },
          resolution: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH_UI);
    }

    private buildPlayer() {
      const spawn = this.meta.spawn;
      this.playerTexture = this.textures.exists(options.playerTexture) ? options.playerTexture : CAST.player;
      this.player = this.physics.add.sprite(spawn.x * TILE + TILE / 2, spawn.y * TILE + TILE - 2, this.playerTexture, 0);
      this.player.setOrigin(0.5, 1);
      // Feet-only body: the sprite's art spans x 18..46 and its soles sit 2px above the frame bottom.
      this.player.setSize(20, 10);
      this.player.setOffset(22, 52);
      this.player.setCollideWorldBounds(true);
      this.physics.add.collider(this.player, this.colliders);
      this.player.anims.play(`${this.playerTexture}-idle-down`, true);
    }

    private slotFor(id: string, kind: "character" | "object", locationId: string) {
      const slots = kind === "character" ? this.meta.npc_slots : this.meta.object_slots;
      if (slots[id]) return slots[id];
      const room = this.meta.rooms.find((r) => r.id === locationId);
      const tile = room
        ? { x: Math.round((room.x0 + room.x1) / 2), y: Math.round((room.y0 + room.y1) / 2) }
        : { x: this.meta.spawn.x, y: this.meta.spawn.y };
      const free = nearestWalkable(buildNavGrid(this.meta.collision), tile) ?? tile;
      return free;
    }

    private buildInteractables() {
      const cast = assignCast(options.world.characters);
      for (const character of options.world.characters) {
        const slot = this.slotFor(character.id, "character", character.location_id);
        const tex = cast[character.id] ?? CAST.male[0]!;
        const face: Dir = this.meta.npc_slots[character.id]?.face ?? "down";
        const x = slot.x * TILE + TILE / 2;
        const y = slot.y * TILE + TILE - 2;
        const sprite = this.add.sprite(x, y, tex, 0).setOrigin(0.5, 1).setDepth(y);
        sprite.anims.play({ key: `${tex}-idle-${face}`, startFrame: hash(character.id) % 4 }, true);
        sprite.setInteractive({
          useHandCursor: true,
          hitArea: new Phaser.Geom.Rectangle(16, 22, 32, 42),
          hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        });
        sprite.on("pointerdown", () => {
          if (options.isLocked?.()) return;
          this.currentTarget = null;
          options.onInteractCharacter(character.id);
        });
        // Colleagues are solid at their feet so you walk around them, not through them.
        const feet = this.add.rectangle(x, y - 5, 20, 10, 0, 0);
        this.colliders.add(feet);
        const tag = this.nameTag(x, y - 44, character.name);
        this.interactables.push({
          kind: "character",
          id: character.id,
          label: character.name,
          x,
          y,
          gameObject: sprite,
          npc: sprite,
          texture: tex,
          face,
          tag,
        });
      }

      for (const object of options.world.objects) {
        const slot = this.meta.object_slots[object.id];
        // A company world without an optional object (task board, whiteboard...) just doesn't have
        // it; only the incident's required tools fall back to a marker so the scenario stays playable.
        if (options.map && !slot && !REQUIRED_OBJECTS.includes(object.id)) continue;
        let sprite: Phaser.GameObjects.Image | undefined;
        let ax: number;
        let ay: number;
        let top: number;
        let cx: number;
        if (slot) {
          sprite = this.add
            .image(slot.px, slot.py, "props", slot.frame)
            .setOrigin(0, 0)
            .setDepth(slot.mounted ? DEPTH_WALLS + 1 : slot.d);
          ax = slot.ax;
          ay = slot.ay;
          top = slot.py;
          cx = slot.px + sprite.width / 2;
        } else {
          const tile = this.slotFor(object.id, "object", object.location_id);
          ax = tile.x * TILE + TILE / 2;
          ay = tile.y * TILE + TILE / 2;
          top = ay - 16;
          cx = ax;
        }
        const indicator = this.add.image(cx, top - 6, "indicator").setOrigin(0.5, 1).setDepth(DEPTH_UI - 1);
        this.tweens.add({
          targets: indicator,
          y: top - 11,
          duration: 700,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: -1,
        });
        const target = sprite ?? indicator;
        target.setInteractive({ useHandCursor: true });
        target.on("pointerdown", () => {
          this.currentTarget = null;
          options.onInteractObject(object.id);
        });
        const tag = this.nameTag(cx, top - 16, object.label, true).setVisible(false);
        this.interactables.push({
          kind: "object",
          id: object.id,
          label: object.label,
          x: ax,
          y: ay,
          gameObject: target,
          sprite,
          frame: slot?.frame,
          tag,
        });
      }
    }

    private buildPets() {
      this.meta.pets?.forEach((pet, i) => {
        const key = CAST.pets[i % CAST.pets.length]!;
        const room = this.meta.rooms.find((r) => r.id === pet.room);
        if (!room || !this.textures.exists(key)) return;
        const x = pet.x * TILE + TILE / 2;
        const y = pet.y * TILE + TILE - 4;
        const sprite = this.add.sprite(x, y, key, 0).setOrigin(0.5, 1).setDepth(y);
        sprite.anims.play(`${key}-idle-down`);
        this.pets.push({ sprite, key, room, path: [], restUntil: this.time.now + 1500 + i * 1200 });
      });
    }

    private updatePets(delta: number) {
      for (const pet of this.pets) {
        const s = pet.sprite;
        if (pet.path.length === 0) {
          if (this.time.now < pet.restUntil) continue;
          // Wander: pick a reachable tile a few steps away inside its room.
          const from = { x: Math.floor(s.x / TILE), y: Math.floor((s.y - 2) / TILE) };
          const goal = {
            x: Phaser.Math.Between(pet.room.x0, pet.room.x1),
            y: Phaser.Math.Between(pet.room.y0, pet.room.y1),
          };
          const path = findPath(this.navGrid, from, [goal]);
          if (path && path.length > 1 && path.length < 14) {
            pet.path = toWorldPoints(smoothPath(this.navGrid, path), TILE).slice(1);
          } else {
            pet.restUntil = this.time.now + 800;
          }
          continue;
        }
        const next = pet.path[0]!;
        const tx = next.x;
        const ty = next.y + TILE / 2 - 4;
        const dx = tx - s.x;
        const dy = ty - s.y;
        const dist = Math.hypot(dx, dy);
        const step = (PET_SPEED * delta) / 1000;
        if (dist <= step) {
          s.setPosition(tx, ty);
          pet.path.shift();
          if (pet.path.length === 0) {
            pet.restUntil = this.time.now + Phaser.Math.Between(2500, 7000);
            s.anims.play(`${pet.key}-idle-down`, true);
            s.setFlipX(false);
          }
        } else {
          s.setPosition(s.x + (dx / dist) * step, s.y + (dy / dist) * step);
          const side = Math.abs(dx) > Math.abs(dy);
          s.anims.play(`${pet.key}-walk-${side ? "side" : dy < 0 ? "up" : "down"}`, true);
          s.setFlipX(side && dx < 0);
        }
        s.setDepth(s.y);
      }
    }

    private locationAt(px: number, py: number): string {
      const tx = px / TILE;
      const ty = py / TILE;
      for (const room of this.meta.rooms) {
        if (tx >= room.x0 - 0.5 && tx <= room.x1 + 1.5 && ty >= room.y0 - 0.5 && ty <= room.y1 + 1.5) {
          return room.id;
        }
      }
      return this.lastLocation;
    }

    private isTyping(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      return (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        (el as HTMLElement).isContentEditable
      );
    }

    private interact() {
      if (this.isTyping() || options.isLocked?.()) return;
      if (this.currentTarget) {
        const target = this.currentTarget;
        if (target.kind === "character") options.onVoiceCharacter(target.id);
        else if (target.kind === "guide") options.onInteractGuide?.();
        else if (target.kind === "hub") options.onOpenHub?.();
        else options.onInteractObject(target.id);
      }
    }

    private setTarget(next: Interactable | null) {
      const prev = this.currentTarget;
      if (prev?.sprite && prev.frame) prev.sprite.setFrame(prev.frame);
      if (prev?.kind === "object" || prev?.kind === "hub") prev.tag?.setVisible(prev.id === this.navTargetId);
      if (next?.sprite && next.frame) {
        // The highlight frame has a 1 art px (2 world px) ring, so shift to keep the art still.
        next.sprite.setFrame(`${next.frame}_hl`);
      }
      next?.tag?.setVisible(true);
      this.currentTarget = next;
      this.alignHighlights();
    }

    private alignHighlights() {
      for (const it of this.interactables) {
        if (!it.sprite || !it.frame) continue;
        const slot = this.meta.object_slots[it.id];
        if (!slot) continue;
        const lit = it === this.currentTarget;
        it.sprite.setPosition(slot.px - (lit ? 2 : 0), slot.py - (lit ? 2 : 0));
      }
    }

    update(_time: number, delta: number) {
      if (!this.player || !this.player.body) return;
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      const typing = this.isTyping() || (options.isLocked?.() ?? false);
      const left = !typing && (this.cursors.left.isDown || this.keys.A?.isDown === true);
      const right = !typing && (this.cursors.right.isDown || this.keys.D?.isDown === true);
      const up = !typing && (this.cursors.up.isDown || this.keys.W?.isDown === true);
      const down = !typing && (this.cursors.down.isDown || this.keys.S?.isDown === true);
      const input = new Phaser.Math.Vector2((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
      // Normalised so diagonals are no faster than straight lines.
      if (input.lengthSq() > 0) input.normalize();
      const speed = !typing && this.cursors.shift.isDown ? RUN_SPEED : WALK_SPEED;
      // Frame-rate independent ease toward the target velocity: snappy, but never a hard pop.
      const k = 1 - Math.exp(-delta / ACCEL_MS);
      this.velocity.x += (input.x * speed - this.velocity.x) * k;
      this.velocity.y += (input.y * speed - this.velocity.y) * k;
      if (input.lengthSq() === 0 && this.velocity.lengthSq() < 16) this.velocity.set(0, 0);
      body.setVelocity(this.velocity.x, this.velocity.y);

      // Facing follows the input, keeping the current facing while it's still part of a diagonal.
      if (input.lengthSq() > 0) {
        const keeps =
          (this.lastDir === "left" && input.x < 0) ||
          (this.lastDir === "right" && input.x > 0) ||
          (this.lastDir === "up" && input.y < 0) ||
          (this.lastDir === "down" && input.y > 0);
        if (!keeps) {
          this.lastDir = Math.abs(input.x) > Math.abs(input.y) ? (input.x < 0 ? "left" : "right") : input.y < 0 ? "up" : "down";
        }
      }
      // Animate from the speed actually achieved last frame (a wall stops the feet, not just the body).
      if (delta > 0) {
        const step = Phaser.Math.Distance.Between(this.lastPos.x, this.lastPos.y, this.player.x, this.player.y);
        this.achieved += ((step * 1000) / delta - this.achieved) * 0.5;
      }
      this.lastPos.set(this.player.x, this.player.y);
      const moved = this.achieved;
      if (input.lengthSq() > 0 && moved > 12) {
        this.player.anims.play(`${this.playerTexture}-walk-${this.lastDir}`, true);
        this.player.anims.timeScale = Phaser.Math.Clamp(moved / WALK_SPEED, 0.5, RUN_SPEED / WALK_SPEED);
      } else {
        this.player.anims.play(`${this.playerTexture}-idle-${this.lastDir}`, true);
        this.player.anims.timeScale = 1;
      }
      this.player.setDepth(this.player.y);

      // proximity
      let nearest: Interactable | null = null;
      let nearestDist = INTERACT_RADIUS;
      for (const it of this.interactables) {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, it.x, it.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = it;
        }
      }
      if (nearest !== this.currentTarget) {
        this.setTarget(nearest);
        options.onPrompt(nearest ? nearest.label : null);
      }
      const nearCharId = nearest && nearest.kind === "character" ? nearest.id : null;
      if (nearCharId !== this.lastNearCharacter) {
        this.lastNearCharacter = nearCharId;
        options.onNearCharacter(nearCharId);
      }
      this.updateNpcFacing();
      this.updatePets(delta);

      const loc = this.locationAt(this.player.x, this.player.y);
      if (loc !== this.lastLocation) {
        this.lastLocation = loc;
        options.onLocationChange(loc);
      }

      this.nav.update(this.player.x, this.player.y);
    }

    /** Colleagues turn to face you when you come over, and settle back when you leave. */
    private updateNpcFacing() {
      for (const it of this.interactables) {
        if (!it.npc || !it.texture) continue;
        const dx = this.player.x - it.x;
        const dy = this.player.y - it.y;
        const near = dx * dx + dy * dy < (INTERACT_RADIUS * 1.6) ** 2;
        const dir: Dir = near
          ? Math.abs(dx) > Math.abs(dy)
            ? dx < 0
              ? "left"
              : "right"
            : dy < 0
              ? "up"
              : "down"
          : (it.face ?? "down");
        const key = `${it.texture}-idle-${dir}`;
        if (it.npc.anims.currentAnim?.key !== key) it.npc.anims.play(key, true);
      }
    }

    private labelFor(target: NavigationTarget, fallback: string): string {
      return target.action_label ?? target.objective_label ?? fallback;
    }

    private resolveRouteTarget(target: NavigationTarget | null): RouteTarget | null {
      if (!target || target.target_type === "none") return null;
      if (target.target_id) {
        const kind = target.target_type === "character" ? "character" : "object";
        const it = this.interactables.find((i) => i.kind === kind && i.id === target.target_id);
        if (it) {
          return {
            id: target.target_id,
            label: it.label,
            x: it.x,
            y: it.y,
            radius: INTERACT_RADIUS,
            showLabel: false,
          };
        }
      }
      const room = target.location_id
        ? this.meta.rooms.find((r) => r.id === target.location_id)
        : undefined;
      if (room) {
        const tile = nearestWalkable(this.navGrid, {
          x: Math.round((room.x0 + room.x1) / 2),
          y: Math.round((room.y0 + room.y1) / 2),
        }) ?? { x: room.x0, y: room.y0 };
        return {
          id: target.target_id ?? room.id,
          label: this.labelFor(target, room.id),
          x: tile.x * TILE + TILE / 2,
          y: tile.y * TILE + TILE / 2,
          radius: INTERACT_RADIUS,
          showLabel: true,
        };
      }
      return null;
    }

    private applyNavigation() {
      const route = this.resolveRouteTarget(this.navTarget);
      // An object you're being routed to keeps its label up so the marker always has a name.
      this.navTargetId = route && this.navTarget?.target_type === "object" ? route.id : null;
      for (const it of this.interactables) {
        if (it.kind === "object") it.tag?.setVisible(it === this.currentTarget || it.id === this.navTargetId);
      }
      this.nav.setTarget(route);
      this.nav.setVisible(this.navVisible);
    }

    setNavigationTarget(target: NavigationTarget | null) {
      this.navTarget = target;
      this.applyNavigation();
    }

    setNavigationVisible(visible: boolean) {
      this.navVisible = visible;
      this.nav.setVisible(visible);
    }

    /** Put the player's feet on the nearest walkable tile to a tile coordinate. */
    private placePlayerAt(tile: { x: number; y: number }) {
      const free = nearestWalkable(this.navGrid, tile) ?? tile;
      const x = free.x * TILE + TILE / 2;
      const y = free.y * TILE + TILE - 2;
      this.player.setPosition(x, y);
      this.player.body?.reset(x, y);
      this.velocity.set(0, 0);
      this.lastPos.set(x, y);
      this.achieved = 0;
    }

    travelTo(locationId: string) {
      // The Hub: land in front of its screen (a room in the default office, a placed screen in company worlds).
      const hub = this.interactables.find((i) => i.kind === "hub" && i.id === locationId);
      if (hub) return this.placePlayerAt({ x: Math.floor(hub.x / TILE), y: Math.floor(hub.y / TILE) });
      const room = this.meta.rooms.find((r) => r.id === locationId);
      if (!room) return;
      this.placePlayerAt({ x: Math.round((room.x0 + room.x1) / 2), y: room.y1 });
    }

    focusCharacter(characterId: string) {
      const it = this.interactables.find((i) => i.kind === "character" && i.id === characterId);
      if (!it) return;
      this.placePlayerAt({ x: Math.floor(it.x / TILE) - 1, y: Math.floor((it.y - 2) / TILE) + 1 });
    }
  }

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#1d1a26",
    pixelArt: true,
    roundPixels: true,
    scale: {
      // The canvas matches its container 1:1 (no CSS stretching); the camera zoom does the scaling.
      mode: Phaser.Scale.RESIZE,
      width: parent.clientWidth || 1024,
      height: parent.clientHeight || 640,
    },
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [OfficeScene],
  };

  const game = new Phaser.Game(config);
  (game as unknown as { __scene: () => OfficeScene }).__scene = () =>
    game.scene.getScene("office") as OfficeScene;
  return game;
}
