"""WorkVerse office art: one palette, a few pixel primitives, and a painter per prop.

Everything here is authored at 1 art pixel = 1 image pixel on a 16px tile grid; the build scripts
export at ART_SCALE (nearest-neighbour) so the engine never scales a sprite. Conventions:

* Light comes from the top-left. Surfaces get a 1px highlight on their top/left edge, fronts are
  one step darker than tops, and outlines use the warm near-black OUT, never pure black.
* A prop painter returns (image, footprint_w, footprint_h) in tiles. The image's bottom edge is the
  bottom of its footprint; anything taller overhangs upward (monitors, shelves, plants), which is
  what lets the engine y-sort props against characters by their base.
* Wall-mounted pieces (windows, boards, screens) are painted onto the 32px wall face instead.
"""

from __future__ import annotations

import random

from PIL import Image

T = 16  # tile size in art pixels
ART_SCALE = 2  # export scale: one art pixel -> 2x2 screen-world pixels (32 world px per tile)

Color = tuple[int, int, int] | tuple[int, int, int, int]

# ---------------------------------------------------------------------------------- palette
OUT = (43, 34, 50)
OUT_SOFT = (78, 64, 82)
SHADOW = (30, 20, 44)

OAK = [(112, 74, 48), (150, 102, 64), (186, 136, 88), (214, 170, 118), (234, 200, 150)]
WALNUT = [(62, 40, 34), (88, 58, 44), (116, 80, 58), (146, 104, 74)]
BIRCH = [(176, 146, 108), (206, 180, 140), (228, 208, 172), (244, 232, 204)]
STONE = [(156, 148, 140), (186, 179, 168), (210, 204, 193), (230, 225, 215), (244, 240, 232)]
GREY = [(64, 68, 82), (96, 102, 118), (136, 142, 158), (184, 190, 202), (222, 226, 232)]
METAL = [(70, 76, 90), (108, 116, 132), (152, 160, 174), (200, 206, 216), (236, 240, 244)]
WHITE = [(196, 198, 206), (222, 224, 230), (240, 241, 245), (252, 252, 252)]

TEAL = [(26, 84, 86), (36, 120, 116), (58, 160, 148), (112, 202, 182)]
NAVY = [(32, 40, 70), (46, 60, 100), (66, 86, 136), (102, 126, 176)]
SAGE = [(74, 98, 80), (100, 130, 102), (134, 164, 124), (172, 196, 156)]
CORAL = [(140, 56, 56), (190, 84, 72), (226, 122, 96), (244, 166, 136)]
MUSTARD = [(150, 104, 34), (200, 150, 50), (234, 190, 80), (250, 220, 138)]
PLUM = [(70, 44, 74), (102, 64, 102), (138, 92, 132), (176, 132, 164)]
CHARCOAL = [(40, 40, 50), (58, 58, 70), (80, 80, 94), (108, 108, 124)]

LEAF = [(30, 70, 52), (44, 104, 64), (72, 142, 74), (120, 182, 90), (170, 214, 118)]
TERRACOTTA = [(124, 62, 46), (168, 90, 62), (204, 124, 86), (230, 160, 118)]

SCREEN = (20, 28, 42)
SCREEN_2 = (30, 42, 62)
GLOW_BLUE = (96, 196, 255)
GLOW_TEAL = (72, 236, 200)
GLOW_GREEN = (118, 226, 132)
GLOW_RED = (244, 90, 90)
GLOW_AMBER = (252, 196, 76)
SKY = [(124, 178, 222), (156, 202, 236), (194, 226, 246)]
CITY = [(92, 122, 158), (110, 142, 176)]
PAPER = [(214, 210, 198), (236, 234, 226), (250, 249, 244)]
STICKY = [(252, 214, 92), (246, 152, 156), (132, 210, 228), (164, 220, 132)]

# Paint per room: (upper paint light, upper paint, wainscot light, wainscot, wainscot dark)
WALL_PAINT = {
    "reception": [(248, 238, 220), (236, 222, 198)],
    "meeting": [(214, 228, 240), (194, 212, 228)],
    "manager": [(214, 226, 202), (192, 208, 180)],
    "corridor": [(238, 232, 222), (222, 214, 202)],
    "engineering": [(226, 230, 238), (206, 212, 224)],
    "collab": [(248, 226, 206), (236, 206, 182)],
    "break": [(248, 238, 196), (236, 222, 168)],
}
WAINSCOT = {
    "reception": OAK,
    "meeting": NAVY,
    "manager": WALNUT,
    "corridor": SAGE,
    "engineering": CHARCOAL,
    "collab": TEAL,
    "break": SAGE,
}
CAP = [(46, 40, 58), (64, 58, 78), (86, 80, 102), (110, 104, 128)]


def rgba(c: Color, a: int = 255) -> tuple[int, int, int, int]:
    return (c[0], c[1], c[2], c[3] if len(c) == 4 else a)  # type: ignore[misc]


def mix(a: Color, b: Color, t: float) -> tuple[int, int, int]:
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


# ---------------------------------------------------------------------------------- canvas
class Canvas:
    """Tiny pixel-art drawing surface; all coordinates are inclusive art pixels."""

    def __init__(self, w: int, h: int):
        self.img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.w, self.h = w, h
        self.pix = self.img.load()

    def px(self, x: int, y: int, c: Color, a: int = 255) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            if a >= 255 and len(c) == 3:
                self.pix[x, y] = rgba(c)
            else:
                alpha = (c[3] if len(c) == 4 else a) / 255  # type: ignore[misc]
                base = self.pix[x, y]
                if base[3] == 0:
                    self.pix[x, y] = (c[0], c[1], c[2], round(alpha * 255))
                else:
                    m = mix(base, c, alpha)
                    self.pix[x, y] = (m[0], m[1], m[2], max(base[3], round(alpha * 255)))

    def rect(self, x0: int, y0: int, x1: int, y1: int, c: Color, a: int = 255) -> None:
        for y in range(max(0, y0), min(self.h, y1 + 1)):
            for x in range(max(0, x0), min(self.w, x1 + 1)):
                self.px(x, y, c, a)

    def hline(self, x0: int, x1: int, y: int, c: Color, a: int = 255) -> None:
        self.rect(x0, y, x1, y, c, a)

    def vline(self, x: int, y0: int, y1: int, c: Color, a: int = 255) -> None:
        self.rect(x, y0, x, y1, c, a)

    def frame(self, x0: int, y0: int, x1: int, y1: int, c: Color = OUT, round_corners: bool = True) -> None:
        self.hline(x0 + (1 if round_corners else 0), x1 - (1 if round_corners else 0), y0, c)
        self.hline(x0 + (1 if round_corners else 0), x1 - (1 if round_corners else 0), y1, c)
        self.vline(x0, y0 + (1 if round_corners else 0), y1 - (1 if round_corners else 0), c)
        self.vline(x1, y0 + (1 if round_corners else 0), y1 - (1 if round_corners else 0), c)

    def box(
        self,
        x0: int,
        y0: int,
        x1: int,
        y1: int,
        fill: Color,
        light: Color | None = None,
        dark: Color | None = None,
        outline: Color = OUT,
    ) -> None:
        """Outlined, rounded rectangle with a top-left highlight and bottom-right shade."""
        self.rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, fill)
        if light:
            self.hline(x0 + 1, x1 - 1, y0 + 1, light)
            self.vline(x0 + 1, y0 + 1, y1 - 1, light)
        if dark:
            self.hline(x0 + 1, x1 - 1, y1 - 1, dark)
        self.frame(x0, y0, x1, y1, outline)

    def block(
        self,
        x0: int,
        y0: int,
        x1: int,
        y_split: int,
        y1: int,
        top: list[Color],
        front: list[Color],
    ) -> None:
        """A 3/4-view solid: top surface from y0..y_split-1, front face from y_split..y1.

        `top`/`front` are [dark, mid, light] ramps."""
        self.rect(x0 + 1, y0 + 1, x1 - 1, y_split - 1, top[1])
        self.hline(x0 + 1, x1 - 1, y0 + 1, top[2])
        self.hline(x0 + 1, x1 - 1, y_split - 1, top[0])
        self.rect(x0 + 1, y_split, x1 - 1, y1 - 1, front[1])
        self.hline(x0 + 1, x1 - 1, y_split, front[2])
        self.hline(x0 + 1, x1 - 1, y1 - 1, front[0])
        self.frame(x0, y0, x1, y1)
        self.hline(x0 + 1, x1 - 1, y_split - 1 if y_split - 1 > y0 else y_split, top[0])

    def paste(self, other: "Canvas | Image.Image", x: int, y: int) -> None:
        src = other.img if isinstance(other, Canvas) else other
        self.img.alpha_composite(src, (x, y))
        self.pix = self.img.load()

    def text(self, s: str, x: int, y: int, c: Color) -> int:
        """Draw with the 3x5 pixel font; returns the x after the last glyph."""
        for ch in s.upper():
            glyph = FONT.get(ch)
            if glyph is None:
                x += 2
                continue
            for gy, row in enumerate(glyph):
                for gx, bit in enumerate(row):
                    if bit == "#":
                        self.px(x + gx, y + gy, c)
            x += len(glyph[0]) + 1
        return x


