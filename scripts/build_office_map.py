"""Pre-render the WorkVerse office map from the supplied pixel-art assets.

This script composes a large, coherent office from the *actual* Neko Office tileset and
furniture sheet, then writes Phaser-ready layers and a collision grid. It is deterministic
and committed so the map can be regenerated.

Usage:
    python scripts/build_office_map.py

Requires Pillow. Outputs to apps/web/public/assets/game/map/.
"""

from __future__ import annotations

import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
NEKO = os.path.join(ASSETS, "Neko Office Asset Pack")
OUT = os.path.join(ROOT, "apps", "web", "public", "assets", "game", "map")

TILE = 16          # source tile size
SCALE = 2          # output scale -> 32px per tile on screen
W, H = 64, 44      # world size in tiles

os.makedirs(OUT, exist_ok=True)

tileset = Image.open(os.path.join(NEKO, "neko-office-tileset.png")).convert("RGBA")
furniture = Image.open(os.path.join(NEKO, "neko-office-furniture.png")).convert("RGBA")


def tile(col: int, row: int) -> Image.Image:
    return tileset.crop((col * 16, row * 16, col * 16 + 16, row * 16 + 16))


def sprite(box: tuple[int, int, int, int]) -> Image.Image:
    x0, y0, x1, y1 = box
    return furniture.crop((x0, y0, x1 + 1, y1 + 1))


FLOOR_WOOD = tile(6, 4)      # wood planks
FLOOR_CARPET = tile(1, 3)    # warm carpet
FLOOR_CARPET_DARK = tile(3, 3)
WALL = tile(1, 1)            # light wall face
WALL_LOW = tile(1, 2)
TRIM = (31, 27, 24, 255)

# Furniture sprites (bounding boxes measured from the furniture sheet).
F = {
    "desk": sprite((17, 17, 62, 62)),
    "desk_wood": sprite((17, 65, 62, 110)),
    "bookshelf": sprite((97, 19, 126, 46)),
    "cabinet": sprite((66, 23, 93, 46)),
    "whiteboard": sprite((113, 52, 142, 70)),
    "serverrack": sprite((19, 114, 60, 126)),
    "bench": sprite((65, 48, 94, 62)),
    "bench2": sprite((65, 65, 94, 79)),
    "longtable": sprite((65, 113, 94, 126)),
    "tree": sprite((97, 50, 110, 77)),
    "printer": sprite((96, 114, 111, 126)),
    "monitor": sprite((64, 97, 79, 109)),
    "coffee": sprite((97, 98, 110, 110)),
    "plant": sprite((113, 81, 126, 95)),
    "cooler": sprite((114, 98, 125, 110)),
    "chair": sprite((81, 81, 94, 94)),
    "chair_green": sprite((66, 81, 77, 94)),
    "keyboard": sprite((96, 81, 111, 92)),
}

# Rooms: id, (x0,y0,x1,y1) inclusive, floor key.
ROOMS = [
    ("reception", (1, 1, 15, 11), "carpet"),
    ("meeting_room", (18, 1, 46, 11), "carpet_dark"),
    ("manager_office", (49, 1, 62, 11), "carpet"),
    ("corridor_top", (1, 13, 62, 15), "wood"),
    ("engineering_workspace", (1, 17, 30, 41), "wood"),
    ("collaboration_area", (33, 17, 46, 41), "carpet"),
    ("break_area", (49, 17, 62, 41), "carpet_dark"),
]

# Door openings: (x, y) tiles carved out of the wall rows.
DOORS = [
    (8, 12), (9, 12),
    (32, 12), (33, 12),
    (55, 12), (56, 12),
    (15, 16), (16, 16),
    (39, 16), (40, 16),
    (55, 16), (56, 16),
]

floor_kind: dict[tuple[int, int], str] = {}
for _id, (x0, y0, x1, y1), kind in ROOMS:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            floor_kind[(x, y)] = kind
for dx, dy in DOORS:
    floor_kind[(dx, dy)] = "wood"

