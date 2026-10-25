"""Build the WorkVerse office: baked floor/wall layers, a prop atlas and map metadata.

The office is drawn in a 3/4 top-down view on a 16px tile grid (see scripts/office_art.py for the
palette and painters) and exported at ART_SCALE, so one tile is 32 world pixels and the engine
draws every image 1:1.

Layers written to apps/web/public/assets/game/map/:
  ground.png  floors, rugs, baked contact shadows, ambient occlusion and window light
  walls.png   wall caps and wall faces with everything mounted on them (windows, art, doors)
  props.png + props.json   a Phaser atlas of free-standing furniture and interactive objects;
                           map.json says where each one goes, and the engine y-sorts them by base
  map.json    size, rooms, spawn, collision grid, prop placements, NPC and object slots

Usage:
    python scripts/build_office_map.py

Requires Pillow. Deterministic: the same script always produces the same files.
"""

from __future__ import annotations

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import office_art as art  # noqa: E402
from office_art import ART_SCALE, T, Canvas  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps", "web", "public", "assets", "game", "map")
W, H = 46, 35  # world size in tiles
WT = T * ART_SCALE  # world px per tile

# ---------------------------------------------------------------------------------- layout
# Rooms: id, (x0, y0, x1, y1) inclusive floor tiles, floor kind, wall paint.
ROOMS = [
    ("reception", (1, 3, 12, 10), "stone", "reception"),
    ("meeting_room", (14, 3, 31, 10), "oak", "meeting"),
    ("manager_office", (33, 3, 44, 10), "walnut", "manager"),
    ("corridor_main", (1, 14, 44, 16), "concrete", "corridor"),
    ("engineering_workspace", (1, 20, 22, 33), "carpet", "engineering"),
    ("collaboration_area", (24, 20, 33, 33), "oak", "collab"),
    ("break_area", (35, 20, 44, 33), "checker", "break"),
]

# Doorways: (x0, x1, y0, y1) inclusive tiles cut through walls, and the floor they get.
DOORS = [
    ((6, 7, 11, 13), "concrete"),
    ((22, 23, 11, 13), "concrete"),
    ((38, 39, 11, 13), "concrete"),
    ((11, 12, 17, 19), "concrete"),
    ((28, 29, 17, 19), "concrete"),
    ((39, 40, 17, 19), "concrete"),
    ((23, 23, 26, 27), "carpet"),  # engineering <-> collaboration
    ((34, 34, 26, 27), "oak"),  # collaboration <-> break
]

floor_kind: dict[tuple[int, int], str] = {}
room_of: dict[tuple[int, int], str] = {}
paint_of: dict[tuple[int, int], str] = {}
for rid, (x0, y0, x1, y1), kind, paint in ROOMS:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            floor_kind[(x, y)] = kind
            room_of[(x, y)] = rid
            paint_of[(x, y)] = paint
door_cells: set[tuple[int, int]] = set()
for (x0, x1, y0, y1), kind in DOORS:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            floor_kind[(x, y)] = kind
            door_cells.add((x, y))


def is_floor(x: int, y: int) -> bool:
    return (x, y) in floor_kind


# A wall cell directly above floor (and the one above that) is a visible wall face.
face_of: dict[tuple[int, int], tuple[str, int]] = {}  # cell -> (paint, row 0 top / 1 bottom)
for (x, y) in list(floor_kind):
    if (x, y) in door_cells:
        continue
    if not is_floor(x, y - 1) and not is_floor(x, y - 2) and y - 2 >= 0:
        paint = paint_of.get((x, y), "corridor")
        face_of[(x, y - 1)] = (paint, 1)
        face_of[(x, y - 2)] = (paint, 0)

solid = [[0 if is_floor(x, y) else 1 for x in range(W)] for y in range(H)]

# ---------------------------------------------------------------------------------- canvases
ground = Canvas(W * T, H * T)
walls = Canvas(W * T, H * T)

for (x, y), kind in floor_kind.items():
    ground.paste(art.floor_tile(kind, x, y), x * T, y * T)

