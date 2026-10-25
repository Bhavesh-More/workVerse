import * as Phaser from "phaser";
import {
  findPath,
  goalTilesAround,
  smoothPath,
  toWorldPoints,
  type NavGrid,
  type WorldPoint,
} from "./pathfinding";

export type NavigationStatus = "idle" | "active" | "arrived" | "unreachable";

/** A resolved, world-space destination the learner should walk to. */
export type RouteTarget = {
  id: string;
  label: string;
  /** World-space anchor (the NPC/object/location the learner should approach). */
  x: number;
  y: number;
  /** Arrival distance, reused from the existing interaction radius. */
  radius: number;
  /** Characters and objects already render their own label; only rooms need one. */
  showLabel?: boolean;
};

// Route and marker are floor decals: above the floor and walls, under furniture and people.
const ROUTE_DEPTH = 6;
const MARKER_DEPTH = 7;
const LABEL_DEPTH = 5002;
const ROUTE_COLOR = 0x2ff5cf;
const DOT_SPACING = 22;
const TICK_MS = 90;
/** Sprite origin is (0.5, 1); the route leaves from the character's centre instead of its feet. */
const PLAYER_CENTER_OFFSET = 20;
/** Nudge the route start along the heading so it leaves the body at the travel angle. */
const ROUTE_LEAD = 8;

/**
 * Draws the navigation route in Phaser world space (so it stays aligned with the floor
 * under camera scroll/zoom) and reports arrival. It never moves the player and never
 * touches task state — it is purely a visual guide with a status callback.
 */
export class NavigationOverlay {
  private readonly scene: Phaser.Scene;
  private readonly grid: NavGrid;
  private readonly tile: number;
  private readonly onStatus: (status: NavigationStatus) => void;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly marker: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly timer: Phaser.Time.TimerEvent;

