"""HR-readable PDF report for one assessment: summary, charts, ranking and a page per candidate.

Charts are drawn with matplotlib (Agg) into PNGs at print resolution and laid out with reportlab.
One ink colour carries data; status colours appear only for score bands and always with a label.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.enums import TA_LEFT  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.company.analytics import BANDS, SKILLS  # noqa: E402

INK = "#141414"
MUTED = "#6b6b6b"
HAIR = "#d9d9d9"
MIST = "#f2f2f2"
OTHER = "#b5b5b5"
BAND_COLORS = {"Strong": "#0ca30c", "Good": "#21935b", "Developing": "#fab219", "Needs support": "#d03b3b"}

W, H = A4
MARGIN = 16 * mm
CONTENT_W = W - 2 * MARGIN

_base = ParagraphStyle("base", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=colors.HexColor(INK), alignment=TA_LEFT)
S = {
    "body": _base,
    "muted": ParagraphStyle("muted", parent=_base, textColor=colors.HexColor(MUTED), fontSize=8.5, leading=12),
    "eyebrow": ParagraphStyle("eyebrow", parent=_base, fontName="Courier", fontSize=8, leading=10, textColor=colors.HexColor(MUTED)),
    "h1": ParagraphStyle("h1", parent=_base, fontName="Helvetica-Bold", fontSize=22, leading=26, spaceAfter=4),
    "h2": ParagraphStyle("h2", parent=_base, fontName="Helvetica-Bold", fontSize=14, leading=18, spaceBefore=6, spaceAfter=6),
    "h3": ParagraphStyle("h3", parent=_base, fontName="Helvetica-Bold", fontSize=10.5, leading=14, spaceBefore=4, spaceAfter=3),
    "kpi": ParagraphStyle("kpi", parent=_base, fontName="Helvetica-Bold", fontSize=20, leading=23),
    "kpil": ParagraphStyle("kpil", parent=_base, fontName="Courier", fontSize=7.5, leading=9, textColor=colors.HexColor(MUTED)),
    "cell": ParagraphStyle("cell", parent=_base, fontSize=8, leading=10.5),
    "cellb": ParagraphStyle("cellb", parent=_base, fontName="Helvetica-Bold", fontSize=8, leading=10.5),
}

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 9,
        "axes.edgecolor": HAIR,
        "axes.labelcolor": MUTED,
        "xtick.color": MUTED,
        "ytick.color": INK,
        "axes.spines.top": False,
        "axes.spines.right": False,
    }
)


def _esc(s: Any) -> str:
    return str(s if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _png(fig: Any, width: float) -> Image:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=220, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    img = Image(buf)
    ratio = img.imageHeight / img.imageWidth
    img.drawWidth, img.drawHeight = width, width * ratio
    return img


def _hbars(labels: list[str], values: list[float | None], *, xmax: float = 100, suffix: str = "", colors_: list[str] | None = None, compare: list[float | None] | None = None, size: tuple[float, float] = (6.4, 2.4)) -> Any:
    fig, ax = plt.subplots(figsize=size if not compare else (size[0], size[1] * 1.35))
    y = list(range(len(labels)))[::-1]
    vals = [v or 0 for v in values]
    # With a comparison, each row is a pair: this value (ink) above the group's (grey), each labelled.
    h, off = (0.56, 0.0) if not compare else (0.34, 0.19)
    ax.barh([yi + off for yi in y], [xmax] * len(vals), color=MIST, height=h, zorder=1)
    ax.barh([yi + off for yi in y], vals, color=colors_ or INK, height=h, zorder=2)
    for yi, v in zip(y, values, strict=False):
        txt = "no evidence" if v is None else f"{v:g}{suffix}"
        ax.text(xmax * 1.02, yi + off, txt, va="center", ha="left", fontsize=9, color=INK)
    if compare:
        ax.barh([yi - off for yi in y], [c or 0 for c in compare], color=OTHER, height=h, zorder=2)
        for yi, c in zip(y, compare, strict=False):
            ax.text(xmax * 1.02, yi - off, "—" if c is None else f"group {c:g}", va="center", ha="left", fontsize=8, color=MUTED)
    ax.set_yticks(y, labels)
    ax.set_xlim(0, xmax)
    ax.set_xticks([])
    ax.spines["bottom"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0)
    return fig


def _histogram(hist: list[dict[str, Any]]) -> Any:
    fig, ax = plt.subplots(figsize=(6.4, 2.3))
    xs = range(len(hist))
    counts = [h["count"] for h in hist]
    ax.bar(xs, counts, color=INK, width=0.62, zorder=2)
    for x, c in zip(xs, counts, strict=False):
        if c:
            ax.text(x, c + max(counts) * 0.03, str(c), ha="center", va="bottom", fontsize=9)
    ax.set_xticks(list(xs), [h["range"] for h in hist])
    ax.set_yticks([])
    ax.spines["left"].set_visible(False)
    ax.set_xlabel("Overall score (0–100)")
    ax.set_ylim(0, max(1, max(counts)) * 1.25)
    return fig


def _score_vs_time(rows: list[dict[str, Any]]) -> Any:
    fig, ax = plt.subplots(figsize=(6.4, 2.6))
    ax.scatter([r["minutes"] for r in rows], [r["score"] for r in rows], c=[BAND_COLORS.get((r["band"] or {}).get("label", ""), INK) for r in rows], s=28, alpha=0.85, edgecolors="white", linewidths=0.6, zorder=2)
    for y, label in ((80, "Strong"), (65, "Good"), (50, "Developing")):
        ax.axhline(y, color=HAIR, linewidth=0.8, zorder=1)
        ax.text(ax.get_xlim()[1], y, f" {label}", va="center", fontsize=7, color=MUTED)
    ax.set_xlabel("Minutes on task")
    ax.set_ylabel("Overall score")
    ax.set_ylim(0, 100)
    return fig


def _kpis(items: list[tuple[str, str, str]]) -> Table:
    # Each KPI cell is a mini stack: label / value / sub.
    cells = [[Paragraph(_esc(label).upper(), S["kpil"]), Paragraph(_esc(value), S["kpi"]), Paragraph(sub, S["muted"])] for label, value, sub in items]
    t = Table([cells], colWidths=[CONTENT_W / len(items)] * len(items))
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(MIST)),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LINEAFTER", (0, 0), (-2, -1), 2, colors.white),
            ]
        )
    )
    return t


def _band_pill(label: str | None) -> str:
    if not label:
        return "—"
    return f'<font color="{BAND_COLORS.get(label, INK)}">●</font> {_esc(label)}'


def _box(flowables: list[Any], bg: str = MIST) -> Table:
    t = Table([[flowables]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    return t


def _headline(sm: dict[str, Any]) -> str:
    if not sm["total"]:
        return "No candidates have been invited yet."
    parts = [f"<b>{sm['completed']} of {sm['total']}</b> invited candidates completed the assessment ({sm['completion_rate']}%)."]
    if sm["avg_score"] is not None:
        b = next((label for floor, label, _ in BANDS if sm["avg_score"] >= floor), "")
        parts.append(f"The average score was <b>{sm['avg_score']:g}/100</b> ({b.lower()}).")
        advance = sum(x["count"] for x in sm["bands"] if x["label"] in ("Strong", "Good"))
        parts.append(f"<b>{advance}</b> candidate{'s' if advance != 1 else ''} scored in the Strong or Good band and {'are' if advance != 1 else 'is'} suggested to advance.")
    if sm.get("strongest_skill") and sm.get("weakest_skill") and sm["strongest_skill"]["id"] != sm["weakest_skill"]["id"]:
        parts.append(f"Across the group, the strongest skill was <b>{sm['strongest_skill']['name']}</b> and the weakest was <b>{sm['weakest_skill']['name']}</b>.")
    if sm.get("top_candidate"):
        parts.append(f"Top performer: <b>{_esc(sm['top_candidate'])}</b> ({sm['top_score']:g}/100).")
    return " ".join(parts)


def _footer(company: str, title: str):
    def draw(canvas: Any, doc: Any) -> None:
        canvas.saveState()
        canvas.setFont("Courier", 7.5)
        canvas.setFillColor(colors.HexColor(MUTED))
        canvas.drawString(MARGIN, 9 * mm, f"{company.upper()} · {title.upper()}"[:95])
        canvas.drawRightString(W - MARGIN, 9 * mm, f"PAGE {doc.page}")
        canvas.setStrokeColor(colors.HexColor(HAIR))
        canvas.line(MARGIN, 12 * mm, W - MARGIN, 12 * mm)
        canvas.restoreState()

    return draw


def build_pdf(*, company: str, assessment: dict[str, Any], rows: list[dict[str, Any]], sm: dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    title = assessment["title"]
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=18 * mm, title=f"{title} — assessment report", author=company)
    story: list[Any] = []
    now = datetime.now(UTC).strftime("%d %b %Y")

    # ---- page 1: executive summary -----------------------------------------
    story += [
        Paragraph(f"{_esc(company).upper()} · ASSESSMENT REPORT · {now.upper()}", S["eyebrow"]),
        Spacer(1, 4),
        Paragraph(_esc(title), S["h1"]),
        Paragraph(f"Topic: {_esc(assessment.get('topic_title'))}", S["muted"]),
        Spacer(1, 10),
        _kpis(
            [
                ("Invited", str(sm["total"]), "candidates"),
                ("Completed", str(sm["completed"]), f"{sm['completion_rate']}% completion"),
                ("Average score", f"{sm['avg_score']:g}" if sm["avg_score"] is not None else "—", "out of 100"),
                ("Top score", f"{sm['top_score']:g}" if sm["top_score"] is not None else "—", _esc(sm.get("top_candidate") or "")),
            ]
        ),
        Spacer(1, 12),
        Paragraph("At a glance", S["h2"]),
        Paragraph(_headline(sm), S["body"]),
        Spacer(1, 8),
    ]
    from app.company.cohort_report import insights  # local: cohort_report builds on this module

    story += [_box([Paragraph("KEY INSIGHTS", S["kpil"]), Spacer(1, 3), *[Paragraph(f"• {line}", S["body"]) for line in insights(rows, sm)]], bg="#fff8dc"), Spacer(1, 10)]
    shortlist = [r for r in sorted(rows, key=lambda r: -(r["score"] or 0)) if (r["band"] or {}).get("label") in ("Strong", "Good")]
    if sm["completed"]:
        lines = [Paragraph("Shortlist — suggested to advance", S["h3"])]
        lines += [
            Paragraph(f"{_band_pill(r['band']['label'])} &nbsp;<b>{_esc(r['name'])}</b> — {r['score']:g}/100"
                      + (f" · strong in {_esc(', '.join(r['strengths']))}" if r["strengths"] else ""), S["body"])
            for r in shortlist
        ] or [Paragraph("No candidate reached the Good band yet. Review the Developing candidates' areas to probe before deciding.", S["body"])]
        story += [_box(lines, bg="#eef7ee" if shortlist else MIST), Spacer(1, 10)]
    if sm["completed"]:
        story += [
            Paragraph("Skills across the group", S["h2"]),
            Paragraph("Average score per skill for everyone who completed (0–100). Longer bar = stronger.", S["muted"]),
            _png(_hbars([s["name"] for s in sm["skills"]], [s["average"] for s in sm["skills"]]), CONTENT_W * 0.92),
        ]
    story.append(
        _box(
            [
                Paragraph("How to read this report", S["h3"]),
                Paragraph(
                    "Each candidate spent a short simulated workday handling a realistic problem with AI colleagues. "
                    "Scores come from what they actually said and did, and every score in the candidate's own report "
                    "links to the exact quote or action behind it. Use the bands as a guide for the next step and the "
                    "<b>areas to probe</b> as interview questions — not as a final hiring decision.",
                    S["body"],
                ),
            ]
        )
    )

    # ---- page 2: cohort charts ----------------------------------------------
    story += [PageBreak(), Paragraph("Candidate pipeline", S["h2"]), Paragraph("How many candidates reached each step.", S["muted"])]
    total = max(1, sm["total"])
    story.append(_png(_hbars([f["label"] for f in sm["funnel"]], [f["count"] for f in sm["funnel"]], xmax=total), CONTENT_W * 0.92))
    if sm["completed"]:
        story += [
            Paragraph("Score distribution", S["h2"]),
            Paragraph("Number of candidates in each score range.", S["muted"]),
            _png(_histogram(sm["histogram"]), CONTENT_W * 0.92),
            Paragraph("Recommendation bands", S["h2"]),
        ]
        band_rows = [[Paragraph("<b>Band</b>", S["cell"]), Paragraph("<b>Score</b>", S["cell"]), Paragraph("<b>Candidates</b>", S["cell"]), Paragraph("<b>Suggested next step</b>", S["cell"])]]
        ranges = {"Strong": "80–100", "Good": "65–79", "Developing": "50–64", "Needs support": "0–49"}
        for b in sm["bands"]:
            band_rows.append([Paragraph(_band_pill(b["label"]), S["cell"]), Paragraph(ranges[b["label"]], S["cell"]), Paragraph(str(b["count"]), S["cellb"]), Paragraph(_esc(b["advice"]), S["cell"])])
        bt = Table(band_rows, colWidths=[32 * mm, 20 * mm, 24 * mm, CONTENT_W - 76 * mm])
        bt.setStyle(_table_style())
        story.append(bt)
        from app.company.cohort_report import _skills_spread

        done = [r for r in rows if r["status"] == "completed" and r["score"] is not None]
        story.append(KeepTogether([
            Paragraph("How spread out each skill is", S["h2"]),
            Paragraph("Dot = group average. Grey bar = where the middle half of candidates landed; a wide bar means candidates differ a lot on that skill.", S["muted"]),
            _png(_skills_spread(done), CONTENT_W * 0.8),
        ]))
        timed = [r for r in done if r.get("minutes") is not None]
        if len(timed) >= 3:
            story.append(KeepTogether([Paragraph("Score against time taken", S["h2"]), Paragraph("Each dot is a candidate, coloured by band. Spending longer doesn't have to mean scoring higher.", S["muted"]), _png(_score_vs_time(timed), CONTENT_W * 0.8)]))
        if sm.get("avg_question_ratio") is not None:
            story += [
                Spacer(1, 10),
                Paragraph("Conversation habits (group average)", S["h3"]),
                Paragraph(
                    f"Messages that were questions: <b>{round(100 * sm['avg_question_ratio'])}%</b> · "
                    f"Average words per message: <b>{sm['avg_words']:g}</b> (natural speech is 5–25) · "
                    f"Average time to finish: <b>{sm['avg_minutes']:g} min</b>" if sm.get("avg_minutes") is not None else
                    f"Messages that were questions: <b>{round(100 * sm['avg_question_ratio'])}%</b> · Average words per message: <b>{sm['avg_words']:g}</b>",
                    S["body"],
                ),
            ]

    # ---- page 3: ranking ------------------------------------------------------
    story += [PageBreak(), Paragraph("All candidates", S["h2"]), Paragraph("Completed candidates ranked by overall score, then everyone still in progress.", S["muted"]), Spacer(1, 4)]
    head = ["#", "Candidate", "Status", "Score", "Band", "Strengths", "Areas to probe"]
    data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in head]]
    ordered = sorted(rows, key=lambda r: (r["score"] is None, -(r["score"] or 0)))
    for i, r in enumerate(ordered, 1):
        data.append(
            [
                Paragraph(str(i) if r["score"] is not None else "", S["cell"]),
                Paragraph(f"<b>{_esc(r['name'])}</b><br/><font size=6.5 color='{MUTED}'>{_esc(r['email'])}</font>"
                          + (f"<br/><font size=6.5>{_esc(r['assessment_title'])}</font>" if r.get("assessment_title") else ""), S["cell"]),
                Paragraph(_esc(r["status_label"]), S["cell"]),
                Paragraph(f"<b>{r['score']:g}</b>" if r["score"] is not None else "—", S["cell"]),
                Paragraph(_band_pill((r["band"] or {}).get("label")), S["cell"]),
                Paragraph(_esc(", ".join(r["strengths"]) or "—"), S["cell"]),
                Paragraph(_esc(", ".join(g["skill"] for g in r["gaps"]) or "—"), S["cell"]),
            ]
        )
    t = Table(data, colWidths=[7 * mm, 52 * mm, 20 * mm, 12 * mm, 25 * mm, (CONTENT_W - 116 * mm) / 2, (CONTENT_W - 116 * mm) / 2], repeatRows=1)
    t.setStyle(_table_style())
    story.append(t)

    # ---- one page per completed candidate --------------------------------------
    cohort = {s["id"]: s["average"] for s in sm["skills"]}
    for r in ordered:
        if r["status"] != "completed":
            continue
        b = r["band"] or {}
        header = Table(
            [[
                [Paragraph("CANDIDATE", S["eyebrow"]), Paragraph(_esc(r["name"]), S["h1"]), Paragraph(_esc(r["email"]) + (f" · {_esc(r['assessment_title'])}" if r.get("assessment_title") else ""), S["muted"])],
                [Paragraph("OVERALL", S["kpil"]), Paragraph(f"{r['score']:g}<font size=11 color='{MUTED}'> /100</font>" if r["score"] is not None else "—", S["kpi"]), Paragraph(_band_pill(b.get("label")), S["body"])],
            ]],
            colWidths=[CONTENT_W - 48 * mm, 48 * mm],
        )
        header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (1, 0), (1, 0), colors.HexColor(MIST)), ("LEFTPADDING", (1, 0), (1, 0), 10), ("TOPPADDING", (1, 0), (1, 0), 8), ("BOTTOMPADDING", (1, 0), (1, 0), 8)]))
        block: list[Any] = [PageBreak(), header, Spacer(1, 8)]
        if b.get("advice"):
            block.append(_box([Paragraph(f"<b>Suggested next step:</b> {_esc(b['advice'])}", S["body"])]))
        block += [
            Paragraph("Skill profile", S["h2"]),
            Paragraph("Black bar = this candidate. Grey bar = average of everyone who completed.", S["muted"]),
            _png(
                _hbars(
                    [SKILLS[k][0] for k in SKILLS],
                    [r["skills"].get(k) for k in SKILLS],
                    compare=[cohort.get(k) for k in SKILLS],
                ),
                CONTENT_W * 0.9,
            ),
        ]
        if r.get("summary"):
            block += [Paragraph("Evaluator summary (as written to the candidate)", S["h3"]), Paragraph(_esc(r["summary"]), S["body"])]
        block += [
            Paragraph("Strengths", S["h3"]),
            Paragraph(_esc(", ".join(r["strengths"])) or "No skill reached the strong level in this exercise.", S["body"]),
            Paragraph("Areas to probe in interview", S["h3"]),
        ]
        if r["gaps"]:
            for g in r["gaps"]:
                block.append(Paragraph(f"• <b>{_esc(g['skill'])}</b>" + (f" — {_esc(g['advice'])}" if g["advice"] else ""), S["body"]))
        else:
            block.append(Paragraph("No major gaps found.", S["body"]))
        facts = []
        if r.get("minutes") is not None:
            facts.append(f"Time: <b>{r['minutes']:g} min</b>")
        if r.get("messages") is not None:
            facts.append(f"Messages sent: <b>{r['messages']}</b>")
        if r.get("question_ratio") is not None:
            facts.append(f"Questions: <b>{round(100 * r['question_ratio'])}%</b>")
        if r.get("avg_words") is not None:
            facts.append(f"Avg words/message: <b>{r['avg_words']:g}</b>")
        if r.get("checks_total"):
            facts.append(f"Key checks done: <b>{r['checks_passed']}/{r['checks_total']}</b>")
        if facts:
            block += [Paragraph("How they worked", S["h3"]), Paragraph(" · ".join(facts), S["body"])]
        story += block

    # ---- glossary -------------------------------------------------------------
    story += [PageBreak(), Paragraph("What the skills mean", S["h2"])]
    gl = [[Paragraph("<b>Skill</b>", S["cell"]), Paragraph("<b>What we looked for</b>", S["cell"])]]
    gl += [[Paragraph(f"<b>{n}</b>", S["cell"]), Paragraph(_esc(d), S["cell"])] for n, d in SKILLS.values()]
    gt = Table(gl, colWidths=[45 * mm, CONTENT_W - 45 * mm])
    gt.setStyle(_table_style())
    story += [
        gt,
        Spacer(1, 12),
        KeepTogether(
            [
                Paragraph("About the scores", S["h3"]),
                Paragraph(
                    "Each skill is rated 0–4 against written anchors by an AI evaluator that may only cite the candidate's own "
                    "messages and actions; the overall score is the average of rated skills scaled to 100. A skill shows "
                    "'no evidence' when the candidate didn't do enough for it to be judged. This is a structured work sample: "
                    "combine it with interviews and references.",
                    S["body"],
                ),
            ]
        ),
    ]

    doc.build(story, onFirstPage=_footer(company, title), onLaterPages=_footer(company, title))
    return buf.getvalue()


def _table_style() -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(MIST)),
            ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor(HAIR)),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ]
    )