# Door sills: a slim threshold where a doorway meets each room.
for (x0, x1, y0, y1), _ in DOORS:
    if y1 > y0 + 1:  # horizontal-wall doorway (vertical passage)
        for yy in (y0, y1 + 1):
            ground.rect(x0 * T, yy * T, (x1 + 1) * T - 1, yy * T + 1, art.mix(art.STONE[1], art.OUT, 0.2))
    else:
        for xx in (x0, x1 + 1):
            ground.rect(xx * T, y0 * T, xx * T + 1, (y1 + 1) * T - 1, art.mix(art.STONE[1], art.OUT, 0.2))


def add_rug(px0: int, py0: int, w: int, h: int, scheme: str) -> None:
    ground.paste(art.rug(w, h, scheme), px0, py0)


add_rug(8 * T + 8, 7 * T + 4, 4 * T, 3 * T - 2, "teal")  # reception waiting
add_rug(17 * T + 8, 4 * T, 10 * T, 4 * T + 8, "navy")  # meeting table
add_rug(35 * T + 8, 3 * T + 8, 7 * T, 5 * T, "terracotta")  # manager
add_rug(24 * T + 8, 25 * T, 8 * T, 7 * T, "sage")  # collaboration lounge
add_rug(11 * T + 8, 24 * T + 4, 10 * T, 6 * T, "plum")  # engineering pods
add_rug(37 * T + 8, 30 * T + 8, 6 * T, 3 * T + 4, "terracotta")  # break lounge
# corridor runner
ground.rect(2 * T, 15 * T - 3, 44 * T - 1, 15 * T + 2, art.mix(art.SAGE[1], art.STONE[2], 0.25))
ground.hline(2 * T, 44 * T - 1, 15 * T - 3, art.SAGE[2])
ground.hline(2 * T, 44 * T - 1, 15 * T + 2, art.SAGE[0])

# ---- walls: caps everywhere that is wall and not face, faces painted per run
for y in range(H):
    for x in range(W):
        if is_floor(x, y) or (x, y) in face_of:
            continue

        def wall(nx: int, ny: int) -> bool:
            if nx < 0 or ny < 0 or nx >= W or ny >= H:
                return True
            return not is_floor(nx, ny) and (nx, ny) not in face_of

        walls.paste(
            art.wall_cap({"n": wall(x, y - 1), "s": wall(x, y + 1), "w": wall(x - 1, y), "e": wall(x + 1, y)}),
            x * T,
            y * T,
        )

# Face runs: contiguous face_top cells in a row share one painted strip.
for y in range(H):
    x = 0
    while x < W:
        f = face_of.get((x, y))
        if not f or f[1] != 0:
            x += 1
            continue
        paint = f[0]
        x0 = x
        while x < W and face_of.get((x, y), (None, -1))[0] == paint and face_of[(x, y)][1] == 0:
            x += 1
        walls.paste(art.wall_face(paint, x - x0, seed=x0 * 7 + y), x0 * T, y * T)
        # side shading where a face meets a wall cap column
        walls.rect(x0 * T, y * T + 2, x0 * T, y * T + 2 * T - 1, art.OUT, 90)
        walls.rect(x * T - 1, y * T + 2, x * T - 1, y * T + 2 * T - 1, art.OUT, 60)

# Door trims on the faces either side of each horizontal-wall doorway.
for (x0, x1, y0, y1), _ in DOORS:
    if y1 > y0 + 1:
        face_top = y1 - 1
        if (x0 - 1, face_top) in face_of or (x1 + 1, face_top) in face_of:
            strip = Canvas((x1 - x0 + 1) * T + 4, 2 * T)
            art.door_frame(strip, 2, (x1 - x0 + 1) * T)
            # only the posts land on the wall; the opening itself stays floor
            post_l = strip.img.crop((0, 0, 2, 2 * T))
            post_r = strip.img.crop((strip.w - 2, 0, strip.w, 2 * T))
            walls.paste(post_l, x0 * T - 2, face_top * T)
            walls.paste(post_r, (x1 + 1) * T, face_top * T)


def on_face(tx: int, ty_face_top: int, img: Canvas, dx: int = 0, dy: int = 0) -> None:
    walls.paste(img, tx * T + dx, ty_face_top * T + dy)


