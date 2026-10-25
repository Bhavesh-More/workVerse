"""One-page group summary for an assessment: the result of the whole round at a glance.

Built to stay readable for any cohort size (5 or 500 candidates): distributions instead of
lists, a short ranked shortlist, and insights computed from the numbers (never generated text).
The in-depth group overview is report_pdf.build_pdf.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from statistics import median
from typing import Any

import numpy as np
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepInFrame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.company.analytics import BANDS, SKILLS
from app.company.report_pdf import (
    BAND_COLORS,
    CONTENT_W,
    HAIR,
    INK,
    MARGIN,
    MIST,
    MUTED,
    OTHER,
    H,
    S,
    W,
    _band_pill,
    _esc,
    _png,
    plt,
)

BAND_ORDER = ["Strong", "Good", "Developing", "Needs support"]
FRAME_H = H - MARGIN - 16 * mm


def _band_of(score: float) -> str:
    return next(label for floor, label, _ in BANDS if score >= floor)


# ---------------------------------------------------------------- charts


def _distribution(scores: list[float]) -> Any:
    """Histogram in 10-point bins, each bar coloured by the band it falls in, median marked."""
    fig, ax = plt.subplots(figsize=(4.4, 2.35))
    edges = list(range(0, 101, 10))
    counts = [sum(1 for s in scores if lo <= s < hi or (hi == 100 and s == 100)) for lo, hi in zip(edges, edges[1:], strict=False)]
    mids = [lo + 5 for lo in edges[:-1]]
    ax.bar(mids, counts, width=8.6, color=[BAND_COLORS[_band_of(m)] for m in mids], zorder=2)
    top = max(counts) or 1
    for x, c in zip(mids, counts, strict=False):
        if c:
            ax.text(x, c + top * 0.03, str(c), ha="center", va="bottom", fontsize=7.5, color=INK)
    if scores:
        md = median(scores)
        ax.axvline(md, color=INK, linewidth=1.1, linestyle="--", zorder=3)
        ax.text(md, top * 1.22, f"median {md:g}", ha="center", va="bottom", fontsize=7.5, color=INK)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, top * 1.38)
    ax.set_xticks([0, 50, 65, 80, 100])
    ax.tick_params(axis="x", labelsize=7.5)
    ax.set_yticks([])
    ax.spines["left"].set_visible(False)
    ax.set_xlabel("Overall score", fontsize=7.5)
    return fig


def _band_bar(counts: dict[str, int]) -> Any:
    """One 100% bar split by band, labelled with counts and shares."""
    total = sum(counts.values()) or 1
    fig, ax = plt.subplots(figsize=(4.0, 0.62))
    left = 0.0
    for label in BAND_ORDER:
        n = counts.get(label, 0)
        if not n:
            continue
        share = n / total
        ax.barh([0], [share], left=left, color=BAND_COLORS[label], height=0.8, edgecolor="white", linewidth=1.5)
        if share >= 0.08:
            ax.text(left + share / 2, 0, f"{round(100 * share)}%", ha="center", va="center", fontsize=8, color="white", fontweight="bold")
        left += share
    ax.set_xlim(0, 1)
    ax.axis("off")
    return fig


def _skills_spread(rows: list[dict[str, Any]]) -> Any:
    """Per skill: the middle half of candidates (bar), the average (dot) — so spread is visible."""
    names = [SKILLS[k][0] for k in SKILLS]
    fig, ax = plt.subplots(figsize=(4.4, 2.35))
    y = list(range(len(names)))[::-1]
    for yi, k in zip(y, SKILLS, strict=False):
        vals = [r["skills"].get(k) for r in rows if r["skills"].get(k) is not None]
        ax.barh(yi, 100, color=MIST, height=0.5, zorder=1)
        if vals:
            q1, q3 = np.percentile(vals, [25, 75])
            avg = sum(vals) / len(vals)
            ax.barh(yi, max(q3 - q1, 1.5), left=q1, color=OTHER, height=0.5, zorder=2)
            ax.scatter([avg], [yi], color=INK, s=26, zorder=3)
            ax.text(103, yi, f"{avg:.0f}", va="center", fontsize=8, color=INK, fontweight="bold")
        else:
            ax.text(103, yi, "—", va="center", fontsize=8, color=MUTED)
    ax.set_yticks(y, names, fontsize=7.8)
    ax.set_xlim(0, 100)
    ax.set_xticks([0, 50, 100])
    ax.tick_params(axis="x", labelsize=7)
    ax.tick_params(axis="y", length=0)
    ax.spines["left"].set_visible(False)
    return fig


def _funnel(funnel: list[dict[str, Any]], total: int) -> Any:
    fig, ax = plt.subplots(figsize=(4.0, 1.85))
    labels = [f["label"] for f in funnel]
    counts = [f["count"] for f in funnel]
    y = list(range(len(labels)))[::-1]
    t = max(1, total)
    ax.barh(y, [t] * len(y), color=MIST, height=0.6)
    ax.barh(y, counts, color=INK, height=0.6)
    for yi, c in zip(y, counts, strict=False):
        ax.text(t * 1.02, yi, f"{c}  ({round(100 * c / t)}%)", va="center", fontsize=7.5, color=INK)
    ax.set_yticks(y, labels, fontsize=7.8)
    ax.set_xlim(0, t)
    ax.set_xticks([])
    ax.spines["bottom"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0)
    return fig


# ---------------------------------------------------------------- insights


def insights(rows: list[dict[str, Any]], sm: dict[str, Any]) -> list[str]:
    """A few facts worth acting on, computed from the results."""
    done = [r for r in rows if r["status"] == "completed" and r["score"] is not None]
    out: list[str] = []
    if not done:
        return ["Nobody has completed the assessment yet. Results appear as candidates finish."]
    scores = [r["score"] for r in done]
    advance = [r for r in done if (r["band"] or {}).get("label") in ("Strong", "Good")]
    out.append(f"<b>{len(advance)} of {len(done)}</b> who completed ({round(100 * len(advance) / len(done))}%) scored Strong or Good and are suggested to advance.")
    if len(done) < 5:
        out.append(f"Only <b>{len(done)}</b> candidate{'s have' if len(done) != 1 else ' has'} completed so far — treat these numbers as early signals, not a trend.")
    skills = [s for s in sm["skills"] if s["average"] is not None]
    if len(skills) >= 2:
        best = max(skills, key=lambda s: s["average"])
        worst = min(skills, key=lambda s: s["average"])
    if len(skills) >= 2 and best["average"] - worst["average"] >= 5:
        out.append(f"Strongest skill across the group: <b>{_esc(best['name'])}</b> (avg {best['average']:.0f}); weakest: <b>{_esc(worst['name'])}</b> (avg {worst['average']:.0f}) — a good focus for interviews.")
    gap_counts: dict[str, int] = {}
    for r in done:
        for g in r["gaps"]:
            gap_counts[g["skill"]] = gap_counts.get(g["skill"], 0) + 1
    if gap_counts:
        skill, n = max(gap_counts.items(), key=lambda kv: kv[1])
        out.append(f"<b>{round(100 * n / len(done))}%</b> of candidates showed a gap in <b>{_esc(skill)}</b>.")
    if len(scores) >= 4:
        q1, q3 = np.percentile(scores, [25, 75])
        out.append(f"The middle half of candidates scored between <b>{q1:.0f}</b> and <b>{q3:.0f}</b>" + (" — a tight field; look at skill profiles to separate them." if q3 - q1 < 12 else " — a clear spread between candidates."))
    funnel = sm.get("funnel") or []
    drops = [(a["label"], b["label"], a["count"] - b["count"]) for a, b in zip(funnel, funnel[1:], strict=False) if a["count"]]
    if drops:
        a_label, b_label, lost = max(drops, key=lambda d: d[2])
        if lost > 0:
            out.append(f"Biggest drop-off: <b>{lost}</b> candidate{'s' if lost != 1 else ''} between “{_esc(a_label)}” and “{_esc(b_label)}”" + (" — consider a reminder." if b_label in ("Started", "Accepted", "Completed") else "."))
    return out[:5]


# ---------------------------------------------------------------- page


def _kpis(items: list[tuple[str, str, str]]) -> Table:
    cells = [[Paragraph(_esc(a).upper(), S["kpil"]), Paragraph(b, S["kpi"]), Paragraph(_esc(c), S["muted"])] for a, b, c in items]
    t = Table([cells], colWidths=[CONTENT_W / len(items)] * len(items))
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(MIST)), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LINEAFTER", (0, 0), (-2, -1), 2, colors.white)]))
    return t


def _by_assessment(rows: list[dict[str, Any]]) -> Table:
    """Across several assessments: how each round is doing, busiest first (top 6)."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(str(r.get("assessment_id")), []).append(r)
    data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in ("Assessment", "Invited", "Completed", "Median", "To advance")]]
    ordered = sorted(groups.items(), key=lambda kv: -len(kv[1]))
    for _, rs in ordered[:6]:
        title = rs[0].get("assessment_title") or "Assessment"
        done = [x["score"] for x in rs if x["status"] == "completed" and x["score"] is not None]
        adv = sum(1 for x in rs if x["status"] == "completed" and (x["band"] or {}).get("label") in ("Strong", "Good"))
        data.append([
            Paragraph(f"<b>{_esc(title)}</b>", S["cell"]),
            Paragraph(str(len(rs)), S["cell"]),
            Paragraph(f"{len(done)} <font color='{MUTED}'>({round(100 * len(done) / len(rs))}%)</font>", S["cell"]),
            Paragraph(f"{round(median(done), 1):g}" if done else "—", S["cell"]),
            Paragraph(str(adv), S["cell"]),
        ])
    if len(ordered) > 6:
        data.append([Paragraph(f"<font color='{MUTED}'>+ {len(ordered) - 6} more assessments in the detailed overview</font>", S["cell"]), "", "", "", ""])
    inner = Table(data, colWidths=[CONTENT_W - 96 * mm, 20 * mm, 28 * mm, 22 * mm, 26 * mm])
    t = Table([[Paragraph("By assessment", S["h3"])], [inner]], colWidths=[CONTENT_W])
    inner.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(MIST)), ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(HAIR)), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (-1, -1), 4)]))
    t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t


