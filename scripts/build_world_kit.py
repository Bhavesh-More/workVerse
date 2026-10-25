"""Build the WorkVerse world kit: per-tile floors and walls plus a catalog of placeable assets.

The default office (scripts/build_office_map.py) bakes its floors and walls into two big images.
Company-built worlds can't be baked ahead of time, so this script exports the same art as
reusable pieces that the world editor and the game both assemble at runtime:

  kit/tiles.png + tiles.json   floor patches (8x8 tiles per floor kind, picked by x%8, y%8),
                               wall caps for every neighbour mask, and a wall-face column per paint
  kit/props.png + props.json   Phaser atlas of every placeable prop, wall piece and interactive
                               object (interactive ones also get a highlighted "<frame>_hl" twin)
  kit/catalog.json             what each asset is: label, category, footprint, image offsets,
                               whether it blocks movement, where it mounts, interactive object id

catalog.json is also written to apps/api/app/world/catalog.json so the API can validate saved
worlds against the same asset list.

Usage:
    python scripts/build_world_kit.py

Requires Pillow. Deterministic.
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
OUT = os.path.join(ROOT, "apps", "web", "public", "assets", "game", "kit")
API_OUT = os.path.join(ROOT, "apps", "api", "app", "world")
WT = T * ART_SCALE

FLOORS = {
    "stone": "Stone",
    "oak": "Oak planks",
    "walnut": "Walnut parquet",
    "concrete": "Polished concrete",
    "carpet": "Carpet tiles",
    "checker": "Ceramic tiles",
}
PAINTS = {
    "reception": "Warm cream / oak",
    "meeting": "Sky blue / navy",
    "manager": "Sage / walnut",
    "corridor": "Linen / sage",
    "engineering": "Cool grey / charcoal",
    "collab": "Peach / teal",
    "break": "Butter / sage",
    "imocha": "iMocha lavender / plum",
}
PATCH = 8  # floor variation period in tiles

# ------------------------------------------------------------------------------------ tiles
tile_images: dict[str, Image.Image] = {}
for kind in FLOORS:
    patch = Canvas(PATCH * T, PATCH * T)
    for y in range(PATCH):
        for x in range(PATCH):
            patch.paste(art.floor_tile(kind, x, y), x * T, y * T)
    tile_images[f"floor_{kind}"] = patch.img
for mask in range(16):
    n, s, w, e = (bool(mask & b) for b in (1, 2, 4, 8))
    tile_images[f"cap_{mask}"] = art.wall_cap({"n": n, "s": s, "w": w, "e": e}).img
for paint in PAINTS:
    tile_images[f"face_{paint}"] = art.wall_face(paint, 1).img


# ------------------------------------------------------------------------------- wall pieces
def strip(width_tiles: int) -> Canvas:
    return Canvas(width_tiles * T, 2 * T)


def window(width_tiles: int = 2, seed: int = 0) -> Canvas:
    c = strip(width_tiles)
    art.window_on_wall(c, 3, width_tiles * T - 6, seed)
    return c


def clock() -> Canvas:
    c = strip(1)
    art.clock(c, 4, 6)
    return c


def framed(scheme: int, w: int = 18, h: int = 14) -> Canvas:
    c = strip(1 if w <= 14 else 2)
    art.frame_art(c, (c.w - w) // 2, 6, w, h, scheme)
    return c


def centred(img: Canvas, dy: int) -> Canvas:
    tiles = -(-img.w // T)
    c = strip(tiles)
    c.paste(img, (c.w - img.w) // 2, dy)
    return c


def presentation() -> Canvas:
    pres = Canvas(64, 24)
    pres.box(0, 0, 63, 21, art.CHARCOAL[0])
    pres.rect(2, 2, 61, 19, art.SCREEN)
    art._screen_content(pres, 2, 2, 60, 18, "slides")
    pres.text("Q4 PLAN", 22, 9, art.NAVY[1])
    return centred(pres, 4)


def upper_cabinets(width_tiles: int = 2) -> Canvas:
    w = width_tiles * T
    c = strip(width_tiles)
    cab = Canvas(w, 14)
    cab.box(0, 0, w - 1, 13, art.SAGE[2], art.SAGE[3], art.SAGE[0])
    for i in range(width_tiles * 2):
        cab.vline(i * 8, 1, 12, art.SAGE[0])
        cab.px(i * 8 + 4, 9, art.METAL[3])
    c.paste(cab, 0, 4)
    return c


def glass_door() -> Canvas:
    c = strip(2)
    c.rect(1, 3, 30, 31, art.METAL[1])
    for x0 in (2, 16):
        c.rect(x0 + 1, 5, x0 + 12, 30, (164, 208, 228))
        for y in range(5, 31):
            if (y + x0) % 9 == 0:
                c.hline(x0 + 2, x0 + 5, y, (210, 236, 248))
        c.frame(x0, 4, x0 + 13, 31, art.OUT, round_corners=False)
    c.rect(13, 16, 13, 21, art.METAL[3])
    c.rect(18, 16, 18, 21, art.METAL[3])
    return c


def bulletin() -> Canvas:
    c = Canvas(28, 18)
    c.box(0, 0, 27, 17, art.OAK[1], art.OAK[2], art.OAK[0])
    c.rect(2, 2, 25, 15, (196, 160, 118))
    for i, (x, y) in enumerate(((4, 4), (12, 3), (19, 5), (6, 10), (15, 10))):
        c.rect(x, y, x + 5, y + 4, art.STICKY[i % 4])
    return centred(c, 5)


# ------------------------------------------------------------------------------------ catalog
frames: dict[str, Image.Image] = {}
catalog: list[dict] = []


def add(
    aid: str,
    label: str,
    category: str,
    built: art.Prop | Canvas,
    *,
    mount: str = "floor",
    solid: bool = True,
    interactive: str | None = None,
    tags: tuple[str, ...] = (),
    dx: int = 0,
) -> None:
    """Register an asset. Floor props come as (canvas, footprint w, footprint h); their art sits
    with its bottom on the footprint's bottom edge (it may rise above it, like a bookshelf).
    Wall pieces are face strips (w tiles x 2 tiles) whose top-left is the wall face's top cell."""
    if isinstance(built, tuple):
        canvas, fw, fh = built
    else:
        canvas = built
        fw, fh = canvas.w // T, 2
    frames[aid] = canvas.img
    if interactive:
        frames[f"{aid}_hl"] = art.outline_highlight(canvas.img)
    entry = {
        "id": aid,
        "label": label,
        "category": category,
        "mount": mount,
        "w": fw,
        "h": fh,
        "frame": aid,
        "img_w": canvas.w * ART_SCALE,
        "img_h": canvas.h * ART_SCALE,
        # image top-left relative to the footprint's top-left, in world px
        "ox": dx * ART_SCALE,
        "oy": (fh * T - canvas.h) * ART_SCALE if mount == "floor" else 0,
        "solid": solid,
    }
    if interactive:
        entry["interactive"] = interactive
    if tags:
        entry["tags"] = list(tags)
    catalog.append(entry)