FONT: dict[str, list[str]] = {
    "A": [".#.", "#.#", "###", "#.#", "#.#"],
    "B": ["##.", "#.#", "##.", "#.#", "##."],
    "C": [".##", "#..", "#..", "#..", ".##"],
    "D": ["##.", "#.#", "#.#", "#.#", "##."],
    "E": ["###", "#..", "##.", "#..", "###"],
    "F": ["###", "#..", "##.", "#..", "#.."],
    "G": [".##", "#..", "#.#", "#.#", ".##"],
    "H": ["#.#", "#.#", "###", "#.#", "#.#"],
    "I": ["#", "#", "#", "#", "#"],
    "K": ["#.#", "#.#", "##.", "#.#", "#.#"],
    "L": ["#..", "#..", "#..", "#..", "###"],
    "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
    "N": ["#..#", "##.#", "#.##", "#..#", "#..#"],
    "O": [".#.", "#.#", "#.#", "#.#", ".#."],
    "P": ["##.", "#.#", "##.", "#..", "#.."],
    "Q": [".#.", "#.#", "#.#", "#.#", ".##"],
    "R": ["##.", "#.#", "##.", "#.#", "#.#"],
    "S": [".##", "#..", ".#.", "..#", "##."],
    "T": ["###", ".#.", ".#.", ".#.", ".#."],
    "U": ["#.#", "#.#", "#.#", "#.#", "###"],
    "V": ["#.#", "#.#", "#.#", "#.#", ".#."],
    "W": ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
    "Y": ["#.#", "#.#", ".#.", ".#.", ".#."],
    "0": ["###", "#.#", "#.#", "#.#", "###"],
    "1": [".#", "##", ".#", ".#", ".#"],
    "2": ["##.", "..#", ".#.", "#..", "###"],
    "4": ["#.#", "#.#", "###", "..#", "..#"],
    "5": ["###", "#..", "##.", "..#", "##."],
    "!": ["#", "#", "#", ".", "#"],
    "%": ["#.#", "..#", ".#.", "#..", "#.#"],
    ":": [".", "#", ".", "#", "."],
    "-": ["...", "...", "###", "...", "..."],
}