def _grid(left: list[Any], right: list[Any], gap: float = 6 * mm) -> Table:
    half = (CONTENT_W - gap) / 2
    t = Table([[left, right]], colWidths=[half + gap, half])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t


def make_doc(buf: io.BytesIO, title: str, company: str, label: str) -> BaseDocTemplate:
    """A4 document whose footer names the company, the report and the section on the page."""
    doc = BaseDocTemplate(buf, pagesize=(W, H), leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=16 * mm, title=title, author=company)
    frame = Frame(MARGIN, 16 * mm, CONTENT_W, FRAME_H, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    def footer(canvas: Any, d: Any) -> None:
        canvas.saveState()
        canvas.setFont("Courier", 7.5)
        canvas.setFillColor(colors.HexColor(MUTED))
        section = getattr(canvas, "_wv_label", "")
        canvas.drawString(MARGIN, 8 * mm, " · ".join(x for x in (company, label, section) if x).upper()[:100])
        canvas.drawRightString(W - MARGIN, 8 * mm, f"{datetime.now(UTC).strftime('%d %b %Y').upper()} · PAGE {d.page}")
        canvas.setStrokeColor(colors.HexColor(HAIR))
        canvas.line(MARGIN, 11 * mm, W - MARGIN, 11 * mm)
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(frames=[frame], onPageEnd=footer)])
    return doc


