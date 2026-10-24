"""Company worlds: schema, integrity checks and the publish gate (fixture made by the web editor's
layout generator, so the two implementations are checked against each other)."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app import world as W

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "world_all_presets.json").read_text())
MEMBERS = [W.Member.model_validate(m) for m in FIXTURE["members"]]


def doc() -> dict:
    return copy.deepcopy(FIXTURE["doc"])


def test_editor_layout_is_valid_and_publishable():
    parsed = W.parse_doc(doc())
    assert parsed.width == FIXTURE["doc"]["width"]
    assert W.publish_errors(parsed, MEMBERS) == []


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda d: d["objects"].append({"id": "x1", "asset": "../../etc/passwd", "x": 1, "y": 1}), "unknown asset"),
        (lambda d: d.__setitem__("width", 500), "less than or equal"),
        (lambda d: d["floor"].__setitem__(0, "Z" * d["width"]), "unknown floor codes"),
        (lambda d: d["floor"].pop(), "height rows"),
        (lambda d: d["people"].append({"id": "p9", "ref": "admin:root", "x": 1, "y": 1}), "unknown person reference"),
        (lambda d: d["objects"].append({"id": d["objects"][0]["id"], "asset": "trash", "x": 1, "y": 1}), "unique"),
        (lambda d: d["objects"].append({"id": "x2", "asset": "trash", "x": 9999, "y": 1}), "outside the world"),
        (lambda d: d["objects"].append({"id": "x3", "asset": "trash", "x": 1, "y": 1, "ox": 3}), "even"),
    ],
)
def test_invalid_documents_are_rejected(mutate, message):
    d = doc()
    mutate(d)
    with pytest.raises(ValidationError) as exc:
        W.parse_doc(d)
    assert message in str(exc.value)


def _codes(d: dict, members=MEMBERS) -> set[str]:
    return {e["code"] for e in W.publish_errors(W.parse_doc(d), members)}


def test_publish_gate_catches_unplayable_worlds():
    d = doc()
    # Spawn inside a wall.
    d["spawn"] = {"x": 0, "y": 0}
    assert _codes(d) == {"spawn_blocked"}

    d = doc()
    # Second incident dashboard, a clock on the floor, a judge standing in a wall.
    room = next(r for r in d["rooms"] if r["purpose"] == "engineering_workspace")
    d["objects"].append({"id": "dup", "asset": "obj_incident_dashboard", "x": room["x"] + 9, "y": room["y"] - 2})
    d["objects"].append({"id": "clk", "asset": "clock", "x": room["x"] + 3, "y": room["y"] + 4})
    manager = next(p for p in d["people"] if p["ref"] == "judge:manager")
    manager["x"], manager["y"] = 0, 0
    codes = _codes(d)
    assert {"duplicate_interactive", "wall_mount", "person_blocked"} <= codes


def test_walling_off_a_room_makes_its_people_unreachable():
    d = doc()
    lounge = next(r for r in d["rooms"] if r["purpose"] == "break_area")
    # Turn the whole wall band around the lounge back into wall (closes its doorway).
    rows = [list(r) for r in d["floor"]]
    for y in range(max(0, lounge["y"] - 3), min(d["height"], lounge["y"] + lounge["h"] + 3)):
        for x in range(lounge["x"], lounge["x"] + lounge["w"]):
            inside = lounge["y"] <= y < lounge["y"] + lounge["h"]
            if not inside:
                rows[y][x] = "."
    d["floor"] = ["".join(r) for r in rows]
    codes = _codes(d)
    assert "unreachable_person" in codes or "unreachable_object" in codes


def test_removed_member_is_an_error():
    assert "unknown_person" in _codes(doc(), members=[])


def test_member_validation():
    with pytest.raises(ValidationError):
        W.Member.model_validate({"id": "bad id!", "name": "X"})
    with pytest.raises(ValidationError):
        W.Member.model_validate({"id": "ok", "name": "X", "look": "z9"})
    assert W.Member.model_validate({"id": "ok", "name": "X", "look": "f3"}).look == "f3"


def test_catalog_matches_the_editor():
    cat = W.catalog()
    assert len(cat) >= 70
    assert sum(1 for a in cat.values() if a.get("interactive")) == 10