# Desks & workstations
add("desk_s_code", "Desk · screens facing you", "desks", art.desk("code", "s", 0), tags=("workstation", "computer"))
add("desk_s_logs", "Desk · dashboards", "desks", art.desk("graph", "s", 1), tags=("workstation", "computer"))
add("desk_n", "Desk · back view", "desks", art.desk(facing="n", items=0), tags=("workstation", "computer"))
add("desk_n2", "Desk · back view, papers", "desks", art.desk(facing="n", items=1), tags=("workstation",))
add("desk_walnut", "Desk · walnut", "desks", art.desk("code", "s", 2, art.WALNUT), tags=("workstation", "computer"))
add("exec_desk", "Executive desk", "desks", art.exec_desk(), tags=("manager", "office"))
# Seating
add("chair_s", "Office chair · facing you", "seating", art.chair("s"), dx=8)
add("chair_n", "Office chair · facing away", "seating", art.chair("n"), dx=8)
add("chair_s_teal", "Teal chair · facing you", "seating", art.chair("s", art.TEAL))
add("chair_n_teal", "Teal chair · facing away", "seating", art.chair("n", art.TEAL))
add("chair_e", "Teal chair · facing right", "seating", art.chair("e", art.TEAL))
add("chair_w", "Teal chair · facing left", "seating", art.chair("w", art.TEAL))
add("armchair_coral", "Armchair · coral", "seating", art.armchair(art.CORAL), tags=("lounge",))
add("armchair_mustard", "Armchair · mustard", "seating", art.armchair(art.MUSTARD), tags=("lounge",))
add("armchair_navy", "Armchair · navy", "seating", art.armchair(art.NAVY), tags=("lounge",))
add("armchair_mustard_n", "Armchair · mustard, back", "seating", art.armchair(art.MUSTARD, "n"), tags=("lounge",))
add("armchair_navy_n", "Armchair · navy, back", "seating", art.armchair(art.NAVY, "n"), tags=("lounge",))
add("sofa_s_teal", "Sofa · teal", "seating", art.sofa(3, art.TEAL, "s"), tags=("lounge", "couch"))
add("sofa_n_mustard", "Sofa · mustard, back", "seating", art.sofa(3, art.MUSTARD, "n"), tags=("lounge", "couch"))
add("sofa_s_coral", "Sofa · coral", "seating", art.sofa(3, art.CORAL, "s"), tags=("lounge", "couch"))
add("stool", "Stool · coral", "seating", art.stool(art.CORAL))
add("stool_teal", "Stool · teal", "seating", art.stool(art.TEAL))
add("beanbag_coral", "Beanbag · coral", "seating", art.beanbag(art.CORAL), tags=("lounge",))
add("beanbag_teal", "Beanbag · teal", "seating", art.beanbag(art.TEAL), tags=("lounge",))
# Tables
add("meeting_table", "Meeting table · 8 seats", "tables", art.long_table(8, 2), tags=("conference",))
add("meeting_table_6", "Meeting table · 6 seats", "tables", art.long_table(6, 2), tags=("conference",))
add("meeting_table_4", "Meeting table · 4 seats", "tables", art.long_table(4, 2), tags=("conference",))
add("low_table3", "Coffee table", "tables", art.low_table(3, art.OAK, "coffee"), tags=("lounge",))
add("low_table2", "Side table", "tables", art.low_table(2, art.OAK, "magazines"), tags=("lounge",))
add("round_table", "Café table", "tables", art.round_table(), tags=("cafe",))
add("round_table_plain", "Round table", "tables", art.round_table(items=False))
# Storage
add("bookshelf", "Bookshelf", "storage", art.bookshelf(2, 0), tags=("books",))
add("bookshelf_b", "Bookshelf · binders", "storage", art.bookshelf(2, 4), tags=("books",))
add("cabinet", "Filing cabinet", "storage", art.cabinet())
add("cabinet_teal", "Filing cabinet · teal", "storage", art.cabinet(art.TEAL))
add("coat_rack", "Coat rack", "storage", art.coat_rack())
# Kitchen
add("counter", "Kitchen counter", "kitchen", art.counter("plain"))
add("counter_sink", "Counter · sink", "kitchen", art.counter("sink"))
add("counter_fruit", "Counter · fruit bowl", "kitchen", art.counter("fruit"))
add("fridge", "Fridge", "kitchen", art.fridge())
add("vending", "Vending machine", "kitchen", art.vending())
add("water_cooler", "Water cooler", "kitchen", art.water_cooler())
# Tech
add("server_rack", "Server rack", "tech", art.server_rack(0), tags=("lab", "ops"))
add("server_rack_b", "Server rack · busy", "tech", art.server_rack(1), tags=("lab", "ops"))
add("printer", "Printer", "tech", art.printer())
add("trash", "Bin", "tech", art.trash_bin())
# Plants & decor
add("plant_tall", "Tall plant", "plants", art.plant("tall"))
add("plant_tall_b", "Tall plant · fig", "plants", art.plant("tall", 3))
add("plant_small", "Small plant", "plants", art.plant("small"))
add("plant_snake", "Snake plant", "plants", art.plant("snake"))
add("cat_bed", "Cat bed", "plants", art.cat_bed(), solid=False, tags=("pet",))
# Wall pieces (mounted on a wall face)
add("window_2", "Window", "wall", window(2, 1), mount="wall", solid=False)
add("window_3", "Wide window", "wall", window(3, 2), mount="wall", solid=False)
add("clock", "Wall clock", "wall", clock(), mount="wall", solid=False)
add("art_sea", "Framed print · sea", "wall", framed(0, 12, 14), mount="wall", solid=False)
add("art_hills", "Framed print · hills", "wall", framed(1, 18, 14), mount="wall", solid=False)
add("art_sunset", "Framed print · sunset", "wall", framed(2, 12, 14), mount="wall", solid=False)
add("art_city", "Framed print · city", "wall", framed(3, 24, 14), mount="wall", solid=False)
add("logo_sign", "Company logo sign", "wall", centred(art.logo_sign(), 7), mount="wall", solid=False)
add("presentation", "Presentation screen", "wall", presentation(), mount="wall", solid=False)
add("upper_cabinets", "Wall cabinets", "wall", upper_cabinets(2), mount="wall", solid=False)
add("glass_door", "Glass door (decor)", "wall", glass_door(), mount="wall", solid=False)
add("bulletin", "Notice board", "wall", bulletin(), mount="wall", solid=False)
# Interactive objects: the incident scenario's tools. One of each per world.
add("obj_incident_dashboard", "Incident dashboard (TV)", "interactive", centred(art.wall_tv(), 3), mount="wall", solid=False, interactive="incident_dashboard")
add("obj_migration_notes", "Release notes pinboard", "interactive", centred(art.pinboard(), 6), mount="wall", solid=False, interactive="migration_notes")
add("obj_meeting_whiteboard", "Whiteboard", "interactive", centred(art.whiteboard(48), 4), mount="wall", solid=False, interactive="meeting_whiteboard")
add("obj_log_viewer", "Log console", "interactive", art.standing_console("logs"), interactive="log_viewer")
add("obj_metrics_panel", "Metrics console", "interactive", art.standing_console("graph"), interactive="metrics_panel")
add("obj_deploy_console", "Deploy console", "interactive", art.standing_console("pipeline"), interactive="deploy_console")
add("obj_runbook", "Runbook lectern", "interactive", art.lectern_runbook(), interactive="runbook")
add("obj_team_board", "Task board", "interactive", art.kanban_board(), interactive="team_board")
add("obj_coffee_machine", "Coffee station", "interactive", art.coffee_station(), interactive="coffee_machine")
add("obj_reception_desk", "Reception desk", "interactive", art.reception_desk(), interactive="reception_desk")