def window(tx: int, ty_face_top: int, width_tiles: int = 2, seed: int = 0) -> None:
    strip = Canvas(width_tiles * T, 2 * T)
    art.window_on_wall(strip, 3, width_tiles * T - 6, seed)
    walls.paste(strip, tx * T, ty_face_top * T)
    # light falling through it onto the floor below, skewed down-right (light from top-left)
    floor_y = (ty_face_top + 2) * T
    for i in range(22):
        a = max(0, 34 - i * 1.4)
        x0 = tx * T + 4 + i // 2
        x1 = tx * T + width_tiles * T - 5 + i // 2
        for xx in range(x0, x1 + 1):
            if is_floor(xx // T, (floor_y + i) // T):
                ground.px(xx, floor_y + i, (255, 244, 214), int(a))


def upper_cabinets(tx: int, ty_face_top: int, width_tiles: int) -> None:
    w = width_tiles * T
    c = Canvas(w, 14)
    c.box(0, 0, w - 1, 13, art.SAGE[2], art.SAGE[3], art.SAGE[0])
    for i in range(width_tiles * 2):
        c.vline(i * 8, 1, 12, art.SAGE[0])
        c.px(i * 8 + 4, 9, art.METAL[3])
    walls.paste(c, tx * T, ty_face_top * T + 4)


def plaque(door_x0: int, ty_face_top: int, text: str) -> None:
    """Room sign on the wall just left of a doorway that starts at tile door_x0."""
    width = art.Canvas(1, 1).text(text, 0, 0, art.OUT) + 5
    c = Canvas(width, 9)
    c.box(0, 0, width - 1, 8, art.NAVY[1], art.NAVY[2], art.NAVY[0])
    c.text(text, 3, 2, art.WHITE[3])
    walls.paste(c, door_x0 * T - 6 - width, ty_face_top * T + 6)


def glass_door(tx: int, ty_face_top: int) -> None:
    c = Canvas(2 * T, 2 * T)
    c.rect(1, 3, 30, 31, art.METAL[1])
    for x0 in (2, 16):
        c.rect(x0 + 1, 5, x0 + 12, 30, (164, 208, 228))
        for y in range(5, 31):
            if (y + x0) % 9 == 0:
                c.hline(x0 + 2, x0 + 5, y, (210, 236, 248))
        c.frame(x0, 4, x0 + 13, 31, art.OUT, round_corners=False)
    c.rect(13, 16, 13, 21, art.METAL[3])
    c.rect(18, 16, 18, 21, art.METAL[3])
    walls.paste(c, tx * T, ty_face_top * T)


# Reception (north face rows 1-2)
window(1, 1, 2, seed=1)
on_face(4, 1, art.logo_sign(), dx=8, dy=7)
glass_door(9, 1)
art.clock(walls, 12 * T + 4, 1 * T + 6)
# Meeting room
pres = Canvas(64, 24)
pres.box(0, 0, 63, 21, art.CHARCOAL[0])
pres.rect(2, 2, 61, 19, art.SCREEN)
art._screen_content(pres, 2, 2, 60, 18, "slides")
pres.text("Q4 PLAN", 22, 9, art.NAVY[1])
on_face(20, 1, pres, dx=8, dy=4)
window(26, 1, 2, seed=2)
window(29, 1, 2, seed=3)
# Manager office
window(36, 1, 2, seed=4)
window(40, 1, 2, seed=5)
art.frame_art(walls, 38 * T + 6, 1 * T + 6, 18, 14, 1)
# Corridor face (rows 12-13): art, plaques beside doors, a clock
plaque(6, 12, "LOBBY")
plaque(22, 12, "MEETING")
plaque(38, 12, "MANAGER")
art.frame_art(walls, 10 * T + 4, 12 * T + 5, 20, 14, 0)
art.frame_art(walls, 15 * T + 2, 12 * T + 5, 14, 14, 2)
art.frame_art(walls, 28 * T + 4, 12 * T + 5, 24, 14, 3)
art.clock(walls, 33 * T + 4, 12 * T + 6)
art.frame_art(walls, 42 * T + 2, 12 * T + 5, 16, 14, 1)
# Engineering (face rows 18-19)
window(7, 18, 2, seed=6)
window(13, 18, 2, seed=7)
art.clock(walls, 10 * T + 4, 18 * T + 6)
# Collaboration
window(30, 18, 2, seed=8)
art.frame_art(walls, 32 * T + 2, 18 * T + 6, 14, 12, 0)
# Break
upper_cabinets(35, 18, 4)
window(42, 18, 2, seed=9)

# ---------------------------------------------------------------------------------- props
frames: dict[str, Image.Image] = {}
placements: list[dict] = []


def register(name: str, img: Image.Image) -> str:
    if name not in frames:
        frames[name] = img
    return name


def contact_shadow(img: Image.Image, px0: int, py_bottom: int) -> None:
    """Soft shadow that follows the prop's own footing, pushed down-right (light from top-left).

    Only columns where the prop actually touches down (opaque in its bottom rows) cast, so legs,
    pots and wheels get small shadows and solid cabinets get a full one."""
    w, h = img.size
    alpha = img.getchannel("A").load()
    for x in range(w):
        if not any(alpha[x, y] for y in range(max(0, h - 4), h)):
            continue
        for i, a in enumerate((46, 46, 40, 24)):
            ground.px(px0 + x + 2, py_bottom - 3 + i, art.SHADOW, a)


def prop(
    name: str, built: art.Prop, tx: int, ty: int, solid_tiles: bool = True, shadow: bool = True, dx: int = 0
) -> dict:
    """Place a prop with its footprint's top-left at tile (tx, ty). dx nudges the art (in art px)
    off the grid, e.g. half a tile to centre a chair on a 2-tile desk; collision covers every
    tile the nudged footprint touches."""
    canvas, fw, fh = built
    register(name, canvas.img)
    px0 = tx * T + dx
    py_bottom = (ty + fh) * T
    if shadow:
        contact_shadow(canvas.img, px0, py_bottom)
    if solid_tiles:
        x_tiles = range(px0 // T, (px0 + fw * T - 1) // T + 1)
        for yy in range(ty, ty + fh):
            for xx in x_tiles:
                solid[yy][xx] = 1
    entry = {
        "f": name,
        "x": px0 * ART_SCALE,
        "y": (py_bottom - canvas.h) * ART_SCALE,
        "d": py_bottom * ART_SCALE,
    }
    placements.append(entry)
    return entry


# Reusable built props (frame names are shared so the atlas stays small)
P = {
    "desk_s_code": art.desk("code", "s", 0),
    "desk_s_logs": art.desk("graph", "s", 1),
    "desk_n": art.desk(facing="n", items=0),
    "desk_n2": art.desk(facing="n", items=1),
    "chair_n": art.chair("n"),
    "chair_s": art.chair("s"),
    "chair_s_teal": art.chair("s", art.TEAL),
    "chair_n_teal": art.chair("n", art.TEAL),
    "chair_e": art.chair("e", art.TEAL),
    "chair_w": art.chair("w", art.TEAL),
    "plant_tall": art.plant("tall"),
    "plant_tall_b": art.plant("tall", 3),
    "plant_small": art.plant("small"),
    "plant_snake": art.plant("snake"),
    "bookshelf": art.bookshelf(2, 0),
    "bookshelf_b": art.bookshelf(2, 4),
    "sofa_s_teal": art.sofa(3, art.TEAL, "s"),
    "sofa_n_mustard": art.sofa(3, art.MUSTARD, "n"),
    "armchair_coral": art.armchair(art.CORAL),
    "armchair_mustard": art.armchair(art.MUSTARD),
    "armchair_navy": art.armchair(art.NAVY),
    "armchair_mustard_n": art.armchair(art.MUSTARD, "n"),
    "armchair_navy_n": art.armchair(art.NAVY, "n"),
    "low_table3": art.low_table(3, art.OAK, "coffee"),
    "round_table": art.round_table(),
    "round_table_plain": art.round_table(items=False),
    "stool": art.stool(art.CORAL),
    "stool_teal": art.stool(art.TEAL),
    "meeting_table": art.long_table(8, 2),
    "counter_sink": art.counter("sink"),
    "counter": art.counter("plain"),
    "counter_fruit": art.counter("fruit"),
    "fridge": art.fridge(),
    "vending": art.vending(),
    "water_cooler": art.water_cooler(),
    "server_rack": art.server_rack(0),
    "server_rack_b": art.server_rack(1),
    "printer": art.printer(),
    "cabinet": art.cabinet(),
    "trash": art.trash_bin(),
    "beanbag_coral": art.beanbag(art.CORAL),
    "beanbag_teal": art.beanbag(art.TEAL),
    "exec_desk": art.exec_desk(),
    "cat_bed": art.cat_bed(),
    "coat_rack": art.coat_rack(),
}


def place(name: str, tx: int, ty: int, solid_tiles: bool = True, shadow: bool = True, dx: int = 0) -> dict:
    return prop(name, P[name], tx, ty, solid_tiles, shadow, dx)


# Reception
place("plant_tall", 1, 3)
place("coat_rack", 3, 3)
place("plant_snake", 12, 3)
place("water_cooler", 1, 7)
place("armchair_coral", 9, 8)
place("round_table", 10, 8)
place("armchair_navy", 11, 8)
place("plant_small", 12, 10)
place("trash", 1, 10)
# Meeting room
place("plant_tall", 14, 3)
place("plant_tall_b", 31, 3)
place("meeting_table", 19, 5)
for x in (20, 22, 24, 26):
    place("chair_s_teal", x, 4)
for x in (19, 21, 23, 25):
    place("chair_n_teal", x, 7)
place("chair_e", 18, 5)
place("chair_w", 27, 5)
place("cabinet", 31, 7)
place("plant_small", 14, 10)
place("plant_snake", 31, 10)
# Manager office
place("bookshelf", 33, 3)
place("bookshelf_b", 43, 3)
place("exec_desk", 37, 5)
place("chair_s", 38, 4)
place("armchair_mustard_n", 37, 7)
place("armchair_navy_n", 39, 7)
place("plant_tall", 44, 10)
place("plant_snake", 33, 10)
place("cabinet", 33, 8)
# Corridor
place("plant_tall", 1, 14)
place("plant_tall_b", 44, 14)
place("water_cooler", 17, 14)
place("trash", 18, 14)
place("plant_small", 31, 14)
place("trash", 9, 14)
# Engineering: ops island, dev pods, servers
# Two back-to-back pods of four, one chair centred on each desk.
def pod(x0: int, y0: int) -> None:
    for i, x in enumerate((x0, x0 + 2)):
        place(("desk_n", "desk_n2")[i], x, y0 + 1)
        place("chair_s", x, y0, dx=8)
        place(("desk_s_code", "desk_s_logs")[i], x, y0 + 2)
        place("chair_n", x, y0 + 3, dx=8)


pod(12, 25)
pod(17, 25)
pod(3, 29)
place("server_rack", 19, 33)
place("server_rack_b", 20, 33)
place("server_rack", 21, 33)
place("cabinet", 22, 33)
place("printer", 22, 22)
place("cabinet", 22, 23)
place("plant_tall", 1, 20)
place("plant_tall_b", 22, 20)
place("plant_tall", 1, 33)
place("plant_small", 9, 33)
place("trash", 8, 30)
place("bookshelf_b", 18, 20)
place("plant_snake", 11, 33)
# Collaboration
place("bookshelf", 31, 20)
place("sofa_s_teal", 26, 26)
place("low_table3", 26, 28)
place("sofa_n_mustard", 26, 30)
place("armchair_coral", 25, 28)
place("armchair_navy", 30, 28)
place("beanbag_coral", 32, 25)
place("beanbag_teal", 32, 30)
place("plant_tall", 24, 33)
place("plant_tall_b", 33, 33)
place("plant_small", 33, 20)
place("round_table_plain", 31, 23)
place("stool_teal", 30, 23)
# Break area
place("fridge", 35, 20)
place("counter_sink", 36, 20)
place("counter", 37, 20)
place("counter_fruit", 38, 20)
place("water_cooler", 43, 20)
place("vending", 44, 20)
for tx, ty in ((37, 24), (42, 24), (37, 29), (42, 29)):
    place("round_table", tx, ty)
    place("stool", tx - 1, ty)
    place("stool_teal", tx + 1, ty)
place("plant_tall", 35, 33)
place("plant_tall_b", 44, 33)
place("cat_bed", 44, 27, solid_tiles=False)
place("armchair_coral", 38, 31)
place("low_table3", 39, 31)
place("armchair_mustard", 42, 31)
place("trash", 35, 24)

# ---------------------------------------------------------------------------------- objects
# Interactive objects: atlas frames + a highlighted twin, a placement and an approach anchor.
object_slots: dict[str, dict] = {}


def interactive(
    oid: str,
    img: Canvas,
    px0: int,
    py0: int,
    anchor: tuple[float, float],
    footprint: tuple[int, int, int, int] | None = None,
    mounted: bool = False,
) -> None:
    """px0/py0: top-left in art px. anchor: tile coords (fractional) the learner walks to.
    footprint: (tx, ty, w, h) solid tiles, or None for wall-mounted pieces."""
    register(oid, img.img)
    register(f"{oid}_hl", art.outline_highlight(img.img))
    bottom = py0 + img.h
    if footprint:
        fx, fy, fw, fh = footprint
        for yy in range(fy, fy + fh):
            for xx in range(fx, fx + fw):
                solid[yy][xx] = 1
        if not mounted:
            contact_shadow(img.img, px0, bottom)
    ax, ay = anchor
    object_slots[oid] = {
        "x": int(ax),
        "y": int(ay),
        "ax": round(ax * WT),
        "ay": round(ay * WT),
        "frame": oid,
        "px": px0 * ART_SCALE,
        "py": py0 * ART_SCALE,
        "d": bottom * ART_SCALE,
        "mounted": mounted,
    }


def floor_object(oid: str, built: art.Prop, tx: int, ty: int, anchor: tuple[float, float]) -> None:
    canvas, fw, fh = built
    interactive(oid, canvas, tx * T, (ty + fh) * T - canvas.h, anchor, (tx, ty, fw, fh))


tv = art.wall_tv()
interactive("incident_dashboard", tv, 2 * T + 8, 18 * T + 3, (4.5, 20.6), mounted=True)
floor_object("log_viewer", art.standing_console("logs"), 2, 23, (3.0, 24.6))
floor_object("metrics_panel", art.standing_console("graph"), 5, 23, (6.0, 24.6))
floor_object("deploy_console", art.standing_console("pipeline"), 8, 23, (9.0, 24.6))
floor_object("runbook", art.lectern_runbook(), 20, 21, (20.5, 22.6))
interactive("migration_notes", art.pinboard(), 15 * T + 16, 18 * T + 6, (16.5, 20.6), mounted=True)
floor_object("team_board", art.kanban_board(), 25, 20, (26.5, 21.6))
interactive("meeting_whiteboard", art.whiteboard(48), 15 * T, 1 * T + 4, (16.5, 3.6), mounted=True)
floor_object("coffee_machine", art.coffee_station(), 41, 20, (42.0, 21.6))
floor_object("reception_desk", art.reception_desk(), 4, 5, (6.0, 7.0))

# ---------------------------------------------------------------------------------- AO pass
# Ambient occlusion under wall faces and beside wall caps, drawn after props' shadows so it
# reads as one soft, consistent light from the top-left.
for (x, y) in floor_kind:
    if (x, y) in door_cells:
        continue
    if (x, y - 1) in face_of:
        for i, a in enumerate((70, 44, 26, 12)):
            ground.rect(x * T, y * T + i, x * T + T - 1, y * T + i, art.SHADOW, a)
    if not is_floor(x - 1, y) and (x - 1, y) not in face_of:
        for i, a in enumerate((60, 30, 12)):
            ground.rect(x * T + i, y * T, x * T + i, y * T + T - 1, art.SHADOW, a)
    if not is_floor(x + 1, y) and (x + 1, y) not in face_of:
        ground.rect(x * T + T - 1, y * T, x * T + T - 1, y * T + T - 1, art.SHADOW, 22)

# ---------------------------------------------------------------------------------- atlas
def pack(images: dict[str, Image.Image], width: int = 512) -> tuple[Image.Image, dict]:
    """Shelf-pack at art scale with 1px gutters, then upscale; returns (sheet, frame rects)."""
    order = sorted(images, key=lambda k: (-images[k].height, k))
    x = y = 1
    shelf = 0
    rects: dict[str, tuple[int, int, int, int]] = {}
    for k in order:
        im = images[k]
        if x + im.width + 1 > width:
            x = 1
            y += shelf + 1
            shelf = 0
        rects[k] = (x, y, im.width, im.height)
        x += im.width + 1
        shelf = max(shelf, im.height)
    sheet = Image.new("RGBA", (width, y + shelf + 1), (0, 0, 0, 0))
    for k, (rx, ry, _, _) in rects.items():
        sheet.alpha_composite(images[k], (rx, ry))
    sheet = art.upscale(sheet)
    data = {
        "frames": {
            k: {
                "frame": {"x": rx * ART_SCALE, "y": ry * ART_SCALE, "w": rw * ART_SCALE, "h": rh * ART_SCALE},
                "rotated": False,
                "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": rw * ART_SCALE, "h": rh * ART_SCALE},
                "sourceSize": {"w": rw * ART_SCALE, "h": rh * ART_SCALE},
            }
            for k, (rx, ry, rw, rh) in rects.items()
        },
        "meta": {"image": "props.png", "size": {"w": sheet.width, "h": sheet.height}, "scale": "1"},
    }
    return sheet, data


os.makedirs(OUT, exist_ok=True)
art.upscale(ground.img).save(os.path.join(OUT, "ground.png"), optimize=True)
art.upscale(walls.img).save(os.path.join(OUT, "walls.png"), optimize=True)
sheet, atlas = pack(frames)
sheet.save(os.path.join(OUT, "props.png"), optimize=True)
with open(os.path.join(OUT, "props.json"), "w") as fh:
    json.dump(atlas, fh)
stale = os.path.join(OUT, "foreground.png")
if os.path.exists(stale):
    os.remove(stale)

# ---------------------------------------------------------------------------------- metadata
NPC_SLOTS = {
    "manager": {"x": 41, "y": 6, "face": "left"},
    "teammate": {"x": 16, "y": 23, "face": "down"},
    "qa": {"x": 29, "y": 22, "face": "left"},
    "client_pm": {"x": 29, "y": 8, "face": "left"},
    "coworker": {"x": 40, "y": 26, "face": "down"},
}
PETS = [
    {"sprite": "cat_white", "x": 44, "y": 27, "room": "break_area"},
    {"sprite": "cat_brown", "x": 27, "y": 24, "room": "collaboration_area"},
]
for slot in NPC_SLOTS.values():
    assert not solid[slot["y"]][slot["x"]], f"NPC slot on a solid tile: {slot}"
for oid, slot in object_slots.items():
    assert not solid[slot["y"]][slot["x"]], f"object anchor on a solid tile: {oid} {slot}"

meta = {
    "tile": T,
    "scale": ART_SCALE,
    "width": W,
    "height": H,
    "spawn": {"x": 6, "y": 8},
    "rooms": [
        {"id": rid, "x0": r[0], "y0": r[1], "x1": r[2], "y1": r[3], "floor": kind}
        for rid, r, kind, _ in ROOMS
    ],
    "npc_slots": NPC_SLOTS,
    "object_slots": object_slots,
    "props": placements,
    "pets": PETS,
    "collision": solid,
}
assert not solid[meta["spawn"]["y"]][meta["spawn"]["x"]], "spawn on a solid tile"
with open(os.path.join(OUT, "map.json"), "w") as fh:
    json.dump(meta, fh, separators=(",", ":"))

print("wrote map to", OUT)
print("world px:", W * WT, H * WT, "| atlas", sheet.size, "|", len(frames), "frames,", len(placements), "props")
