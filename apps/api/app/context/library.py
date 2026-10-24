"""The approved scenario library the planner may pick from: every role track's incident types."""

from __future__ import annotations

from typing import Any

from app.simulation.tracks import TRACKS

# What each track's situations train, in words a model (and a learner) can match against a CV.
TRACK_ROLES = {
    "backend": "backend, platform, API and on-call engineers",
    "frontend": "frontend, mobile, web and QA engineers",
    "data": "data analysts, data/ML engineers and data scientists",
    "product": "product managers, designers, growth and business roles",
}


def library() -> list[dict[str, Any]]:
    """[{track, incident, title, track_label, for_roles}] — 3 incident types per track."""
    out = []
    for track, t in TRACKS.items():
        for incident, title in [("base", t["title"]), *((v["id"], v["title"]) for v in t.get("variants", []))]:
            out.append(
                {
                    "track": track,
                    "incident": incident,
                    "title": title,
                    "track_label": t["label"],
                    "for_roles": TRACK_ROLES[track],
                }
            )
    return out


def entry(track: str, incident: str) -> dict[str, Any] | None:
    return next((e for e in library() if e["track"] == track and e["incident"] == incident), None)