# iMocha partner kit: signage for a reception partner wall or an iMocha Hub room.
add("imocha_sign", "iMocha partner sign", "wall", centred(art.imocha_cobrand(), 6), mount="wall", solid=False, tags=("imocha", "logo", "brand"))
add("imocha_hub_sign", "iMocha Hub sign", "wall", centred(art.imocha_hub_sign(), 1), mount="wall", solid=False, tags=("imocha", "logo", "brand"))
add("imocha_plaque", "iMocha Hub plaque", "wall", centred(art.imocha_plaque("IMOCHA HUB"), 6), mount="wall", solid=False, tags=("imocha", "sign"))
add("imocha_standee", "iMocha standee", "imocha", art.imocha_standee(), tags=("imocha", "brand", "banner"))
add("imocha_screen", "iMocha Hub screen", "imocha", art.imocha_screen(), interactive="imocha_hub", tags=("imocha", "screen", "kiosk"))


# ------------------------------------------------------------------------------------ packing
def pack(images: dict[str, Image.Image], width: int) -> tuple[Image.Image, dict[str, tuple[int, int, int, int]]]:
    """Shelf-pack at art scale with 1px gutters, then upscale. Returns sheet and world-px rects."""
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
    scaled = {k: (rx * ART_SCALE, ry * ART_SCALE, rw * ART_SCALE, rh * ART_SCALE) for k, (rx, ry, rw, rh) in rects.items()}
    return art.upscale(sheet), scaled