solid = [[1 for _ in range(W)] for _ in range(H)]
for y in range(H):
    for x in range(W):
        if (x, y) in floor_kind:
            solid[y][x] = 0

# ---- render ground + walls -------------------------------------------------
ground = Image.new("RGBA", (W * TILE, H * TILE), (0, 0, 0, 0))
walls = Image.new("RGBA", (W * TILE, H * TILE), (0, 0, 0, 0))

floor_tiles = {"wood": FLOOR_WOOD, "carpet": FLOOR_CARPET, "carpet_dark": FLOOR_CARPET_DARK}
for y in range(H):
    for x in range(W):
        kind = floor_kind.get((x, y))
        if kind:
            ground.paste(floor_tiles[kind], (x * TILE, y * TILE))
        else:
            walls.paste(WALL, (x * TILE, y * TILE))

# dark trim around floor edges
draw = ImageDraw.Draw(walls)
for (x, y) in floor_kind:
    for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if (nx, ny) not in floor_kind:
            px, py = x * TILE, y * TILE
            if dx == 1:
                draw.rectangle([px + TILE - 2, py, px + TILE - 1, py + TILE - 1], fill=TRIM)
            elif dx == -1:
                draw.rectangle([px, py, px + 1, py + TILE - 1], fill=TRIM)
            elif dy == 1:
                draw.rectangle([px, py + TILE - 2, px + TILE - 1, py + TILE - 1], fill=TRIM)
            else:
                draw.rectangle([px, py, px + TILE - 1, py + 1], fill=TRIM)

# ---- furniture placement ---------------------------------------------------
foreground = Image.new("RGBA", (W * TILE, H * TILE), (0, 0, 0, 0))

# (sprite key, tile x, tile y, solid?, foreground?)
PLACEMENTS = [
    # --- engineering workspace: two rows of workstations + ops wall ---
    ("desk", 3, 20, True, False),
    ("desk", 11, 20, True, False),
    ("desk", 19, 20, True, False),
    ("desk", 3, 28, True, False),
    ("desk", 11, 28, True, False),
    ("desk", 19, 28, True, False),
    ("monitor", 4, 20, True, False),
    ("monitor", 12, 20, True, False),
    ("monitor", 20, 20, True, False),
    ("monitor", 4, 28, True, False),
    ("monitor", 12, 28, True, False),
    ("monitor", 20, 28, True, False),
    ("chair", 5, 23, True, False),
    ("chair", 13, 23, True, False),
    ("chair", 21, 23, True, False),
    ("chair", 5, 31, True, False),
    ("chair", 13, 31, True, False),
    ("chair", 21, 31, True, False),
    ("keyboard", 3, 23, False, False),
    ("keyboard", 11, 23, False, False),
    ("printer", 25, 20, True, False),
    ("serverrack", 24, 35, True, False),
    ("cooler", 28, 20, True, False),
    ("bookshelf", 1, 18, True, True),
    ("bookshelf", 1, 24, True, True),
    ("bookshelf", 1, 30, True, True),
    ("tree", 28, 33, True, True),
    ("plant", 1, 37, True, True),
    ("plant", 28, 24, True, True),
    ("cabinet", 26, 30, True, True),
    # --- meeting room: boardroom table + chairs + whiteboard ---
    ("longtable", 27, 4, True, False),
    ("longtable", 34, 4, True, False),
    ("longtable", 27, 6, True, False),
    ("longtable", 34, 6, True, False),
    ("chair", 27, 2, True, False),
    ("chair", 31, 2, True, False),
    ("chair", 35, 2, True, False),
    ("chair", 28, 8, True, False),
    ("chair", 33, 8, True, False),
    ("chair", 38, 8, True, False),
    ("whiteboard", 19, 1, True, True),
    ("cabinet", 44, 1, True, True),
    ("plant", 44, 9, True, True),
    ("plant", 19, 9, True, True),
    ("coffee", 43, 8, True, True),
    # --- manager office ---
    ("desk", 52, 3, True, False),
    ("monitor", 53, 3, True, False),
    ("chair", 54, 6, True, False),
    ("bookshelf", 60, 1, True, True),
    ("bookshelf", 57, 1, True, True),
    ("plant", 60, 9, True, True),
    ("cabinet", 50, 8, True, True),
    # --- reception ---
    ("longtable", 4, 3, True, False),
    ("longtable", 8, 3, True, False),
    ("plant", 1, 1, True, True),
    ("plant", 14, 1, True, True),
    ("chair", 6, 6, True, False),
    ("cabinet", 12, 1, True, True),
    # --- collaboration area ---
    ("longtable", 36, 22, True, False),
    ("longtable", 41, 22, True, False),
    ("longtable", 36, 25, True, False),
    ("chair", 37, 20, True, False),
    ("chair", 42, 20, True, False),
    ("chair_green", 38, 27, True, False),
    ("chair_green", 43, 27, True, False),
    ("bookshelf", 33, 17, True, True),
    ("bookshelf", 33, 24, True, True),
    ("plant", 44, 39, True, True),
    ("plant", 44, 18, True, True),
    ("cabinet", 44, 31, True, True),
    # --- break area ---
    ("longtable", 52, 20, True, False),
    ("longtable", 56, 20, True, False),
    ("bench", 57, 24, True, False),
    ("bench2", 57, 27, True, False),
    ("coffee", 60, 18, True, True),
    ("plant", 49, 39, True, True),
    ("plant", 49, 18, True, True),
    ("cooler", 60, 30, True, False),
    ("cabinet", 49, 33, True, True),
]

