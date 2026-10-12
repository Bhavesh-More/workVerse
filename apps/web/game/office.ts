import * as Phaser from "phaser";
import type { NavigationTarget, WorldView } from "../lib/types";
import {
  NavigationOverlay,
  type NavigationStatus,
  type RouteTarget,
} from "./navigation";
import { buildNavGrid, type NavGrid } from "./pathfinding";

const TILE = 32;
const HUMAN_SHEET = 32;
const CAT_FRAME = 16;
/** Existing interaction radius: also used as the navigation arrival distance. */
const INTERACT_RADIUS = 64;

export type OfficeOptions = {
  world: WorldView;
  playerTexture: string;
  onPrompt: (label: string | null) => void;
  onNearCharacter: (characterId: string | null) => void;
  onInteractCharacter: (characterId: string) => void;
  onVoiceCharacter: (characterId: string) => void;
  onInteractObject: (objectId: string) => void;
  onLocationChange: (locationId: string) => void;
  onNavigationStatus?: (status: NavigationStatus) => void;
  onReady: () => void;
  isLocked?: () => boolean;
};

type MapMeta = {
  width: number;
  height: number;
  spawn: { x: number; y: number };
  rooms: { id: string; x0: number; y0: number; x1: number; y1: number }[];
  npc_slots: Record<string, { x: number; y: number }>;
  object_slots: Record<string, { x: number; y: number }>;
  collision: number[][];
};

type Interactable = {
  kind: "character" | "object";
  id: string;
  label: string;
  x: number;
  y: number;
  gameObject: Phaser.GameObjects.GameObject & { x: number; y: number };
};

const HUMAN_DIRS: Record<string, { walkRow: number; idleRow: number }> = {
  down: { walkRow: 4, idleRow: 0 },
  left: { walkRow: 5, idleRow: 1 },
  right: { walkRow: 6, idleRow: 2 },
  up: { walkRow: 7, idleRow: 3 },
};