os.makedirs(OUT, exist_ok=True)
os.makedirs(API_OUT, exist_ok=True)

tiles_sheet, tile_rects = pack(tile_images, 512)
tiles_sheet.save(os.path.join(OUT, "tiles.png"), optimize=True)
tiles_meta = {
    "tile": WT,
    "patch": PATCH,
    "floors": {k: {"x": tile_rects[f"floor_{k}"][0], "y": tile_rects[f"floor_{k}"][1]} for k in FLOORS},
    "caps": {str(m): {"x": tile_rects[f"cap_{m}"][0], "y": tile_rects[f"cap_{m}"][1]} for m in range(16)},
    "faces": {p: {"x": tile_rects[f"face_{p}"][0], "y": tile_rects[f"face_{p}"][1]} for p in PAINTS},
}
with open(os.path.join(OUT, "tiles.json"), "w") as fh:
    json.dump(tiles_meta, fh, separators=(",", ":"))

props_sheet, prop_rects = pack(frames, 512)
props_sheet.save(os.path.join(OUT, "props.png"), optimize=True)
atlas = {
    "frames": {
        k: {
            "frame": {"x": x, "y": y, "w": w, "h": h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
        }
        for k, (x, y, w, h) in prop_rects.items()
    },
    "meta": {"image": "props.png", "size": {"w": props_sheet.width, "h": props_sheet.height}, "scale": "1"},
}
with open(os.path.join(OUT, "props.json"), "w") as fh:
    json.dump(atlas, fh, separators=(",", ":"))

catalog_doc = {
    "version": 1,
    "tile": WT,
    "floors": [{"id": k, "label": v} for k, v in FLOORS.items()],
    "paints": [{"id": k, "label": v} for k, v in PAINTS.items()],
    "assets": catalog,
}
for path in (os.path.join(OUT, "catalog.json"), os.path.join(API_OUT, "catalog.json")):
    with open(path, "w") as fh:
        json.dump(catalog_doc, fh, indent=1)

print("wrote kit to", OUT)
print("tiles", tiles_sheet.size, "| props", props_sheet.size, "|", len(catalog), "assets,", len(frames), "frames")