def summary_page(*, company: str, assessment: dict[str, Any], rows: list[dict[str, Any]], sm: dict[str, Any], eyebrow: str = "GROUP SUMMARY") -> KeepInFrame:
    """The one-page group summary as a single flowable (scaled to fit one page)."""
    title = assessment["title"]
    half = (CONTENT_W - 6 * mm) / 2
    done = sorted([r for r in rows if r["status"] == "completed" and r["score"] is not None], key=lambda r: -r["score"])
    scores = [r["score"] for r in done]
    bands = {label: sum(1 for r in done if (r["band"] or {}).get("label") == label) for label in BAND_ORDER}
    advance = bands["Strong"] + bands["Good"]
    med = f"{round(median(scores), 1):g}" if scores else "—"

    content: list[Any] = [
        Paragraph(f"{_esc(company).upper()} · {eyebrow} · {datetime.now(UTC).strftime('%d %b %Y').upper()}", S["eyebrow"]),
        Spacer(1, 3),
        Paragraph(_esc(title), S["h1"]),
        Paragraph(f"{_esc(assessment.get('subtitle') or 'Topic: ' + str(assessment.get('topic_title') or ''))} · {sm['total']} invited · {sm['completed']} completed", S["muted"]),
        Spacer(1, 8),
        _kpis(
            [
                ("Invited", str(sm["total"]), "candidates"),
                ("Completed", str(sm["completed"]), f"{sm['completion_rate']}% of invited"),
                ("Median score", med, f"average {sm['avg_score']:g}" if sm["avg_score"] is not None else "out of 100"),
                ("To advance", str(advance), f"{round(100 * advance / len(done))}% Strong or Good" if done else "Strong or Good"),
                ("Typical time", f"{sm['avg_minutes']:g}" if sm.get("avg_minutes") is not None else "—", "minutes on task"),
            ]
        ),
        Spacer(1, 10),
    ]
    if done:
        legend = " &nbsp; ".join(f"{_band_pill(label)} <b>{bands[label]}</b>" for label in BAND_ORDER)
        left = [Paragraph("Score distribution", S["h3"]), Paragraph("Candidates per 10-point range, coloured by band.", S["muted"]), _png(_distribution(scores), half)]
        right = [
            Paragraph("Recommendation bands", S["h3"]),
            Paragraph("Share of completed candidates in each band.", S["muted"]),
            Spacer(1, 4),
            _png(_band_bar(bands), half),
            Paragraph(legend, S["cell"]),
            Spacer(1, 8),
            Paragraph("Pipeline", S["h3"]),
            _png(_funnel(sm["funnel"], sm["total"]), half),
        ]
        content += [_grid(left, right), Spacer(1, 8)]

        skills = [Paragraph("Skills across the group", S["h3"]), Paragraph("Dot = average · grey bar = middle half of candidates.", S["muted"]), _png(_skills_spread(done), half)]
        multi = len({r.get("assessment_id") for r in rows if r.get("assessment_id")}) > 1
        top = done[: 6 if multi else 8]
        data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in ("#", "Candidate", "Score", "Band")]]
        data += [
            [
                Paragraph(str(i), S["cell"]),
                Paragraph(f"<b>{_esc(r['name'])}</b>" + (f"<br/><font size=6.5 color='{MUTED}'>{_esc(r.get('assessment_title'))}</font>" if multi else ""), S["cell"]),
                Paragraph(f"<b>{r['score']:g}</b>", S["cell"]),
                Paragraph(_band_pill((r["band"] or {}).get("label")), S["cell"]),
            ]
            for i, r in enumerate(top, 1)
        ]
        tt = Table(data, colWidths=[6 * mm, half - 46 * mm, 14 * mm, 26 * mm])
        tt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(MIST)), ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(HAIR)), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (-1, -1), 4)]))
        more = len(done) - len(top)
        shortlist = [Paragraph(f"Top {len(top)} of {len(done)}", S["h3"]), tt] + ([Paragraph(f"+ {more} more in the detailed overview.", S["muted"])] if more > 0 else [])
        content += [_grid(skills, shortlist), Spacer(1, 8)]
        if multi:
            content += [_by_assessment(rows), Spacer(1, 8)]

    box = Table([[[Paragraph("KEY INSIGHTS", S["kpil"]), Spacer(1, 3), *[Paragraph(f"• {line}", S["body"]) for line in insights(rows, sm)]]]], colWidths=[CONTENT_W])
    box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fff8dc")), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    content += [box, Spacer(1, 6), Paragraph("Scores come from a simulated workday, rated against written anchors with quoted evidence. Use bands to plan next steps and combine with interviews.", S["muted"])]
    return KeepInFrame(CONTENT_W, FRAME_H, content, mode="shrink")


def build_cohort_summary(*, company: str, assessment: dict[str, Any], rows: list[dict[str, Any]], sm: dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    doc = make_doc(buf, f"{assessment['title']} — group summary", company, f"{assessment['title']} · group summary")
    doc.build([summary_page(company=company, assessment=assessment, rows=rows, sm=sm)])
    return buf.getvalue()