export function createOfficeGame(parent: HTMLElement, options: OfficeOptions): Phaser.Game {
  class OfficeScene extends Phaser.Scene {
    private meta!: MapMeta;
    private player!: Phaser.Physics.Arcade.Sprite;
    private keys!: Record<string, Phaser.Input.Keyboard.Key>;
    private interactables: Interactable[] = [];
    private foreground?: Phaser.GameObjects.Image;
    private currentTarget: Interactable | null = null;
    private lastNearCharacter: string | null = null;
    private lastLocation = "";
    private lastDir = "down";
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private playerTexture = options.playerTexture;
    private navGrid!: NavGrid;
    private nav!: NavigationOverlay;
    private navTarget: NavigationTarget | null = null;
    private navVisible = true;

    constructor() {
      super("office");
    }

    preload() {
      this.load.image("ground", "/assets/game/map/ground.png");
      this.load.image("walls", "/assets/game/map/walls.png");
      this.load.image("foreground", "/assets/game/map/foreground.png");
      this.load.json("mapmeta", "/assets/game/map/map.json");
      this.load.spritesheet("blonde_man", "/assets/game/chars/blonde_man.png", {
        frameWidth: HUMAN_SHEET,
        frameHeight: HUMAN_SHEET,
      });
      this.load.spritesheet("blue_haired_woman", "/assets/game/chars/blue_haired_woman.png", {
        frameWidth: HUMAN_SHEET,
        frameHeight: HUMAN_SHEET,
      });
      for (const cat of ["cat_brown", "cat_brown2", "cat_white"]) {
        this.load.spritesheet(cat, `/assets/game/chars/${cat}.png`, {
          frameWidth: CAT_FRAME,
          frameHeight: CAT_FRAME,
        });
      }
    }

    create() {
      this.meta = this.cache.json.get("mapmeta") as MapMeta;
      const worldW = this.meta.width * TILE;
      const worldH = this.meta.height * TILE;

      this.add.image(0, 0, "ground").setOrigin(0, 0).setDepth(0);
      this.add.image(0, 0, "walls").setOrigin(0, 0).setDepth(1);

      this.buildAnimations();
      this.buildCollision();
      this.buildInteractables();
      this.buildPlayer();

      this.navGrid = buildNavGrid(this.meta.collision);
      this.nav = new NavigationOverlay(this, this.navGrid, TILE, (status) =>
        options.onNavigationStatus?.(status),
      );
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.nav.destroy());

      this.foreground = this.add
        .image(0, 0, "foreground")
        .setOrigin(0, 0)
        .setDepth(5000);

      this.physics.world.setBounds(0, 0, worldW, worldH);
      this.cameras.main.setBounds(0, 0, worldW, worldH);
      this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
      this.cameras.main.setZoom(1.5);
      this.cameras.main.setRoundPixels(true);

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

      this.lastLocation = this.locationAt(this.player.x, this.player.y);
      options.onLocationChange(this.lastLocation);
      options.onReady();
    }

    private buildAnimations() {
      const textures = ["blonde_man", "blue_haired_woman"];
      for (const tex of textures) {
        for (const [dir, rows] of Object.entries(HUMAN_DIRS)) {
          const walkFrames = [0, 1, 2, 3].map((c) => rows.walkRow * 4 + c);
          this.anims.create({
            key: `${tex}-walk-${dir}`,
            frames: walkFrames.map((f) => ({ key: tex, frame: f })),
            frameRate: 8,
            repeat: -1,
          });
          this.anims.create({
            key: `${tex}-idle-${dir}`,
            frames: [{ key: tex, frame: rows.idleRow * 4 }],
            frameRate: 1,
          });
        }
      }
    }

    private buildCollision() {
      const group = this.physics.add.staticGroup();
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
            const rect = this.add.rectangle(
              runStart * TILE + w / 2,
              y * TILE + TILE / 2,
              w,
              TILE,
              0xff0000,
              0,
            );
            group.add(rect);
            runStart = -1;
          }
        }
      }
      this.physics.world.setBoundsCollision(true, true, true, true);
      (this as unknown as { _collisionGroup: Phaser.Physics.Arcade.StaticGroup })._collisionGroup =
        group;
    }

    private buildPlayer() {
      const spawn = this.meta.spawn;
      this.player = this.physics.add.sprite(
        spawn.x * TILE + TILE / 2,
        spawn.y * TILE + TILE,
        this.playerTexture,
        0,
      );
      this.player.setOrigin(0.5, 1);
      this.player.setDepth(10);
      this.player.setSize(14, 10);
      this.player.setOffset(9, 20);
      this.player.setCollideWorldBounds(true);
      const group = (
        this as unknown as { _collisionGroup: Phaser.Physics.Arcade.StaticGroup }
      )._collisionGroup;
      this.physics.add.collider(this.player, group);
      this.player.anims.play(`${this.playerTexture}-idle-down`, true);
    }

    private slotFor(id: string, kind: "character" | "object", locationId: string) {
      const slots = kind === "character" ? this.meta.npc_slots : this.meta.object_slots;
      if (slots[id]) return slots[id];
      const room = this.meta.rooms.find((r) => r.id === locationId);
      if (room) {
        return { x: Math.round((room.x0 + room.x1) / 2), y: Math.round((room.y0 + room.y1) / 2) };
      }
      return { x: this.meta.spawn.x, y: this.meta.spawn.y };
    }

    private buildInteractables() {
      for (const character of options.world.characters) {
        const slot = this.slotFor(character.id, "character", character.location_id);
        const tex = character.sprite;
        const isCat = tex.startsWith("cat_");
        const sprite = this.add.sprite(slot.x * TILE + TILE / 2, slot.y * TILE + TILE, tex, 0);
        sprite.setOrigin(0.5, 1);
        if (isCat) sprite.setScale(2);
        sprite.setDepth(20);
        sprite.setInteractive({ useHandCursor: true });
        sprite.on("pointerdown", () => {
          if (options.isLocked?.()) return;
          this.currentTarget = null;
          options.onInteractCharacter(character.id);
        });
        this.add
          .text(slot.x * TILE + TILE / 2, slot.y * TILE - 6, character.name, {
            fontFamily: "monospace",
            fontSize: "10px",
            color: "#222c21",
            backgroundColor: "#e7e6dbcc",
            padding: { left: 3, right: 3, top: 1, bottom: 1 },
          })
          .setOrigin(0.5, 1)
          .setDepth(21);
        this.interactables.push({
          kind: "character",
          id: character.id,
          label: character.name,
          x: sprite.x,
          y: sprite.y,
          gameObject: sprite,
        });
      }

      for (const object of options.world.objects) {
        const slot = this.slotFor(object.id, "object", object.location_id);
        const marker = this.add.rectangle(
          slot.x * TILE + TILE / 2,
          slot.y * TILE + TILE / 2,
          18,
          18,
          0x8a6d2e,
          1,
        );
        marker.setStrokeStyle(2, 0x222c21);
        marker.setDepth(15);
        marker.setInteractive({ useHandCursor: true });
        marker.on("pointerdown", () => {
          this.currentTarget = null;
          options.onInteractObject(object.id);
        });
        this.tweens.add({
          targets: marker,
          scale: { from: 0.85, to: 1.1 },
          duration: 900,
          yoyo: true,
          repeat: -1,
        });
        this.add
          .text(slot.x * TILE + TILE / 2, slot.y * TILE + 2, object.label, {
            fontFamily: "monospace",
            fontSize: "9px",
            color: "#222c21",
            backgroundColor: "#e7e6dbcc",
            padding: { left: 3, right: 3, top: 1, bottom: 1 },
          })
          .setOrigin(0.5, 1)
          .setDepth(21);
        this.interactables.push({
          kind: "object",
          id: object.id,
          label: object.label,
          x: marker.x,
          y: marker.y,
          gameObject: marker,
        });
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
        else options.onInteractObject(target.id);
      }
    }

    update() {
      if (!this.player || !this.player.body) return;
      const speed = 190;
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      const typing = this.isTyping() || (options.isLocked?.() ?? false);
      let vx = 0;
      let vy = 0;
      const left = !typing && (this.cursors.left.isDown || this.keys.A?.isDown === true);
      const right = !typing && (this.cursors.right.isDown || this.keys.D?.isDown === true);
      const up = !typing && (this.cursors.up.isDown || this.keys.W?.isDown === true);
      const down = !typing && (this.cursors.down.isDown || this.keys.S?.isDown === true);
      if (left) vx -= speed;
      if (right) vx += speed;
      if (up) vy -= speed;
      if (down) vy += speed;
      body.setVelocity(vx, vy);

      let dir = "down";
      if (vy < 0) dir = "up";
      else if (vy > 0) dir = "down";
      else if (vx < 0) dir = "left";
      else if (vx > 0) dir = "right";

      if (vx !== 0 || vy !== 0) {
        this.lastDir = dir;
        this.player.anims.play(`${this.playerTexture}-walk-${dir}`, true);
      } else {
        this.player.anims.play(`${this.playerTexture}-idle-${this.lastDir}`, true);
      }
      this.player.setDepth(10 + this.player.y / 1000);

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
        this.currentTarget = nearest;
        options.onPrompt(nearest ? nearest.label : null);
      }
      const nearCharId = nearest && nearest.kind === "character" ? nearest.id : null;
      if (nearCharId !== this.lastNearCharacter) {
        this.lastNearCharacter = nearCharId;
        options.onNearCharacter(nearCharId);
      }

      const loc = this.locationAt(this.player.x, this.player.y);
      if (loc !== this.lastLocation) {
        this.lastLocation = loc;
        options.onLocationChange(loc);
      }

      this.nav.update(this.player.x, this.player.y);
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
        return {
          id: target.target_id ?? room.id,
          label: this.labelFor(target, room.id),
          x: ((room.x0 + room.x1) / 2) * TILE + TILE / 2,
          y: ((room.y0 + room.y1) / 2) * TILE + TILE / 2,
          radius: INTERACT_RADIUS,
          showLabel: true,
        };
      }
      return null;
    }

    private applyNavigation() {
      this.nav.setTarget(this.resolveRouteTarget(this.navTarget));
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

    travelTo(locationId: string) {
      const room = this.meta.rooms.find((r) => r.id === locationId);
      if (!room) return;
      const cx = ((room.x0 + room.x1) / 2) * TILE + TILE / 2;
      const cy = (room.y1 + 1) * TILE - 4;
      this.player.setPosition(cx, cy);
      this.player.body?.reset(cx, cy);
    }

    focusCharacter(characterId: string) {
      const it = this.interactables.find((i) => i.kind === "character" && i.id === characterId);
      if (it) {
        const cx = it.x;
        const cy = it.y + TILE;
        this.player.setPosition(cx - 40, cy);
        this.player.body?.reset(cx - 40, cy);
      }
    }
  }

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: 1024,
    height: 640,
    backgroundColor: "#14140f",
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
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
