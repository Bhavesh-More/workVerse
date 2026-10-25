"""Assessment-wise results: how a company's assessments compare, as a one-page summary or in detail.

Summary: one page comparing every selected assessment (score spread, band mix, completion, a
table with each round's numbers, and computed insights). Detailed: that page, then for each
assessment its one-page group summary followed by the full ranking of everyone invited.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from statistics import median
from typing import Any, Literal

import numpy as np
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    CondPageBreak,
    KeepInFrame,
    PageBreak,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.company.candidate_report import _Marker
from app.company.cohort_report import BAND_ORDER, FRAME_H, make_doc, summary_page
from app.company.report_pdf import (
    BAND_COLORS,
    CONTENT_W,
    HAIR,
    INK,
    MIST,
    MUTED,
    OTHER,
    S,
    _band_pill,
    _esc,
    _png,
    _table_style,
    plt,
)

MAX_ROWS = 12  # assessments shown on the one-page comparison; the rest are in the detailed report


def _stats(item: dict[str, Any]) -> dict[str, Any]:
    rows, sm = item["rows"], item["sm"]
    done = sorted([r for r in rows if r["status"] == "completed" and r["score"] is not None], key=lambda r: -r["score"])
    scores = [r["score"] for r in done]
    bands = {label: sum(1 for r in done if (r["band"] or {}).get("label") == label) for label in BAND_ORDER}
    return {
        "title": item["assessment"]["title"],
        "status": item["assessment"].get("status", "active"),
        "due_at": item["assessment"].get("due_at"),
        "invited": sm["total"],
        "completed": len(done),
        "rate": sm["completion_rate"],
        "median": round(median(scores), 1) if scores else None,
        "q1q3": tuple(np.percentile(scores, [25, 75])) if len(scores) >= 2 else None,
        "advance": bands["Strong"] + bands["Good"],
        "bands": bands,
        "top": done[0] if done else None,
        "skills": {s["name"]: s["average"] for s in sm["skills"] if s["average"] is not None},
    }


# ---------------------------------------------------------------- chart


def _comparison(stats: list[dict[str, Any]]) -> Any:
    """One row per assessment: score spread (middle half + median) | band mix | completion."""
    n = len(stats)
    fig, (a1, a2, a3) = plt.subplots(1, 3, figsize=(7.2, 0.42 * n + 0.9), gridspec_kw={"width_ratios": [3.2, 2.6, 1.3]}, sharey=True)
    y = list(range(n))[::-1]
    labels = [s["title"] if len(s["title"]) <= 34 else s["title"][:33] + "…" for s in stats]
    for yi, s in zip(y, stats, strict=False):
        a1.barh(yi, 100, color=MIST, height=0.55)
        if s["q1q3"]:
            q1, q3 = s["q1q3"]
            a1.barh(yi, max(q3 - q1, 1.5), left=q1, color=OTHER, height=0.55)
        if s["median"] is not None:
            a1.scatter([s["median"]], [yi], color=INK, s=24, zorder=3)
            a1.text(103, yi, f"{s['median']:g}", va="center", fontsize=7.5, fontweight="bold")
        else:
            a1.text(3, yi, "no results yet", va="center", fontsize=7, color=MUTED)
        total = sum(s["bands"].values())
        left = 0.0
        for label in BAND_ORDER:
            c = s["bands"][label]
            if total and c:
                a2.barh(yi, c / total, left=left, color=BAND_COLORS[label], height=0.55, edgecolor="white", linewidth=0.8)
                left += c / total
        if not total:
            a2.barh(yi, 1, color=MIST, height=0.55)
        a3.barh(yi, 100, color=MIST, height=0.55)
        a3.barh(yi, s["rate"], color=INK, height=0.55)
        a3.text(104, yi, f"{s['rate']}%", va="center", fontsize=7.5)
    a1.set_yticks(y, labels, fontsize=7.5)
    a1.set_xlim(0, 100)
    a1.set_xticks([0, 50, 65, 80, 100])
    a1.set_title("Score: median ● and middle half", fontsize=8, loc="left", color=MUTED)
    a2.set_xlim(0, 1)
    a2.set_xticks([])
    a2.set_title("Band mix", fontsize=8, loc="left", color=MUTED)
    a3.set_xlim(0, 100)
    a3.set_xticks([])
    a3.set_title("Completed", fontsize=8, loc="left", color=MUTED)
    for ax in (a1, a2, a3):
        ax.tick_params(axis="y", length=0)
        ax.tick_params(axis="x", labelsize=7)
        ax.spines["left"].set_visible(False)
    for ax in (a2, a3):
        ax.spines["bottom"].set_visible(False)
    fig.subplots_adjust(wspace=0.12)
    return fig


# ---------------------------------------------------------------- insights


def insights(stats: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    scored = [s for s in stats if s["median"] is not None and s["completed"] >= 2]
    if len(scored) >= 2:
        hi = max(scored, key=lambda s: s["median"])
        lo = min(scored, key=lambda s: s["median"])
        if hi["median"] - lo["median"] >= 5:
            out.append(f"Highest median score: <b>{_esc(hi['title'])}</b> ({hi['median']:g}); lowest: <b>{_esc(lo['title'])}</b> ({lo['median']:g}).")
    invited = [s for s in stats if s["invited"]]
    if len(invited) >= 2:
        worst = min(invited, key=lambda s: s["rate"])
        if worst["rate"] < 60 and worst["completed"]:
            out.append(f"Lowest completion: <b>{_esc(worst['title'])}</b> — {worst['completed']} of {worst['invited']} finished ({worst['rate']}%). A reminder may help.")
    adv = sorted((s for s in stats if s["advance"]), key=lambda s: -s["advance"])
    if adv:
        out.append(f"Most candidates to advance: <b>{_esc(adv[0]['title'])}</b> ({adv[0]['advance']} Strong or Good).")
    empty = [s["title"] for s in stats if s["invited"] and not s["completed"]]
    if empty:
        more = f" and {len(empty) - 3} more" if len(empty) > 3 else ""
        out.append(f"No results yet in {len(empty)} assessment{'s' if len(empty) != 1 else ''}: {_esc(', '.join(empty[:3]))}{more}.")
    now = datetime.now(UTC)
    overdue = [s["title"] for s in stats if s["status"] == "active" and s["due_at"] and s["due_at"] <= now]
    if overdue:
        out.append(f"Deadline passed but still open: {_esc(', '.join(overdue[:3]))}. Close them or move the date.")
    skills: dict[str, list[float]] = {}
    for s in stats:
        for name, avg in s["skills"].items():
            skills.setdefault(name, []).append(avg)
    if len(skills) >= 2 and len(scored) >= 2:
        means = {k: sum(v) / len(v) for k, v in skills.items()}
        weakest = min(means, key=means.get)  # type: ignore[arg-type]
        out.append(f"Across all assessments the weakest skill is <b>{_esc(weakest)}</b> (avg {means[weakest]:.0f}).")
    return out[:5] or ["Not enough completed results yet to compare assessments."]


# ---------------------------------------------------------------- pages


def _kpis(items: list[tuple[str, str, str]]) -> Table:
    cells = [[Paragraph(_esc(a).upper(), S["kpil"]), Paragraph(b, S["kpi"]), Paragraph(_esc(c), S["muted"])] for a, b, c in items]
    t = Table([cells], colWidths=[CONTENT_W / len(items)] * len(items))
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(MIST)), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LINEAFTER", (0, 0), (-2, -1), 2, colors.white)]))
    return t


def _due(v: Any) -> str:
    return v.strftime("%d %b %Y") if v else "—"


def comparison_page(company: str, items: list[dict[str, Any]], *, detailed: bool) -> KeepInFrame:
    stats = [_stats(i) for i in items]
    shown = stats[:MAX_ROWS]
    all_rows = [r for i in items for r in i["rows"]]
    done = [r["score"] for r in all_rows if r["status"] == "completed" and r["score"] is not None]
    invited = sum(s["invited"] for s in stats)
    completed = sum(s["completed"] for s in stats)
    advance = sum(s["advance"] for s in stats)
    content: list[Any] = [
        _Marker("Comparison"),
        Paragraph(f"{_esc(company).upper()} · ASSESSMENT RESULTS · {datetime.now(UTC).strftime('%d %b %Y').upper()}", S["eyebrow"]),
        Spacer(1, 3),
        Paragraph("Assessment results", S["h1"]),
        Paragraph(f"{len(stats)} assessment{'s' if len(stats) != 1 else ''} compared · {invited} invited · {completed} completed", S["muted"]),
        Spacer(1, 8),
        _kpis(
            [
                ("Assessments", str(len(stats)), f"{sum(1 for s in stats if s['status'] == 'active')} open"),
                ("Invited", str(invited), "candidates"),
                ("Completed", str(completed), f"{round(100 * completed / invited) if invited else 0}% of invited"),
                ("Median score", f"{round(median(done), 1):g}" if done else "—", "across all completed"),
                ("To advance", str(advance), "Strong or Good"),
            ]
        ),
        Spacer(1, 10),
        Paragraph("How the assessments compare", S["h3"]),
        Paragraph("Each row is one assessment. Score: dot = median, grey bar = middle half of candidates. Band mix: share of completed candidates in each band.", S["muted"]),
        Spacer(1, 2),
        _png(_comparison(shown), CONTENT_W),
        Paragraph(" &nbsp; ".join(_band_pill(b) for b in BAND_ORDER), S["cell"]),
        Spacer(1, 8),
    ]
    head = ["Assessment", "Status", "Due", "Invited", "Completed", "Median", "Advance", "Top candidate"]
    data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in head]]
    for s in shown:
        top = s["top"]
        data.append(
            [
                Paragraph(f"<b>{_esc(s['title'])}</b>", S["cell"]),
                Paragraph("Open" if s["status"] == "active" else "Closed", S["cell"]),
                Paragraph(_due(s["due_at"]), S["cell"]),
                Paragraph(str(s["invited"]), S["cell"]),
                Paragraph(f"{s['completed']} <font color='{MUTED}'>({s['rate']}%)</font>", S["cell"]),
                Paragraph(f"<b>{s['median']:g}</b>" if s["median"] is not None else "—", S["cell"]),
                Paragraph(str(s["advance"]), S["cell"]),
                Paragraph(f"{_esc(top['name'])} <font color='{MUTED}'>{top['score']:g}</font>" if top else "—", S["cell"]),
            ]
        )
    t = Table(data, colWidths=[CONTENT_W - 138 * mm, 14 * mm, 20 * mm, 14 * mm, 22 * mm, 14 * mm, 18 * mm, 36 * mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(MIST)), ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(HAIR)), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5), ("LEFTPADDING", (0, 0), (-1, -1), 4)]))
    content.append(t)
    if len(stats) > MAX_ROWS:
        content.append(Paragraph(f"+ {len(stats) - MAX_ROWS} more assessments" + (" follow in this report." if detailed else " in the detailed report."), S["muted"]))
    box = Table([[[Paragraph("KEY INSIGHTS", S["kpil"]), Spacer(1, 3), *[Paragraph(f"• {line}", S["body"]) for line in insights(stats)]]]], colWidths=[CONTENT_W])
    box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fff8dc")), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    content += [Spacer(1, 8), box]
    if detailed:
        content += [Spacer(1, 6), Paragraph("The following pages give each assessment's own summary and the full ranking of everyone invited.", S["muted"])]
    return KeepInFrame(CONTENT_W, FRAME_H, content, mode="shrink")


def _skills_text(names: list[str]) -> str:
    return "All five skills" if len(names) >= 5 else ", ".join(names) or "—"


def _ranking(item: dict[str, Any]) -> list[Any]:
    rows = sorted(item["rows"], key=lambda r: (r["score"] is None, -(r["score"] or 0)))
    head = ["#", "Candidate", "Status", "Score", "Band", "Strengths", "Areas to probe"]
    data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in head]]
    for i, r in enumerate(rows, 1):
        data.append(
            [
                Paragraph(str(i) if r["score"] is not None else "", S["cell"]),
                Paragraph(f"<b>{_esc(r['name'])}</b><br/><font size=6.5 color='{MUTED}'>{_esc(r['email'])}</font>", S["cell"]),
                Paragraph(_esc(r.get("status_label") or str(r["status"]).replace("_", " ").capitalize()), S["cell"]),
                Paragraph(f"<b>{r['score']:g}</b>" if r["score"] is not None else "—", S["cell"]),
                Paragraph(_band_pill((r["band"] or {}).get("label")), S["cell"]),
                Paragraph(_esc(_skills_text(r["strengths"])), S["cell"]),
                Paragraph(_esc(_skills_text([g["skill"] for g in r["gaps"]])), S["cell"]),
            ]
        )
    t = Table(data, colWidths=[8 * mm, 46 * mm, 20 * mm, 12 * mm, 22 * mm, (CONTENT_W - 108 * mm) / 2, (CONTENT_W - 108 * mm) / 2], repeatRows=1)
    t.setStyle(_table_style())
    return [Paragraph(f"Everyone invited · {_esc(item['assessment']['title'])}", S["h2"]), Paragraph("Completed candidates ranked by score, then everyone still in progress or not started.", S["muted"]), Spacer(1, 4), t]


def build_assessments_report(*, kind: Literal["summary", "detailed"], company: str, items: list[dict[str, Any]]) -> bytes:
    """`items`: [{assessment, rows, sm}] in display order."""
    # Assessments with results first (keeping the given order within each group), empty ones last.
    items = sorted(items, key=lambda i: not any(r["status"] == "completed" and r["score"] is not None for r in i["rows"]))
    buf = io.BytesIO()
    label = "Assessment results · summary" if kind == "summary" else "Assessment results · detailed"
    doc = make_doc(buf, f"{company} — {label}", company, label)
    story: list[Any] = [comparison_page(company, items, detailed=kind == "detailed")]
    if kind == "detailed":
        for item in items:
            title = item["assessment"]["title"]
            story += [PageBreak(), _Marker(title), summary_page(company=company, assessment=item["assessment"], rows=item["rows"], sm=item["sm"], eyebrow="ASSESSMENT RESULT")]
            if item["rows"]:
                # Short summaries (few or no results) leave room: the ranking follows on the same page.
                story += [CondPageBreak(70 * mm), Spacer(1, 10), *_ranking(item)]
    doc.build(story)
    return buf.getvalue()
