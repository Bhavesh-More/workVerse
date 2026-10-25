"""Company-built worlds: schema, server-side validation and the asset catalog they reference.

The editor (apps/web/lib/world) does the same checks live for UX; this module is the authority:
a draft must be well-formed to be saved, and must be playable to be published.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

MIN_W, MIN_H, MAX_W, MAX_H = 16, 12, 96, 72
FLOOR_CODES = {"s", "o", "w", "c", "p", "k"}
PAINTS = {"reception", "meeting", "manager", "corridor", "engineering", "collab", "break", "imocha"}
FLOORS = {"stone", "oak", "walnut", "concrete", "carpet", "checker"}
PURPOSES = {
    "reception",
    "meeting_room",
    "manager_office",
    "engineering_workspace",
    "collaboration_area",
    "break_area",
    "corridor_main",
    "other",
}
JUDGE_SLOTS = {"manager", "teammate", "qa", "client_pm", "coworker"}
PETS = {"cat_white", "cat_brown", "cat_brown2"}
LOOKS = {f"{g}{i}" for g in ("m", "f") for i in range(1, 6)}
MAX_OBJECTS = 2000
MAX_PEOPLE = 80


@lru_cache(maxsize=1)
def catalog() -> dict[str, dict[str, Any]]:
    data = json.loads((Path(__file__).parent / "catalog.json").read_text())
    return {a["id"]: a for a in data["assets"]}


class Room(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=60)
    purpose: Literal[
        "reception",
        "meeting_room",
        "manager_office",
        "engineering_workspace",
        "collaboration_area",
        "break_area",
        "corridor_main",
        "other",
    ]
    x: int
    y: int
    w: int = Field(ge=2, le=MAX_W)
    h: int = Field(ge=2, le=MAX_H)
    paint: Literal["reception", "meeting", "manager", "corridor", "engineering", "collab", "break", "imocha"]
    floor: Literal["stone", "oak", "walnut", "concrete", "carpet", "checker"]


class PlacedObject(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    asset: str = Field(min_length=1, max_length=64)
    x: int
    y: int
    ox: int | None = Field(default=None, ge=-30, le=30)
    oy: int | None = Field(default=None, ge=-30, le=30)

    @field_validator("asset")
    @classmethod
    def known_asset(cls, v: str) -> str:
        if v not in catalog():
            raise ValueError(f"unknown asset {v!r}")
        return v

    @field_validator("ox", "oy")
    @classmethod
    def even(cls, v: int | None) -> int | None:
        if v is not None and v % 2:
            raise ValueError("offsets are in whole art pixels (even world px)")
        return v


class Person(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    ref: str = Field(min_length=3, max_length=80)
    x: int
    y: int
    face: Literal["down", "left", "right", "up"] = "down"

    @field_validator("ref")
    @classmethod
    def known_kind(cls, v: str) -> str:
        kind, _, rest = v.partition(":")
        # A role slot (legacy worlds, default roster ids) or a roster judge id.
        if kind == "judge" and (rest in JUDGE_SLOTS or re.fullmatch(r"[a-z0-9_-]{1,24}", rest)):
            return v
        if kind == "pet" and rest in PETS:
            return v
        if kind == "member" and 1 <= len(rest) <= 64:
            return v
        raise ValueError(f"unknown person reference {v!r}")


class Point(BaseModel):
    x: int
    y: int


class WorldDoc(BaseModel):
    version: Literal[1]
    name: str = Field(min_length=1, max_length=80)
    width: int = Field(ge=MIN_W, le=MAX_W)
    height: int = Field(ge=MIN_H, le=MAX_H)
    floor: list[str]
    rooms: list[Room] = Field(max_length=60)
    objects: list[PlacedObject] = Field(max_length=MAX_OBJECTS)
    people: list[Person] = Field(max_length=MAX_PEOPLE)
    spawn: Point

    @model_validator(mode="after")
    def shape(self) -> WorldDoc:
        if len(self.floor) != self.height or any(len(r) != self.width for r in self.floor):
            raise ValueError("floor must be height rows of width cells")
        bad = {c for r in self.floor for c in r} - FLOOR_CODES - {"."}
        if bad:
            raise ValueError(f"unknown floor codes {sorted(bad)}")
        ids = [o.id for o in self.objects] + [p.id for p in self.people] + [r.id for r in self.rooms]
        if len(ids) != len(set(ids)):
            raise ValueError("ids must be unique")
        for o in self.objects:
            if not (-2 <= o.x < self.width and -2 <= o.y < self.height):
                raise ValueError(f"object {o.id} is outside the world")
        for p in self.people:
            if not (0 <= p.x < self.width and 0 <= p.y < self.height):
                raise ValueError(f"person {p.id} is outside the world")
        return self


class Member(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=60)
    title: str = Field(default="", max_length=60)
    look: str = "m1"

    @field_validator("look")
    @classmethod
    def known_look(cls, v: str) -> str:
        if v not in LOOKS:
            raise ValueError("unknown look")
        return v


# ------------------------------------------------------------------------------- compile-lite
def _footprint(asset: dict[str, Any], o: PlacedObject) -> tuple[int, int, int, int]:
    ox, oy = o.ox or 0, o.oy or 0
    x0 = (o.x * 32 + ox) // 32
    x1 = (o.x * 32 + ox + asset["w"] * 32 - 1) // 32
    y0 = (o.y * 32 + oy) // 32
    y1 = (o.y * 32 + oy + asset["h"] * 32 - 1) // 32
    return x0, y0, x1, y1


def collision(doc: WorldDoc) -> list[list[int]]:
    grid = [[0 if c != "." else 1 for c in row] for row in doc.floor]
    cat = catalog()
    for o in doc.objects:
        a = cat[o.asset]
        if a["mount"] != "floor" or not a["solid"]:
            continue
        x0, y0, x1, y1 = _footprint(a, o)
        for y in range(max(0, y0), min(doc.height, y1 + 1)):
            for x in range(max(0, x0), min(doc.width, x1 + 1)):
                grid[y][x] = 1
    return grid


def _face_tops(doc: WorldDoc) -> set[tuple[int, int]]:
    def floor(x: int, y: int) -> bool:
        return 0 <= x < doc.width and 0 <= y < doc.height and doc.floor[y][x] != "."

    return {(x, y - 2) for y in range(2, doc.height) for x in range(doc.width) if floor(x, y) and not floor(x, y - 1) and not floor(x, y - 2)}


def publish_errors(doc: WorldDoc, members: list[Member]) -> list[dict[str, Any]]:
    """Problems that would break the world in the game. Empty list = publishable."""
    errors: list[dict[str, Any]] = []

    def err(code: str, message: str, x: int | None = None, y: int | None = None) -> None:
        errors.append({"code": code, "message": message, "x": x, "y": y})

    cat = catalog()
    grid = collision(doc)
    sx, sy = doc.spawn.x, doc.spawn.y
    if not (0 <= sx < doc.width and 0 <= sy < doc.height) or grid[sy][sx]:
        err("spawn_blocked", "The candidate's start point isn't on open floor.", sx, sy)
        return errors

    seen = [[False] * doc.width for _ in range(doc.height)]
    stack = [(sx, sy)]
    seen[sy][sx] = True
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < doc.width and 0 <= ny < doc.height and not grid[ny][nx] and not seen[ny][nx]:
                seen[ny][nx] = True
                stack.append((nx, ny))

    faces = _face_tops(doc)
    interactive: set[str] = set()
    for o in doc.objects:
        a = cat[o.asset]
        x0, y0, x1, y1 = _footprint(a, o)
        if a["mount"] == "wall":
            if any((x, o.y) not in faces for x in range(o.x, o.x + a["w"])):
                err("wall_mount", f"{a['label']} must hang on a wall.", o.x, o.y)
        else:
            if x0 < 0 or y0 < 0 or x1 >= doc.width or y1 >= doc.height:
                err("out_of_bounds", f"{a['label']} is outside the world.", o.x, o.y)
                continue
            if any(doc.floor[y][x] == "." for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)):
                err("off_floor", f"{a['label']} is standing in a wall.", o.x, o.y)
        iid = a.get("interactive")
        if iid:
            if iid in interactive:
                err("duplicate_interactive", f"There are two {a['label']}s.", o.x, o.y)
                continue
            interactive.add(iid)
            ax = int(o.x + a["w"] / 2)
            ay = int(o.y + 2.6) if a["mount"] == "wall" else int(o.y + a["h"] + 0.6)
            if not (0 <= ax < doc.width and 0 <= ay < doc.height and seen[ay][ax]):
                err("unreachable_object", f"Candidates can't reach the front of the {a['label']}.", o.x, o.y)

    member_ids = {m.id for m in members}
    judges: set[str] = set()
    for p in doc.people:
        kind, _, rest = p.ref.partition(":")
        if kind == "member" and rest not in member_ids:
            err("unknown_person", "A placed team member no longer exists.", p.x, p.y)
            continue
        if kind == "judge":
            if rest in judges:
                err("duplicate_person", f"The {rest} judge is placed twice.", p.x, p.y)
            judges.add(rest)
        if grid[p.y][p.x]:
            err("person_blocked", "Someone is standing on a wall or furniture.", p.x, p.y)
        elif not seen[p.y][p.x]:
            err("unreachable_person", "Candidates can't walk to someone you placed.", p.x, p.y)
    for r in doc.rooms:
        if r.x < 0 or r.y < 0 or r.x + r.w > doc.width or r.y + r.h > doc.height:
            err("room_bounds", f"{r.name} goes past the edge of the world.", r.x, r.y)
    return errors


def parse_doc(raw: Any) -> WorldDoc:
    return WorldDoc.model_validate(raw)
