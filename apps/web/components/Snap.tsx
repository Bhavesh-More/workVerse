import type { CSSProperties } from "react";

// The office map is three stacked layers; crops below are in 2048×1408 units of the original
// 46-tile-wide map. The map grew to 56 tiles (iMocha Hub), so the width scales to keep them put.
const MAP_W = (2048 * 56) / 46;
const MAP_H = 1408;
const LAYERS = ["foreground", "walls", "ground"]
  .map((l) => `url(/assets/game/map/${l}.png)`)
  .join(", ");

export const ROOMS = {
  reception: { x: 32, y: 32, w: 480, h: 352, label: "Reception" },
  meeting: { x: 576, y: 32, w: 928, h: 352, label: "Meeting room" },
  manager: { x: 1568, y: 32, w: 448, h: 352, label: "Manager's office" },
  engineering: { x: 48, y: 560, w: 720, h: 480, label: "Engineering floor" },
  collaboration: { x: 1056, y: 544, w: 448, h: 448, label: "Collab area" },
  desks: { x: 48, y: 600, w: 720, h: 315, label: "Engineering floor" },
  break: { x: 1568, y: 544, w: 448, h: 448, label: "Break area" },
} as const;

export type RoomKey = keyof typeof ROOMS;

function cropStyle(r: { x: number; y: number; w: number; h: number }): CSSProperties {
  return {
    aspectRatio: `${r.w} / ${r.h}`,
    backgroundImage: LAYERS,
    backgroundSize: `${(MAP_W / r.w) * 100}% ${(MAP_H / r.h) * 100}%`,
    backgroundPosition: `${(r.x / (MAP_W - r.w)) * 100}% ${(r.y / (MAP_H - r.h)) * 100}%`,
  };
}

/** A polaroid of one room in the real office the learner will walk around. */
export function Snap({
  room,
  note,
  className,
  style,
}: {
  room: RoomKey;
  note?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const r = ROOMS[room];
  return (
    <figure className={`snap${className ? ` ${className}` : ""}`} style={style}>
      <RoomImage room={room} />
      <figcaption>
        <span>{r.label}</span>
        {note && <span className="muted">{note}</span>}
      </figcaption>
    </figure>
  );
}

/** Just the cropped room image, for use inside other cards. */
export function RoomImage({ room, style }: { room: RoomKey; style?: CSSProperties }) {
  const r = ROOMS[room];
  return (
    <div
      className="snap__img"
      style={{ ...cropStyle(r), ...style }}
      role="img"
      aria-label={`Pixel-art ${r.label.toLowerCase()} in the WorkVerse office`}
    />
  );
}

/** First (front-facing) frame of a 32×32 character sheet, scaled with crisp pixels. */
export function Sprite({ name, size = 96, label }: { name: string; size?: number; label: string }) {
  return (
    <span
      className="sprite"
      role="img"
      aria-label={label}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(/assets/game/chars/${name}.png)`,
        backgroundSize: `${size * 4}px ${size * 8}px`,
      }}
    />
  );
}