for key, tx, ty, is_solid, is_fg in PLACEMENTS:
    img = F[key]
    px, py = tx * TILE, ty * TILE
    target = foreground if is_fg else walls
    target.alpha_composite(img, (px, py))
    if is_solid:
        fw = (img.width + TILE - 1) // TILE
        fh = (img.height + TILE - 1) // TILE
        for yy in range(ty, min(ty + fh, H)):
            for xx in range(tx, min(tx + fw, W)):
                solid[yy][xx] = 1

# ---- scale up --------------------------------------------------------------
def upscale(img: Image.Image) -> Image.Image:
    return img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)


upscale(ground).save(os.path.join(OUT, "ground.png"))
upscale(walls).save(os.path.join(OUT, "walls.png"))
upscale(foreground).save(os.path.join(OUT, "foreground.png"))

# ---- metadata --------------------------------------------------------------
NPC_SLOTS = {
    "manager": {"x": 55, "y": 6},
    "teammate": {"x": 9, "y": 24},
    "qa": {"x": 40, "y": 27},
    "client_pm": {"x": 31, "y": 5},
    "coworker": {"x": 55, "y": 27},
}
OBJECT_SLOTS = {
    "incident_dashboard": {"x": 5, "y": 18},
    "log_viewer": {"x": 9, "y": 18},
    "metrics_panel": {"x": 13, "y": 18},
    "deploy_console": {"x": 17, "y": 18},
    "runbook": {"x": 23, "y": 18},
    "migration_notes": {"x": 25, "y": 18},
    "team_board": {"x": 36, "y": 18},
    "meeting_whiteboard": {"x": 20, "y": 2},
    "coffee_machine": {"x": 61, "y": 19},
    "reception_desk": {"x": 5, "y": 4},
}

meta = {
    "tile": 16,
    "scale": SCALE,
    "width": W,
    "height": H,
    "spawn": {"x": 8, "y": 6},
    "rooms": [
        {"id": rid, "x0": r[0], "y0": r[1], "x1": r[2], "y1": r[3], "floor": kind}
        for rid, r, kind in ROOMS
    ],
    "npc_slots": NPC_SLOTS,
    "object_slots": OBJECT_SLOTS,
    "collision": solid,
}
with open(os.path.join(OUT, "map.json"), "w") as fh:
    json.dump(meta, fh)

print("wrote map to", OUT)
print("world px:", W * TILE * SCALE, H * TILE * SCALE)