# ---------------------------------------------------------------------------------- floors
def floor_tile(kind: str, tx: int, ty: int) -> Canvas:
    """One 16x16 floor tile. Variation is seeded by position so the map is deterministic."""
    rng = random.Random(f"{kind}:{tx}:{ty}")
    c = Canvas(T, T)
    if kind == "oak":
        # Planks run horizontally, 4px tall, staggered joints; grain flecks for life.
        base = [OAK[2], OAK[3], mix(OAK[2], OAK[3], 0.5)]
        for row in range(4):
            y0 = row * 4
            shade = base[(ty * 4 + row + tx // 3) % 3]
            c.rect(0, y0, 15, y0 + 3, shade)
            c.hline(0, 15, y0, mix(shade, OAK[4], 0.35))
            c.hline(0, 15, y0 + 3, mix(shade, OAK[1], 0.45))
            joint = (row * 7 + ty * 5 + tx * 16) % 32
            if joint < 16:
                c.vline(joint, y0, y0 + 3, mix(shade, OAK[1], 0.55))
            for _ in range(2):
                gx = rng.randrange(16)
                c.hline(gx, min(15, gx + rng.randrange(1, 4)), y0 + 1 + rng.randrange(2), mix(shade, OAK[1], 0.25))
    elif kind == "walnut":
        # Herringbone-ish parquet: 8x4 blocks alternating direction.
        for by in range(2):
            for bx in range(2):
                horiz = (bx + by + tx + ty) % 2 == 0
                x0, y0 = bx * 8, by * 8
                for i in range(2):
                    shade = WALNUT[2] if (i + bx) % 2 else mix(WALNUT[2], WALNUT[3], 0.3)
                    if horiz:
                        c.rect(x0, y0 + i * 4, x0 + 7, y0 + i * 4 + 3, shade)
                        c.hline(x0, x0 + 7, y0 + i * 4, mix(shade, WALNUT[3], 0.35))
                        c.hline(x0, x0 + 7, y0 + i * 4 + 3, mix(shade, WALNUT[1], 0.6))
                    else:
                        c.rect(x0 + i * 4, y0, x0 + i * 4 + 3, y0 + 7, shade)
                        c.vline(x0 + i * 4, y0, y0 + 7, mix(shade, WALNUT[3], 0.35))
                        c.vline(x0 + i * 4 + 3, y0, y0 + 7, mix(shade, WALNUT[1], 0.6))
    elif kind == "stone":
        # Large-format light stone: 16px slabs, offset every other row, faint veining.
        tone = STONE[3] if (tx + ty) % 2 == 0 else mix(STONE[3], STONE[2], 0.35)
        c.rect(0, 0, 15, 15, tone)
        c.hline(0, 15, 0, mix(tone, STONE[4], 0.6))
        c.vline(0, 0, 15, mix(tone, STONE[4], 0.4))
        c.hline(0, 15, 15, STONE[1])
        c.vline(15, 0, 15, mix(tone, STONE[1], 0.6))
        for _ in range(3):
            c.px(rng.randrange(1, 15), rng.randrange(1, 15), STONE[2])
        if rng.random() < 0.3:
            vx, vy = rng.randrange(2, 12), rng.randrange(2, 12)
            for i in range(4):
                c.px(vx + i, vy + (i // 2), mix(tone, STONE[1], 0.35))
    elif kind == "carpet":
        # Modular carpet tiles in slate, every other tile rotated (darker), soft speckle.
        tone = mix(NAVY[1], GREY[1], 0.55) if (tx + ty) % 2 == 0 else mix(NAVY[1], GREY[1], 0.4)
        c.rect(0, 0, 15, 15, tone)
        for y in range(16):
            for x in range(16):
                if (x * 7 + y * 13 + tx * 3 + ty * 5) % 11 == 0:
                    c.px(x, y, mix(tone, GREY[3], 0.18))
                elif (x * 5 + y * 3 + tx + ty) % 17 == 0:
                    c.px(x, y, mix(tone, OUT, 0.18))
        c.hline(0, 15, 15, mix(tone, OUT, 0.18))
        c.vline(15, 0, 15, mix(tone, OUT, 0.12))
    elif kind == "checker":
        # Kitchen: small 8px ceramic tiles, cream + sage, with grout.
        for by in range(2):
            for bx in range(2):
                light = (bx + by) % 2 == 0
                tone = (240, 234, 218) if light else mix(SAGE[3], (240, 234, 218), 0.35)
                c.rect(bx * 8, by * 8, bx * 8 + 7, by * 8 + 7, tone)
                c.hline(bx * 8, bx * 8 + 6, by * 8, mix(tone, (255, 255, 255), 0.5))
                c.hline(bx * 8, bx * 8 + 7, by * 8 + 7, mix(tone, STONE[1], 0.5))
                c.vline(bx * 8 + 7, by * 8, by * 8 + 7, mix(tone, STONE[1], 0.5))
    elif kind == "concrete":
        # Corridor: warm polished concrete in 16px slabs with a soft sheen.
        tone = mix(STONE[2], STONE[1], 0.25 + 0.1 * ((tx * 7 + ty * 3) % 3))
        c.rect(0, 0, 15, 15, tone)
        for _ in range(5):
            c.px(rng.randrange(16), rng.randrange(16), mix(tone, STONE[0], 0.4))
        for _ in range(3):
            c.px(rng.randrange(16), rng.randrange(16), mix(tone, STONE[4], 0.5))
        c.hline(0, 15, 15, mix(tone, STONE[0], 0.45))
        c.vline(15, 0, 15, mix(tone, STONE[0], 0.3))
    else:
        raise ValueError(kind)
    return c


def rug(w: int, h: int, scheme: str) -> Canvas:
    """A rug sized in art pixels, with a border, inner field and a woven motif."""
    palettes = {
        "navy": (NAVY, MUSTARD),
        "sage": (SAGE, CORAL),
        "terracotta": (TERRACOTTA, BIRCH),
        "teal": (TEAL, PAPER),
        "plum": (PLUM, MUSTARD),
    }
    ramp, accent = palettes[scheme]
    c = Canvas(w, h)
    c.rect(1, 1, w - 2, h - 2, ramp[1])
    c.frame(0, 0, w - 1, h - 1, ramp[0])
    c.frame(2, 2, w - 3, h - 3, ramp[2], round_corners=False)
    c.frame(3, 3, w - 4, h - 4, accent[2], round_corners=False)
    for y in range(6, h - 6):
        for x in range(6, w - 6):
            if (x + y) % 6 == 0 or (x - y) % 6 == 0:
                c.px(x, y, ramp[2])
    # fringe on short ends
    for x in range(2, w - 2, 2):
        c.px(x, 0, accent[1])
        c.px(x, h - 1, accent[1])
    return c


# ---------------------------------------------------------------------------------- walls
def wall_face(room: str, width_tiles: int, seed: int = 0) -> Canvas:
    """The 32px-tall visible face of a north wall: paint, dado rail, wainscot, baseboard."""
    w = width_tiles * T
    paint_l, paint = WALL_PAINT[room]
    wain = WAINSCOT[room]
    c = Canvas(w, 2 * T)
    c.rect(0, 0, w - 1, 19, paint)
    c.hline(0, w - 1, 0, OUT)
    c.hline(0, w - 1, 1, mix(paint, OUT, 0.35))  # cap overhang shadow
    c.hline(0, w - 1, 2, mix(paint, OUT, 0.12))
    c.hline(0, w - 1, 3, paint_l)
    # dado rail
    c.hline(0, w - 1, 19, mix(wain[-1], (255, 255, 255), 0.25))
    c.hline(0, w - 1, 20, wain[-1] if len(wain) > 3 else wain[2])
    # wainscot panels
    c.rect(0, 21, w - 1, 29, wain[1])
    for px0 in range(0, w, 16):
        c.rect(px0 + 2, 23, px0 + 13, 27, mix(wain[1], wain[2], 0.45))
        c.hline(px0 + 2, px0 + 13, 23, wain[2])
        c.hline(px0 + 2, px0 + 13, 27, wain[0])
    c.hline(0, w - 1, 21, wain[0])
    # baseboard
    c.hline(0, w - 1, 30, mix(wain[0], OUT, 0.4))
    c.hline(0, w - 1, 31, OUT)
    return c


def window_on_wall(c: Canvas, x: int, w: int, seed: int = 0) -> None:
    """A window set into a wall face (x in art px, w in art px); sky, skyline, mullions."""
    rng = random.Random(seed)
    y0, y1 = 4, 17
    c.rect(x, y0, x + w - 1, y1, OUT)
    for yy in range(y0 + 1, y1):
        t = (yy - y0) / (y1 - y0)
        col = SKY[2] if t < 0.3 else SKY[1] if t < 0.65 else SKY[0]
        c.hline(x + 1, x + w - 2, yy, col)
    # skyline silhouette
    bx = x + 1
    while bx < x + w - 1:
        bw = rng.randrange(3, 6)
        bh = rng.randrange(3, 8)
        col = CITY[rng.randrange(2)]
        c.rect(bx, y1 - bh, min(bx + bw - 1, x + w - 2), y1 - 1, col)
        for wy in range(y1 - bh + 1, y1 - 1, 2):
            for wx in range(bx + 1, min(bx + bw - 1, x + w - 2), 2):
                if rng.random() < 0.35:
                    c.px(wx, wy, (210, 230, 246))
        bx += bw
    # glare + mullion + sill
    c.px(x + 2, y0 + 2, (255, 255, 255))
    c.px(x + 3, y0 + 2, (240, 248, 255))
    c.px(x + 2, y0 + 3, (240, 248, 255))
    c.vline(x + w // 2, y0 + 1, y1 - 1, WHITE[2])
    c.hline(x - 1, x + w, y1 + 1, WHITE[2])
    c.hline(x - 1, x + w, y1 + 2, GREY[2])


def frame_art(c: Canvas, x: int, y: int, w: int, h: int, scheme: int) -> None:
    """Framed abstract print on a wall."""
    c.box(x, y, x + w - 1, y + h - 1, PAPER[2], None, None, OUT)
    c.rect(x + 1, y + 1, x + w - 2, y + h - 2, WALNUT[2])
    c.rect(x + 2, y + 2, x + w - 3, y + h - 3, PAPER[2])
    palettes = [(CORAL, MUSTARD), (TEAL, SAGE), (NAVY, CORAL), (PLUM, MUSTARD)]
    a, b = palettes[scheme % len(palettes)]
    cx, cy = x + w // 2, y + h // 2
    c.rect(x + 3, cy, x + w - 4, y + h - 4, a[2])
    c.rect(cx - 1, y + 3, cx + 1, cy, b[2])
    c.px(cx - 2, cy - 1, b[1])


def clock(c: Canvas, x: int, y: int) -> None:
    c.rect(x + 1, y, x + 5, y + 6, OUT)
    c.rect(x, y + 1, x + 6, y + 5, OUT)
    c.rect(x + 1, y + 1, x + 5, y + 5, WHITE[3])
    c.px(x + 3, y + 2, OUT)
    c.px(x + 3, y + 3, OUT)
    c.px(x + 4, y + 3, CORAL[2])


def door_frame(c: Canvas, x: int, w: int) -> None:
    """Trim around a doorway cut through a wall face (x, w in art px of the opening)."""
    for side in (x - 2, x + w):
        c.rect(side, 2, side + 1, 31, WHITE[1])
        c.vline(side, 2, 31, OUT)
        c.vline(side + 1, 2, 31, WHITE[2])
    c.rect(x - 2, 2, x + w + 1, 3, WHITE[1])
    c.hline(x - 2, x + w + 1, 2, OUT)


def wall_cap(neighbors: dict[str, bool]) -> Canvas:
    """16x16 top-of-wall tile. `neighbors[d]` is True when that side is also wall."""
    c = Canvas(T, T)
    c.rect(0, 0, 15, 15, CAP[1])
    # a subtle inset band suggests the wall's thickness
    for y in range(16):
        for x in range(16):
            if (x + y * 3) % 9 == 0:
                c.px(x, y, mix(CAP[1], CAP[2], 0.45))
    if not neighbors["n"]:
        c.hline(0, 15, 0, OUT)
        c.hline(0, 15, 1, CAP[3])
    if not neighbors["w"]:
        c.vline(0, 0, 15, OUT)
        c.vline(1, 0, 15, CAP[3])
    if not neighbors["e"]:
        c.vline(15, 0, 15, OUT)
        c.vline(14, 0, 15, CAP[0])
    if not neighbors["s"]:
        c.hline(0, 15, 15, OUT)
        c.hline(0, 15, 14, CAP[0])
    return c


# ---------------------------------------------------------------------------------- props
Prop = tuple[Canvas, int, int]


def _monitor(c: Canvas, x: int, y: int, w: int = 12, screen: str = "code", back: bool = False) -> None:
    """Monitor whose top-left is (x, y); 9px tall incl. stand."""
    h = 7
    if back:
        c.box(x, y, x + w - 1, y + h - 1, CHARCOAL[2], CHARCOAL[3], CHARCOAL[1])
        c.px(x + w // 2, y + 3, GLOW_GREEN)
    else:
        c.box(x, y, x + w - 1, y + h - 1, CHARCOAL[1])
        c.rect(x + 1, y + 1, x + w - 2, y + h - 2, SCREEN)
        _screen_content(c, x + 1, y + 1, w - 2, h - 2, screen)
    c.rect(x + w // 2 - 1, y + h, x + w // 2, y + h + 1, CHARCOAL[1])
    c.hline(x + w // 2 - 2, x + w // 2 + 1, y + h + 1, OUT)


def _screen_content(c: Canvas, x: int, y: int, w: int, h: int, kind: str) -> None:
    rng = random.Random(f"{kind}{x}{y}")
    if kind == "code":
        for row in range(h):
            indent = rng.randrange(0, 3)
            length = rng.randrange(2, max(3, w - indent))
            col = [GLOW_BLUE, mix(GLOW_TEAL, SCREEN, 0.25), (150, 160, 190)][rng.randrange(3)]
            if row % 2 == 0:
                c.hline(x + indent, min(x + w - 1, x + indent + length), y + row, col)
    elif kind == "logs":
        for row in range(h):
            col = GLOW_RED if rng.random() < 0.35 else GLOW_GREEN
            c.hline(x, x + rng.randrange(w // 2, w), y + row, col)
    elif kind == "graph":
        c.hline(x, x + w - 1, y + h - 1, SCREEN_2)
        prev = y + h - 2
        for i in range(w):
            t = i / max(1, w - 1)
            val = y + h - 2 - int((h - 2) * (t ** 2.2))
            col = GLOW_RED if t > 0.7 else GLOW_AMBER if t > 0.45 else GLOW_TEAL
            for yy in range(min(prev, val), max(prev, val) + 1):
                c.px(x + i, yy, col)
            prev = val
    elif kind == "pipeline":
        steps = max(2, w // 4)
        for i in range(steps):
            cx = x + 1 + i * (w - 2) // max(1, steps - 1)
            col = GLOW_GREEN if i < steps - 1 else GLOW_RED
            c.rect(cx - 1, y + h // 2 - 1, cx, y + h // 2, col)
            if i < steps - 1:
                c.hline(cx + 1, cx + (w - 2) // max(1, steps - 1) - 2, y + h // 2, SCREEN_2)
        c.hline(x, x + w - 1, y, GLOW_BLUE)
    elif kind == "dash":
        c.rect(x, y, x + w - 1, y, GLOW_RED)
    elif kind == "slides":
        c.rect(x, y, x + w - 1, y + h - 1, (238, 240, 246))
        c.rect(x + 1, y + 1, x + w // 2, y + 1, NAVY[2])
        c.rect(x + 1, y + 3, x + w - 2, y + h - 2, SKY[1])


def desk(screen: str = "code", facing: str = "s", items: int = 0, wood: list[Color] = BIRCH) -> Prop:
    """2x1 workstation. facing='s': the seat is south, we see the screen; 'n': we see the back."""
    c = Canvas(32, 26)
    top = [wood[0], wood[1], wood[2]]
    front = [mix(wood[0], OUT, 0.25), wood[0], mix(wood[0], wood[1], 0.5)]
    # legs
    c.rect(2, 22, 3, 25, OUT)
    c.rect(28, 22, 29, 25, OUT)
    c.block(0, 10, 31, 20, 23, top, front)
    # top highlight edge
    c.hline(1, 30, 11, wood[3] if len(wood) > 3 else wood[2])
    rng = random.Random(f"desk{screen}{facing}{items}")
    if facing == "s":
        _monitor(c, 4, 2, 12, screen)
        _monitor(c, 16, 2, 12, "code")
        # keyboard + mouse
        c.rect(8, 15, 19, 17, WHITE[1])
        c.hline(8, 19, 15, WHITE[3])
        c.frame(7, 14, 20, 18, OUT_SOFT, round_corners=True)
        c.rect(23, 16, 24, 17, WHITE[2])
        c.px(23, 15, OUT_SOFT)
        if items % 2 == 0:  # mug
            c.rect(26, 12, 28, 15, CORAL[2])
            c.px(29, 13, CORAL[2])
            c.hline(26, 28, 12, CORAL[3])
        else:  # papers
            c.rect(1 + 1, 13, 5, 17, PAPER[2])
            c.hline(2, 4, 14, GREY[2])
            c.hline(2, 4, 16, GREY[2])
    else:
        _monitor(c, 4, 9, 12, back=True)
        _monitor(c, 16, 9, 12, back=True)
        c.rect(26, 13, 28, 16, TEAL[2]) if items % 2 == 0 else c.rect(2, 13, 6, 16, PAPER[2])
    _ = rng
    return c, 2, 1


def chair(facing: str = "n", color: list[Color] = CHARCOAL) -> Prop:
    """Office chair. facing='n': sitter faces north (we see the back), 's': we see the seat."""
    c = Canvas(16, 20)
    # base + wheels
    c.hline(4, 11, 19, OUT)
    c.px(3, 18, OUT)
    c.px(12, 18, OUT)
    c.hline(4, 11, 18, CHARCOAL[1])
    c.rect(7, 15, 8, 17, CHARCOAL[0])
    if facing == "n":
        c.box(3, 10, 12, 15, color[1], color[2], color[0])  # seat peeking out
        c.box(2, 1, 13, 12, color[2], color[3], color[1])  # backrest
        c.hline(4, 11, 3, color[3])
    elif facing == "s":
        c.box(3, 3, 12, 8, color[1], color[2], color[0])  # backrest behind
        c.box(2, 8, 13, 15, color[2], color[3], color[1])  # seat
        c.rect(1, 9, 2, 13, OUT)  # arms
        c.rect(13, 9, 14, 13, OUT)
    else:  # side view, facing e or w
        flip = facing == "w"
        c.box(3, 10, 12, 15, color[2], color[3], color[1])
        bx = 11 if not flip else 2
        c.box(bx, 2, bx + 3, 13, color[1], color[2], color[0])
    return c, 1, 1


def plant(kind: str = "tall", seed: int = 0) -> Prop:
    rng = random.Random(f"plant{kind}{seed}")
    if kind == "tall":
        c = Canvas(16, 32)
        # pot
        c.rect(4, 24, 11, 31, TERRACOTTA[2])
        c.rect(3, 23, 12, 25, TERRACOTTA[3])
        c.frame(3, 23, 12, 25, OUT, round_corners=False)
        c.vline(4, 26, 30, TERRACOTTA[3])
        c.vline(11, 26, 30, TERRACOTTA[1])
        c.hline(5, 10, 31, OUT)
        c.vline(4, 26, 30, OUT)
        c.vline(11, 26, 30, OUT)
        c.rect(5, 26, 10, 30, TERRACOTTA[2])
        c.vline(5, 26, 30, TERRACOTTA[3])
        c.hline(4, 11, 23, OUT)
        # monstera-ish leaves
        blobs = [(8, 6, 5), (4, 11, 4), (12, 11, 4), (6, 16, 4), (11, 17, 4), (8, 12, 4)]
        for bx, by, r in blobs:
            for y in range(by - r, by + r + 1):
                for x in range(bx - r, bx + r + 1):
                    if (x - bx) ** 2 + (y - by) ** 2 <= r * r:
                        c.px(x, y, OUT)
        for bx, by, r in blobs:
            for y in range(by - r + 1, by + r):
                for x in range(bx - r + 1, bx + r):
                    d = (x - bx) ** 2 + (y - by) ** 2
                    if d <= (r - 1) ** 2:
                        tone = LEAF[3] if (x - bx) + (y - by) < -1 else LEAF[2] if d < (r - 2) ** 2 else LEAF[1]
                        c.px(x, y, tone)
        for _ in range(5):
            c.px(rng.randrange(3, 13), rng.randrange(3, 20), LEAF[4])
        c.vline(8, 18, 22, LEAF[0])
        return c, 1, 1
    if kind == "small":
        c = Canvas(16, 18)
        c.box(4, 10, 11, 17, WHITE[2], WHITE[3], WHITE[0])
        for bx, by, r in [(8, 6, 4), (5, 8, 3), (11, 8, 3)]:
            for y in range(by - r, by + r + 1):
                for x in range(bx - r, bx + r + 1):
                    d = (x - bx) ** 2 + (y - by) ** 2
                    if d <= r * r:
                        c.px(x, y, OUT if d > (r - 1) ** 2 else LEAF[3] if x < bx else LEAF[2])
        c.hline(4, 11, 10, OUT)
        return c, 1, 1
    # cactus/snake plant on a stand
    c = Canvas(16, 24)
    c.box(4, 16, 11, 23, CHARCOAL[2], CHARCOAL[3], CHARCOAL[0])
    for i, (lx, top) in enumerate([(5, 4), (7, 1), (9, 3), (11, 6)]):
        c.rect(lx, top, lx + 1, 16, OUT)
        c.vline(lx, top + 1, 15, LEAF[2 + i % 2])
        c.vline(lx + 1, top + 1, 15, LEAF[1])
        c.px(lx, top + 4, LEAF[4])
    return c, 1, 1


def bookshelf(width_tiles: int = 2, seed: int = 0, binders: bool = False) -> Prop:
    w = width_tiles * T
    c = Canvas(w, 34)
    c.box(0, 0, w - 1, 33, WALNUT[2], WALNUT[3], WALNUT[0])
    rng = random.Random(f"shelf{seed}{width_tiles}")
    for sy in (2, 12, 22):
        c.rect(2, sy, w - 3, sy + 8, WALNUT[0])
        c.hline(2, w - 3, sy + 9, WALNUT[3])
        x = 3
        while x < w - 3:
            bw = rng.choice([1, 2, 2, 3])
            bh = rng.randrange(5, 9)
            if binders:
                col = [CORAL, NAVY, MUSTARD, TEAL][rng.randrange(4)] if sy != 12 else [CORAL, CORAL, NAVY][rng.randrange(3)]
                bw, bh = 2, 8
            else:
                col = [CORAL, NAVY, MUSTARD, TEAL, SAGE, PLUM, PAPER][rng.randrange(7)]
            if rng.random() < 0.12 and not binders:
                x += 2
                continue
            bx1 = min(w - 4, x + bw - 1)
            c.rect(x, sy + 9 - bh, bx1, sy + 8, col[2] if len(col) > 2 else col[1])
            c.vline(x, sy + 9 - bh, sy + 8, col[1])
            if binders:
                c.px(x + 1 if bx1 > x else x, sy + 3, WHITE[3])
            x = bx1 + 1
    c.rect(1, 31, w - 2, 32, WALNUT[1])
    return c, width_tiles, 1


def sofa(width_tiles: int = 3, color: list[Color] = TEAL, facing: str = "s") -> Prop:
    w = width_tiles * T
    if facing == "s":
        c = Canvas(w, 26)
        c.box(0, 2, w - 1, 15, color[1], color[2], color[0])  # backrest
        c.box(0, 12, w - 1, 25, color[2], color[3], color[0])  # seat block
        for i in range(1, width_tiles):  # cushion seams
            c.vline(i * T, 13, 20, color[1])
        c.box(0, 8, 4, 25, color[1], color[2], color[0])  # arms
        c.box(w - 5, 8, w - 1, 25, color[1], color[2], color[0])
        c.hline(2, w - 3, 24, color[0])
        return c, width_tiles, 1
    # facing n: we see the back of the sofa
    c = Canvas(w, 22)
    c.box(0, 6, w - 1, 21, color[1], color[2], color[0])  # back panel
    c.box(0, 2, w - 1, 10, color[2], color[3], color[1])  # top roll of the backrest
    for i in range(1, width_tiles):
        c.vline(i * T, 3, 8, color[1])
    c.box(0, 4, 4, 21, color[1], color[2], color[0])
    c.box(w - 5, 4, w - 1, 21, color[1], color[2], color[0])
    c.hline(5, w - 6, 20, color[0])
    c.rect(6, 13, w - 7, 13, color[0])
    return c, width_tiles, 1


def armchair(color: list[Color] = MUSTARD, facing: str = "s") -> Prop:
    c = Canvas(16, 20)
    if facing == "n":  # seen from behind: the backrest is nearest us
        c.box(0, 5, 3, 16, color[1], color[2], color[0])
        c.box(12, 5, 15, 16, color[1], color[2], color[0])
        c.box(1, 3, 14, 19, color[1], color[2], color[0])
        c.box(1, 3, 14, 8, color[2], color[3], color[1])
        return c, 1, 1
    c.box(1, 2, 14, 12, color[1], color[2], color[0])
    c.box(1, 9, 14, 19, color[2], color[3], color[0])
    c.box(0, 7, 3, 19, color[1], color[2], color[0])
    c.box(12, 7, 15, 19, color[1], color[2], color[0])
    return c, 1, 1


def low_table(width_tiles: int = 2, wood: list[Color] = OAK, items: str = "magazines") -> Prop:
    w = width_tiles * T
    c = Canvas(w, 14)
    c.rect(2, 10, 3, 13, OUT)
    c.rect(w - 4, 10, w - 3, 13, OUT)
    c.block(0, 1, w - 1, 9, 12, [wood[1], wood[2], wood[3]], [wood[0], wood[1], wood[2]])
    if items == "magazines":
        c.rect(5, 3, 10, 6, CORAL[2])
        c.rect(7, 4, 12, 7, PAPER[2])
        c.rect(w - 9, 3, w - 6, 6, MUSTARD[2])
    elif items == "coffee":
        c.rect(5, 3, 7, 6, WHITE[3])
        c.rect(w - 9, 3, w - 7, 6, WHITE[3])
        c.px(6, 3, WALNUT[1])
        c.px(w - 8, 3, WALNUT[1])
    return c, width_tiles, 1


def round_table(wood: list[Color] = BIRCH, items: bool = True) -> Prop:
    c = Canvas(16, 18)
    c.rect(7, 11, 8, 16, OUT)
    c.hline(4, 11, 17, OUT)
    for y in range(2, 12):
        for x in range(1, 15):
            dx, dy = (x - 7.5) / 7, (y - 6.5) / 5
            d = dx * dx + dy * dy
            if d <= 1.0:
                c.px(x, y, OUT if d > 0.72 else wood[3] if dy < -0.3 else wood[2])
    c.hline(4, 11, 11, wood[0])
    if items:
        c.rect(5, 5, 6, 7, WHITE[3])
        c.px(5, 5, CORAL[2])
        c.rect(9, 6, 10, 7, GLOW_AMBER)
    return c, 1, 1


def stool(color: list[Color] = CORAL) -> Prop:
    c = Canvas(16, 14)
    c.rect(4, 7, 4, 13, OUT)
    c.rect(11, 7, 11, 13, OUT)
    c.hline(5, 10, 10, METAL[1])
    c.box(3, 2, 12, 8, color[2], color[3], color[0])
    return c, 1, 1


def long_table(width_tiles: int = 6, height_tiles: int = 2, wood: list[Color] = OAK) -> Prop:
    w, h = width_tiles * T, height_tiles * T
    c = Canvas(w, h)
    c.rect(3, h - 5, 4, h - 1, OUT)
    c.rect(w - 5, h - 5, w - 4, h - 1, OUT)
    c.block(0, 2, w - 1, h - 7, h - 3, [wood[1], wood[2], wood[3]], [wood[0], wood[1], wood[2]])
    c.hline(2, w - 3, 3, mix(wood[3], (255, 255, 255), 0.2))
    # felt runner down the middle
    c.rect(T // 2, h // 2 - 6, w - T // 2 - 1, h // 2 - 3, NAVY[2])
    c.hline(T // 2, w - T // 2 - 1, h // 2 - 6, NAVY[3])
    rng = random.Random(f"lt{width_tiles}")
    # laptops, notepads and cups down the table
    for i in range(1, width_tiles):
        x = i * T - 5
        if rng.random() < 0.6:
            c.rect(x, 6, x + 7, 10, GREY[3])
            c.rect(x + 1, 5, x + 6, 6, GREY[1])
            c.hline(x, x + 7, 10, GREY[1])
        else:
            c.rect(x + 1, 7, x + 5, 11, PAPER[2])
            c.hline(x + 2, x + 4, 8, GREY[2])
    return c, width_tiles, height_tiles


def counter(kind: str = "plain", wood: list[Color] = SAGE) -> Prop:
    """1-tile kitchen base cabinet with a stone top; kind 'sink' or 'plain'."""
    c = Canvas(16, 22)
    c.block(0, 2, 15, 8, 21, [STONE[1], STONE[3], STONE[4]], [wood[0], wood[1], wood[2]])
    c.vline(7, 10, 19, wood[0])
    c.vline(8, 10, 19, wood[2])
    c.px(5, 14, METAL[3])
    c.px(10, 14, METAL[3])
    if kind == "sink":
        c.rect(3, 3, 12, 6, METAL[2])
        c.frame(3, 3, 12, 6, METAL[1], round_corners=False)
        c.rect(7, 0, 8, 3, METAL[3])
        c.px(9, 0, METAL[3])
    elif kind == "fruit":
        c.rect(3, 3, 10, 6, WALNUT[2])
        c.px(4, 3, CORAL[2])
        c.px(6, 2, MUSTARD[2])
        c.px(8, 3, LEAF[3])
    return c, 1, 1


def fridge() -> Prop:
    c = Canvas(16, 34)
    c.box(0, 0, 15, 33, WHITE[2], WHITE[3], WHITE[0])
    c.hline(1, 14, 12, WHITE[0])
    c.rect(12, 4, 12, 9, METAL[1])
    c.rect(12, 15, 12, 22, METAL[1])
    c.rect(3, 16, 5, 18, STICKY[0])
    c.rect(6, 19, 8, 21, STICKY[2])
    return c, 1, 1


def vending() -> Prop:
    c = Canvas(16, 34)
    c.box(0, 0, 15, 33, CORAL[1], CORAL[2], CORAL[0])
    c.rect(2, 3, 10, 24, SCREEN_2)
    for row in range(4):
        for col in range(3):
            c.rect(3 + col * 3, 4 + row * 5, 4 + col * 3, 6 + row * 5, [MUSTARD[2], GLOW_TEAL, CORAL[3], GLOW_GREEN][(row + col) % 4])
    c.rect(12, 6, 13, 12, GLOW_AMBER)
    c.rect(3, 27, 12, 29, OUT)
    return c, 1, 1


def water_cooler() -> Prop:
    c = Canvas(16, 30)
    c.box(3, 12, 12, 29, WHITE[2], WHITE[3], WHITE[0])
    c.rect(4, 2, 11, 11, (150, 206, 236))
    c.frame(4, 1, 11, 11, OUT)
    c.vline(5, 3, 9, (214, 240, 252))
    c.rect(5, 16, 6, 17, GLOW_BLUE)
    c.rect(9, 16, 10, 17, GLOW_RED)
    return c, 1, 1


def server_rack(seed: int = 0) -> Prop:
    c = Canvas(16, 36)
    c.box(0, 0, 15, 35, CHARCOAL[1], CHARCOAL[2], CHARCOAL[0])
    rng = random.Random(f"rack{seed}")
    for u in range(8):
        y = 3 + u * 4
        c.rect(2, y, 13, y + 2, CHARCOAL[0])
        c.hline(2, 13, y, CHARCOAL[2])
        for led in range(3):
            col = [GLOW_GREEN, GLOW_GREEN, GLOW_BLUE, GLOW_AMBER][rng.randrange(4)]
            c.px(10 + led, y + 1, col)
        c.hline(3, 6, y + 1, CHARCOAL[3])
    return c, 1, 1


def printer() -> Prop:
    c = Canvas(16, 20)
    c.rect(2, 16, 3, 19, OUT)
    c.rect(12, 16, 13, 19, OUT)
    c.block(0, 5, 15, 10, 17, [WHITE[0], WHITE[2], WHITE[3]], [GREY[2], GREY[3], WHITE[1]])
    c.rect(3, 2, 12, 6, PAPER[2])
    c.frame(3, 2, 12, 6, OUT_SOFT, round_corners=False)
    c.px(12, 12, GLOW_GREEN)
    return c, 1, 1


def cabinet(color: list[Color] = GREY) -> Prop:
    c = Canvas(16, 24)
    c.box(0, 0, 15, 23, color[2], color[3], color[1])
    for y in (4, 11, 18):
        c.hline(2, 13, y - 2, color[1])
        c.rect(6, y, 9, y, METAL[3])
    c.rect(4, 1, 8, 1, PAPER[2])
    return c, 1, 1


def trash_bin() -> Prop:
    c = Canvas(16, 12)
    c.box(4, 2, 11, 11, GREY[2], GREY[3], GREY[1])
    c.hline(5, 10, 3, OUT_SOFT)
    return c, 1, 1


def beanbag(color: list[Color] = CORAL) -> Prop:
    c = Canvas(16, 14)
    for y in range(1, 14):
        for x in range(0, 16):
            dx, dy = (x - 7.5) / 7.5, (y - 8) / 6
            d = dx * dx + dy * dy
            if d <= 1:
                c.px(x, y, OUT if d > 0.75 else color[3] if dx + dy < -0.6 else color[2] if d < 0.45 else color[1])
    return c, 1, 1


def exec_desk() -> Prop:
    c = Canvas(48, 26)
    c.rect(2, 22, 3, 25, OUT)
    c.rect(44, 22, 45, 25, OUT)
    c.block(0, 9, 47, 18, 24, [WALNUT[1], WALNUT[2], WALNUT[3]], [WALNUT[0], WALNUT[1], WALNUT[2]])
    c.rect(2, 19, 45, 22, WALNUT[1])
    c.vline(16, 19, 22, WALNUT[0])
    c.vline(31, 19, 22, WALNUT[0])
    # laptop, lamp, papers, nameplate
    c.rect(18, 9, 29, 12, GREY[3])
    c.rect(19, 3, 28, 9, CHARCOAL[1])
    c.rect(20, 4, 27, 8, SCREEN)
    _screen_content(c, 20, 4, 8, 5, "slides")
    c.frame(18, 2, 29, 9, OUT)
    c.rect(38, 2, 41, 4, MUSTARD[2])
    c.frame(37, 1, 42, 5, OUT, round_corners=True)
    c.vline(39, 6, 12, OUT)
    c.hline(37, 41, 13, OUT)
    c.rect(5, 11, 11, 15, PAPER[2])
    c.hline(6, 10, 12, GREY[2])
    c.hline(6, 9, 14, GREY[2])
    return c, 3, 1


def reception_desk() -> Prop:
    c = Canvas(64, 30)
    # back counter (taller) + front panel with the logo stripe
    c.block(0, 6, 63, 14, 29, [OAK[2], OAK[3], OAK[4]], [WHITE[1], WHITE[2], WHITE[3]])
    c.rect(1, 18, 62, 20, TEAL[2])
    c.hline(1, 62, 18, TEAL[3])
    c.hline(1, 62, 20, TEAL[1])
    c.text("WORKVERSE", 15, 22, NAVY[1])
    _monitor(c, 8, 0, 12, "slides", back=True)
    c.rect(44, 8, 50, 11, PAPER[2])  # sign-in book
    c.vline(47, 8, 11, GREY[2])
    c.rect(54, 9, 56, 11, MUSTARD[2])  # bell
    c.px(55, 8, MUSTARD[3])
    small, _, _ = plant("small")
    c.paste(small.img.crop((2, 0, 14, 18)), 26, -4)
    return c, 4, 1


def standing_console(screen: str) -> Prop:
    """Ops console: a standing desk with a large single display (interactive tools)."""
    c = Canvas(32, 32)
    c.rect(4, 26, 5, 31, OUT)
    c.rect(26, 26, 27, 31, OUT)
    c.hline(2, 8, 31, OUT)
    c.hline(23, 29, 31, OUT)
    c.block(0, 17, 31, 24, 28, [CHARCOAL[2], CHARCOAL[3], GREY[2]], [CHARCOAL[0], CHARCOAL[1], CHARCOAL[2]])
    # big screen
    c.box(2, 0, 29, 15, CHARCOAL[1])
    c.rect(3, 1, 28, 14, SCREEN)
    _screen_content(c, 4, 2, 24, 12, screen)
    c.rect(14, 15, 17, 17, CHARCOAL[0])
    # keyboard
    c.rect(8, 20, 23, 21, WHITE[1])
    c.frame(7, 19, 24, 22, OUT_SOFT)
    return c, 2, 1


def lectern_runbook() -> Prop:
    c = Canvas(16, 26)
    c.rect(6, 12, 9, 24, WALNUT[1])
    c.vline(6, 12, 24, OUT)
    c.vline(9, 12, 24, OUT)
    c.hline(3, 12, 25, OUT)
    c.hline(4, 11, 24, WALNUT[0])
    c.block(0, 4, 15, 10, 13, [WALNUT[1], WALNUT[2], WALNUT[3]], [WALNUT[0], WALNUT[1], WALNUT[2]])
    # open red binder
    c.rect(2, 1, 13, 8, CORAL[1])
    c.frame(2, 1, 13, 8, OUT)
    c.rect(3, 2, 7, 7, PAPER[2])
    c.rect(8, 2, 12, 7, PAPER[1])
    for y in (3, 5):
        c.hline(4, 6, y, GREY[2])
        c.hline(9, 11, y, GREY[2])
    c.vline(7, 2, 7, CORAL[0])
    return c, 1, 1


def kanban_board() -> Prop:
    c = Canvas(48, 38)
    # legs + wheels
    for lx in (4, 43):
        c.rect(lx, 26, lx + 1, 36, METAL[1])
        c.vline(lx, 26, 36, OUT)
        c.hline(lx - 2, lx + 3, 37, OUT)
    c.box(0, 0, 47, 28, WHITE[3], None, WHITE[1])
    c.rect(1, 1, 46, 3, NAVY[2])
    for col in range(3):
        x0 = 3 + col * 15
        c.rect(x0, 5, x0 + 10, 7, [CORAL, MUSTARD, SAGE][col][2])
        c.hline(x0, x0 + 10, 7, [CORAL, MUSTARD, SAGE][col][1])
        if col:
            c.vline(x0 - 2, 5, 26, WHITE[0])
        rng = random.Random(col)
        for row in range(3 - (col == 1)):
            y = 12 + row * 5
            colr = STICKY[(col + row) % 4]
            c.rect(x0, y, x0 + 7 + rng.randrange(3), y + 3, colr)
            c.hline(x0 + 1, x0 + 5, y + 1, mix(colr, OUT, 0.4))
    c.rect(19, 13, 25, 16, GLOW_RED)  # the hot ticket
    c.hline(20, 23, 14, (255, 230, 230))
    return c, 3, 1


def cat_bed() -> Prop:
    c = Canvas(16, 10)
    for y in range(1, 10):
        for x in range(0, 16):
            dx, dy = (x - 7.5) / 7.5, (y - 5.5) / 4.5
            d = dx * dx + dy * dy
            if d <= 1:
                c.px(x, y, OUT if d > 0.78 else CORAL[2] if d > 0.42 else PAPER[1])
    return c, 1, 1


def coat_rack() -> Prop:
    c = Canvas(16, 30)
    c.vline(7, 3, 28, WALNUT[1])
    c.vline(8, 3, 28, WALNUT[2])
    c.hline(4, 11, 29, OUT)
    c.hline(5, 10, 28, WALNUT[0])
    c.rect(3, 5, 6, 14, NAVY[2])
    c.frame(3, 5, 6, 14, OUT, round_corners=True)
    c.rect(9, 6, 12, 12, MUSTARD[2])
    c.frame(9, 6, 12, 12, OUT, round_corners=True)
    c.rect(6, 1, 9, 3, OUT)
    return c, 1, 1


def coffee_station() -> Prop:
    """Counter segment (2 tiles) with an espresso machine — the interactive coffee machine."""
    c = Canvas(32, 32)
    base, _, _ = counter("plain")
    c.paste(base, 0, 10)
    base2, _, _ = counter("plain")
    c.paste(base2, 16, 10)
    # machine
    c.box(4, 0, 21, 15, METAL[2], METAL[3], METAL[1])
    c.rect(6, 2, 19, 5, CHARCOAL[1])
    c.px(7, 3, GLOW_GREEN)
    c.px(9, 3, GLOW_AMBER)
    c.rect(11, 3, 17, 4, SCREEN_2)
    c.rect(8, 8, 9, 10, OUT)
    c.rect(15, 8, 16, 10, OUT)
    c.rect(7, 12, 10, 14, WHITE[3])
    c.px(8, 12, WALNUT[1])
    # cups + grinder
    c.rect(24, 6, 29, 15, CHARCOAL[2])
    c.frame(24, 5, 29, 15, OUT)
    c.rect(25, 1, 28, 5, WALNUT[2])
    c.frame(24, 0, 29, 5, OUT)
    return c, 2, 1


def wall_tv(screen: str = "dash") -> Canvas:
    """Wall-mounted incident dashboard (painted on a wall face, 64x26)."""
    c = Canvas(64, 26)
    c.box(0, 0, 63, 25, CHARCOAL[0])
    c.rect(2, 2, 61, 23, SCREEN)
    c.rect(2, 2, 61, 6, (64, 24, 34))
    c.text("INCIDENT", 4, 2, GLOW_RED)
    c.rect(50, 3, 59, 5, GLOW_RED)
    c.text("P1", 52, 2, (64, 24, 34))
    # tiles: error rate, latency graph, status pills
    c.box(3, 7, 20, 22, SCREEN_2)
    c.text("5%", 6, 10, GLOW_RED)
    c.rect(5, 17, 17, 18, GLOW_RED)
    c.rect(5, 17, 9, 18, GLOW_AMBER)
    c.box(22, 7, 46, 22, SCREEN_2)
    _screen_content(c, 24, 9, 21, 12, "graph")
    c.box(48, 7, 60, 22, SCREEN_2)
    for i, col in enumerate([GLOW_GREEN, GLOW_GREEN, GLOW_RED, GLOW_AMBER]):
        c.rect(50, 9 + i * 3, 51, 10 + i * 3, col)
        c.hline(53, 58, 9 + i * 3, GREY[2])
    return c


def whiteboard(width: int = 48) -> Canvas:
    c = Canvas(width, 24)
    c.box(0, 0, width - 1, 21, WHITE[3], None, WHITE[1], OUT)
    c.frame(0, 0, width - 1, 21, METAL[1])
    c.frame(0, 0, width - 1, 21, OUT)
    # diagram: boxes + arrows
    c.frame(4, 4, 13, 9, NAVY[2], round_corners=False)
    c.frame(20, 4, 29, 9, CORAL[1], round_corners=False)
    c.hline(14, 19, 6, NAVY[2])
    c.px(18, 5, NAVY[2])
    c.px(18, 7, NAVY[2])
    for i in range(4):
        c.hline(4, 4 + 4 + i * 3, 12 + i * 2, GREY[2])
    if width > 34:
        c.frame(width - 14, 4, width - 5, 12, TEAL[1], round_corners=True)
        c.px(width - 10, 8, TEAL[1])
    c.rect(4, 22, width - 5, 23, METAL[1])  # tray
    c.rect(8, 21, 11, 21, CORAL[2])
    c.rect(14, 21, 17, 21, NAVY[2])
    return c


def pinboard() -> Canvas:
    """Cork board with migration notes, clipboard and a red pinned page (32x22)."""
    c = Canvas(32, 22)
    c.box(0, 0, 31, 21, (196, 150, 98), (214, 172, 120), (164, 120, 76))
    for y in range(2, 20):
        for x in range(2, 30):
            if (x * 5 + y * 3) % 7 == 0:
                c.px(x, y, (180, 134, 86))
    c.rect(3, 3, 11, 12, PAPER[2])
    for y in (5, 7, 9):
        c.hline(4, 10, y, GREY[2])
    c.px(7, 3, CORAL[1])
    c.rect(14, 4, 21, 15, PAPER[2])
    c.rect(14, 4, 21, 5, CORAL[2])
    for y in (8, 10, 12):
        c.hline(15, 20, y, GREY[1])
    c.px(17, 4, OUT)
    c.rect(24, 3, 28, 7, STICKY[0])
    c.rect(23, 10, 28, 14, STICKY[2])
    c.rect(4, 14, 9, 18, STICKY[1])
    return c


def logo_sign() -> Canvas:
    c = Canvas(48, 13)
    c.box(0, 0, 47, 12, NAVY[1], NAVY[2], NAVY[0])
    c.rect(3, 3, 6, 9, TEAL[3])
    c.rect(4, 4, 5, 8, NAVY[1])
    c.text("WORKVERSE", 9, 4, WHITE[3])
    return c


# ---------------------------------------------------------------------------------- utilities
def outline_highlight(img: Image.Image, color: Color = (255, 238, 160)) -> Image.Image:
    """A copy of `img` with a 1px outer glow ring — the 'you can use this' state."""
    w, h = img.size
    out = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    out.alpha_composite(img, (1, 1))
    src = out.load()
    alpha = [[src[x, y][3] > 0 for x in range(w + 2)] for y in range(h + 2)]
    for y in range(h + 2):
        for x in range(w + 2):
            if alpha[y][x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w + 2 and 0 <= ny < h + 2 and alpha[ny][nx]:
                    src[x, y] = rgba(color)
                    break
    return out


def upscale(img: Image.Image, k: int = ART_SCALE) -> Image.Image:
    return img.resize((img.width * k, img.height * k), Image.NEAREST)
