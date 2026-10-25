"""Build the WorkVerse cast: recoloured character sheets and pet sheets, exported at ART_SCALE.

Humans come from the PixelSerial RPG bases (the `_shadow` variants, so every character carries the
same soft contact shadow). Each cast member is a palette swap — hair, skin, top and trousers — so
the whole office reads as one art style while every colleague is recognisable at a glance.

Sheet layout (unchanged from the source): 4 columns x 8 rows of 32x32 art-px frames.
  rows 0-3 idle (down, left, right, up), rows 4-7 walk (down, left, right, up)
Exported at ART_SCALE -> 64x64 world-px frames.

Pets come from the Neko Office cats: rows idle-down, idle-up, idle-side, walk-down, walk-up,
walk-side (idle rows have 3 frames, walk rows 4), 16px frames -> 32px.

Usage:
    python scripts/build_characters.py
"""

from __future__ import annotations

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from office_art import ART_SCALE, upscale  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RPG = os.path.join(ROOT, "assets", "RPG Top Down Characters - Free Version")
NEKO = os.path.join(ROOT, "assets", "Neko Office Asset Pack", "Characters")
OUT = os.path.join(ROOT, "apps", "web", "public", "assets", "game", "chars")

FRAME = 32
PANTS_FROM_Y = 27  # in-frame row where the woman base's trousers start (they reuse hair colours)

# Source palette roles.
MAN = {
    "hair": [(251, 107, 29), (247, 150, 23), (249, 194, 43)],  # dark, main, light
    "skin": [(252, 167, 144), (253, 203, 176)],  # shade, light
    "top": [(174, 35, 52), (232, 59, 59)],  # dark, main
    "pants": [(158, 69, 57), (205, 104, 61)],
}
WOMAN = {
    "hair": [(50, 51, 83), (72, 74, 119), (77, 101, 180)],
    "skin": [(246, 129, 129), (252, 167, 144)],
    "top": [(249, 194, 43), (232, 59, 59)],  # accent, main
}

HAIR = {
    "black": [(30, 28, 38), (50, 46, 62), (80, 76, 98)],
    "darkbrown": [(58, 36, 30), (88, 56, 40), (124, 84, 56)],
    "brown": [(92, 58, 36), (134, 88, 52), (176, 124, 78)],
    "auburn": [(118, 44, 30), (168, 72, 42), (210, 110, 62)],
    "blonde": [(190, 134, 48), (230, 182, 78), (248, 222, 132)],
    "grey": [(112, 112, 124), (160, 160, 172), (206, 206, 216)],
}
SKIN = {
    "s1": [(238, 168, 140), (253, 212, 184)],
    "s2": [(220, 150, 112), (240, 186, 146)],
    "s3": [(176, 112, 76), (204, 146, 104)],
    "s4": [(112, 70, 50), (146, 96, 66)],
}
TOP = {
    "teal": [(26, 112, 104), (48, 164, 150)],
    "navy": [(34, 46, 90), (62, 86, 144)],
    "mustard": [(168, 116, 30), (224, 172, 60)],
    "sage": [(68, 102, 76), (112, 152, 108)],
    "plum": [(90, 50, 96), (142, 88, 142)],
    "coral": [(168, 60, 58), (224, 104, 86)],
    "sky": [(52, 98, 160), (96, 152, 214)],
    "white": [(176, 182, 196), (232, 234, 240)],
}
PANTS = {
    "denim": [(40, 52, 92), (64, 82, 132)],
    "charcoal": [(38, 38, 50), (66, 66, 82)],
    "khaki": [(132, 104, 66), (176, 146, 98)],
    "brown": [(84, 56, 44), (122, 84, 62)],
}

# id: (base, hair, skin, top, pants)
CAST = {
    "player": ("man", "darkbrown", "s2", "teal", "charcoal"),
    "m1": ("man", "black", "s3", "navy", "khaki"),
    "m2": ("man", "brown", "s1", "sage", "denim"),
    "m3": ("man", "auburn", "s1", "mustard", "charcoal"),
    "m4": ("man", "grey", "s4", "coral", "denim"),
    "m5": ("man", "black", "s4", "sky", "charcoal"),
    "f1": ("woman", "black", "s2", "plum", "charcoal"),
    "f2": ("woman", "brown", "s3", "mustard", "denim"),
    "f3": ("woman", "blonde", "s1", "sky", "charcoal"),
    "f4": ("woman", "auburn", "s4", "sage", "khaki"),
    "f5": ("woman", "darkbrown", "s3", "coral", "denim"),
}


def recolor(base: str, hair: str, skin: str, top: str, pants: str) -> Image.Image:
    if base == "man":
        src = Image.open(os.path.join(RPG, "Blonde Man", "blonde_man_shadow.png")).convert("RGBA")
        mapping = {}
        for role, new in (("hair", HAIR[hair]), ("skin", SKIN[skin]), ("top", TOP[top]), ("pants", PANTS[pants])):
            for old, col in zip(MAN[role], new):
                mapping[old] = col
        out = src.copy()
        px = out.load()
        for y in range(out.height):
            for x in range(out.width):
                p = px[x, y]
                if p[3] and p[:3] in mapping:
                    px[x, y] = (*mapping[p[:3]], p[3])
        return out
    src = Image.open(os.path.join(RPG, "Blue Haired Woman", "blue_haired_woman_shadow.png")).convert("RGBA")
    hair_map = dict(zip(WOMAN["hair"], HAIR[hair]))
    pants_map = {WOMAN["hair"][0]: PANTS[pants][0], WOMAN["hair"][1]: PANTS[pants][1]}
    skin_map = dict(zip(WOMAN["skin"], SKIN[skin]))
    top_map = {WOMAN["top"][1]: TOP[top][1], WOMAN["top"][0]: TOP[top][0]}
    out = src.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            p = px[x, y]
            if not p[3]:
                continue
            rgb = p[:3]
            if rgb in hair_map:
                in_pants = (y % FRAME) >= PANTS_FROM_Y and rgb in pants_map
                px[x, y] = (*(pants_map[rgb] if in_pants else hair_map[rgb]), p[3])
            elif rgb in skin_map:
                px[x, y] = (*skin_map[rgb], p[3])
            elif rgb in top_map:
                px[x, y] = (*top_map[rgb], p[3])
    return out


def cat_sheet(color: str) -> Image.Image:
    rows = [("front", "idle"), ("back", "idle"), ("side", "idle"), ("front", "walk"), ("back", "walk"), ("side", "walk")]
    sheet = Image.new("RGBA", (16 * 4, 16 * len(rows)), (0, 0, 0, 0))
    for r, (d, k) in enumerate(rows):
        strip = Image.open(os.path.join(NEKO, f"cat-office-{color}-{d}-{k}.png")).convert("RGBA")
        sheet.alpha_composite(strip, (0, r * 16))
    return sheet


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for cid, spec in CAST.items():
        upscale(recolor(*spec)).save(os.path.join(OUT, f"{cid}.png"), optimize=True)
    for color in ("white", "brown", "brown2"):
        upscale(cat_sheet(color)).save(os.path.join(OUT, f"cat_{color}.png"), optimize=True)
    for stale in ("blonde_man.png", "blue_haired_woman.png"):
        path = os.path.join(OUT, stale)
        if os.path.exists(path):
            os.remove(path)
    manifest = {
        "frame": FRAME * ART_SCALE,
        "male": [k for k, v in CAST.items() if v[0] == "man" and k != "player"],
        "female": [k for k, v in CAST.items() if v[0] == "woman"],
        "pets": ["cat_white", "cat_brown", "cat_brown2"],
    }
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