  private target: RouteTarget | null = null;
  private waypoints: WorldPoint[] = [];
  private player: WorldPoint = { x: 0, y: 0 };
  private lastTile: { x: number; y: number } = { x: -999, y: -999 };
  private status: NavigationStatus = "idle";
  private visible = true;
  private pulse = 0;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    grid: NavGrid,
    tile: number,
    onStatus: (status: NavigationStatus) => void,
  ) {
    this.scene = scene;
    this.grid = grid;
    this.tile = tile;
    this.onStatus = onStatus;
    this.graphics = scene.add.graphics().setDepth(ROUTE_DEPTH);
    this.marker = scene.add.graphics().setDepth(MARKER_DEPTH);
    this.label = scene.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#05221c",
        backgroundColor: "#2ff5cfdd",
        padding: { left: 5, right: 5, top: 2, bottom: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH)
      .setVisible(false);
    this.timer = scene.time.addEvent({
      delay: TICK_MS,
      loop: true,
      callback: () => {
        this.pulse += 1;
        this.redraw();
      },
    });
  }

  setTarget(target: RouteTarget | null): void {
    this.target = target;
    this.waypoints = [];
    this.lastTile = { x: -999, y: -999 };
    if (!target) {
      this.setStatus("idle");
    } else {
      this.setStatus("active");
    }
    this.redraw();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.redraw();
  }

  getStatus(): NavigationStatus {
    return this.status;
  }

  update(px: number, py: number): void {
    this.player = { x: px, y: py };
    if (!this.target) return;
    const tx = Math.floor(px / this.tile);
    const ty = Math.floor(py / this.tile);
    if (tx !== this.lastTile.x || ty !== this.lastTile.y) {
      this.lastTile = { x: tx, y: ty };
      this.recompute(px, py);
    }
    const distance = Phaser.Math.Distance.Between(px, py, this.target.x, this.target.y);
    if (distance <= this.target.radius) {
      this.setStatus("arrived");
    } else if (this.waypoints.length > 0) {
      this.setStatus("active");
    } else {
      this.setStatus("unreachable");
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.timer.remove();
    this.graphics.destroy();
    this.marker.destroy();
    this.label.destroy();
  }

  private setStatus(status: NavigationStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
    this.redraw();
  }

  private recompute(px: number, py: number): void {
    if (!this.target) return;
    const goals = goalTilesAround(
      this.grid,
      { x: this.target.x, y: this.target.y },
      this.tile,
      this.target.radius,
    );
    const start = { x: Math.floor(px / this.tile), y: Math.floor(py / this.tile) };
    const raw = findPath(this.grid, start, goals);
    if (!raw) {
      this.waypoints = [];
      this.setStatus("unreachable");
      return;
    }
    this.waypoints = toWorldPoints(smoothPath(this.grid, raw), this.tile);
    if (this.status !== "arrived") this.setStatus("active");
  }

  private redraw(): void {
    if (this.destroyed) return;
    const g = this.graphics;
    g.clear();
    this.marker.clear();

    const show = this.visible && this.target !== null;
    this.label.setVisible(show && this.target?.showLabel === true);
    if (!show || !this.target) return;

    const arrived = this.status === "arrived";
    this.drawMarker(this.target, arrived);

    if (arrived || this.waypoints.length === 0) return;

    const points: WorldPoint[] = [this.routeOrigin(), ...this.waypoints];
    this.stroke(g, points, 11, ROUTE_COLOR, 0.1);
    this.stroke(g, points, 4, ROUTE_COLOR, 0.55);
    this.drawDots(g, points, (this.pulse * 3) % DOT_SPACING);
  }

  /** Start the route at the character's centre, angled toward the first route point. */
  private routeOrigin(): WorldPoint {
    const center = { x: this.player.x, y: this.player.y - PLAYER_CENTER_OFFSET };
    const heading =
      this.waypoints.find(
        (p) => Phaser.Math.Distance.Between(center.x, center.y, p.x, p.y) > 2,
      ) ?? this.target;
    if (!heading) return center;
    const angle = Math.atan2(heading.y - center.y, heading.x - center.x);
    return {
      x: center.x + Math.cos(angle) * ROUTE_LEAD,
      y: center.y + Math.sin(angle) * ROUTE_LEAD,
    };
  }

  private drawMarker(target: RouteTarget, arrived: boolean): void {
    const { x, y } = target;
    const m = this.marker;
    const wobble = 1 + 0.12 * Math.sin(this.pulse * 0.6);
    m.fillStyle(ROUTE_COLOR, arrived ? 0.32 : 0.16);
    m.fillCircle(x, y, (arrived ? 20 : 14) * wobble);
    m.lineStyle(2, ROUTE_COLOR, 0.95);
    m.strokeCircle(x, y, arrived ? 22 : 16);
    m.lineStyle(2, ROUTE_COLOR, arrived ? 0.95 : 0.5);
    m.strokeCircle(x, y, arrived ? 30 : 26);

    this.label.setPosition(x, y - 30);
    this.label.setText(arrived ? `Arrived · ${target.label}` : target.label);
  }

  private stroke(
    g: Phaser.GameObjects.Graphics,
    points: WorldPoint[],
    width: number,
    color: number,
    alpha: number,
  ): void {
    if (points.length < 2) return;
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i]!.x, points[i]!.y);
    g.strokePath();
  }

  private drawDots(
    g: Phaser.GameObjects.Graphics,
    points: WorldPoint[],
    offset: number,
  ): void {
    let remaining = offset;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const length = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (length <= 0) continue;
      let position = remaining;
      while (position <= length) {
        const t = position / length;
        g.fillStyle(ROUTE_COLOR, 0.95);
        g.fillCircle(
          Phaser.Math.Linear(a.x, b.x, t),
          Phaser.Math.Linear(a.y, b.y, t),
          3,
        );
        position += DOT_SPACING;
      }
      remaining = position - length;
    }
  }
}
