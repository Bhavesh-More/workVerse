"""Per-candidate PDF reports for a company: a one-page visual summary, and an in-depth review.

Both are built from what the evaluation already stores (scores, quoted evidence, the evidence
ledger, conversation statistics, coaching) — nothing is invented here. The summary is guaranteed
to be a single page per candidate (content is scaled to fit if it runs long); the detailed review
runs as many pages as the evidence needs. Several candidates can go into one file.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from typing import Any, Literal

import numpy as np
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    KeepInFrame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.company.analytics import SKILLS
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
    _hbars,
    _png,
    _table_style,
    plt,
)

Kind = Literal["summary", "detailed"]

GREEN_BG = "#eef7ee"
AMBER_BG = "#fdf5e1"
SOURCE_LABEL = {"message": "Said in conversation", "event": "Action taken", "deliverable": "Status update"}
STATUS_LABEL = {"scored": "", "insufficient_evidence": "Not enough evidence", "not_assessed": "Not assessed"}
FRAME_H = H - MARGIN - 18 * mm


# ---------------------------------------------------------------- page furniture


class _Marker(Flowable):
    """Zero-size flowable: tells the page footer which candidate the page belongs to."""

    def __init__(self, label: str) -> None:
        super().__init__()
        self.label = label

    def wrap(self, *_: Any) -> tuple[float, float]:
        return 0, 0

    def draw(self) -> None:
        self.canv._wv_label = self.label  # type: ignore[attr-defined]


def _doc(buf: io.BytesIO, title: str, company: str, footer_left: str) -> BaseDocTemplate:
    doc = BaseDocTemplate(buf, pagesize=(W, H), leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=18 * mm, title=title, author=company)
    frame = Frame(MARGIN, 18 * mm, CONTENT_W, FRAME_H, id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    def footer(canvas: Any, d: Any) -> None:
        canvas.saveState()
        canvas.setFont("Courier", 7.5)
        canvas.setFillColor(colors.HexColor(MUTED))
        who = getattr(canvas, "_wv_label", "")
        canvas.drawString(MARGIN, 9 * mm, (f"{footer_left} · {who}" if who else footer_left).upper()[:100])
        canvas.drawRightString(W - MARGIN, 9 * mm, f"PAGE {d.page}")
        canvas.setStrokeColor(colors.HexColor(HAIR))
        canvas.line(MARGIN, 12 * mm, W - MARGIN, 12 * mm)
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPageEnd=footer)])
    return doc


def _style(*cmds: tuple) -> TableStyle:
    return TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0), *cmds])


def _panel(flowables: list[Any], width: float, bg: str = MIST, pad: int = 10) -> Table:
    t = Table([[flowables]], colWidths=[width])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), pad), ("TOPPADDING", (0, 0), (-1, -1), pad - 2), ("BOTTOMPADDING", (0, 0), (-1, -1), pad)]))
    return t


def _clip(text: str | None, limit: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


# ---------------------------------------------------------------- charts


def _gauge(score: float | None, band: str | None) -> Any:
    """Score as a ring: band-coloured arc over a light track, the number in the middle."""
    fig, ax = plt.subplots(figsize=(1.9, 1.9))
    ax.set_aspect("equal")
    ax.axis("off")
    value = max(0.0, min(100.0, score or 0.0))
    ax.pie([100], radius=1, colors=[MIST], startangle=90, counterclock=False, wedgeprops={"width": 0.2, "edgecolor": "white"})
    if score is not None:
        ax.pie([value, 100 - value], radius=1, colors=[BAND_COLORS.get(band or "", INK), (0, 0, 0, 0)], startangle=90, counterclock=False, wedgeprops={"width": 0.2, "edgecolor": "white"})
    ax.text(0, 0.1, "—" if score is None else f"{score:g}", ha="center", va="center", fontsize=24, fontweight="bold", color=INK)
    ax.text(0, -0.32, "out of 100", ha="center", va="center", fontsize=7.5, color=MUTED)
    return fig


def _radar(values: list[float | None], group: list[float | None]) -> Any:
    """Five skills on a spider chart: this candidate (filled ink) against the group (dashed grey)."""
    labels = [SKILLS[k][0].replace(" & ", " &\n").replace(" under ", "\nunder ") for k in SKILLS]
    n = len(labels)
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist()
    angles += angles[:1]
    fig, ax = plt.subplots(figsize=(3.3, 3.1), subplot_kw={"polar": True})
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_ylim(0, 100)
    ax.set_yticks([25, 50, 75, 100], ["", "", "", ""])
    ax.set_xticks(angles[:-1], labels, fontsize=7.2, color=INK)
    ax.tick_params(axis="x", pad=9)
    ax.grid(color=HAIR, linewidth=0.6)
    ax.spines["polar"].set_color(HAIR)
    if any(g is not None for g in group):
        gv = [g or 0 for g in group] + [group[0] or 0]
        ax.plot(angles, gv, color=OTHER, linewidth=1.1, linestyle="--", label="Group average")
    cv = [v or 0 for v in values] + [values[0] or 0]
    ax.fill(angles, cv, color=INK, alpha=0.12)
    ax.plot(angles, cv, color=INK, linewidth=1.8, label="This candidate")
    ax.scatter(angles[:-1], cv[:-1], color=INK, s=10, zorder=3)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.06), ncol=2, frameon=False, fontsize=7)
    return fig


def _talk_balance(people: list[dict[str, Any]]) -> Any:
    names = [p["name"] for p in people]
    mine = [p["learner_words"] for p in people]
    theirs = [p["npc_words"] for p in people]
    fig, ax = plt.subplots(figsize=(6.4, 0.42 * max(2, len(names)) + 0.6))
    y = list(range(len(names)))[::-1]
    ax.barh(y, mine, color=INK, height=0.55, label="Candidate's words")
    ax.barh(y, theirs, left=mine, color=OTHER, height=0.55, label="Colleague's words")
    for yi, a, b in zip(y, mine, theirs, strict=False):
        ax.text(a + b + max(1, max(m + t for m, t in zip(mine, theirs, strict=False))) * 0.01, yi, f"{a} / {b}", va="center", fontsize=8, color=MUTED)
    ax.set_yticks(y, names)
    ax.set_xticks([])
    for side in ("bottom", "left"):
        ax.spines[side].set_visible(False)
    ax.tick_params(axis="y", length=0)
    ax.legend(loc="lower right", bbox_to_anchor=(1, 1), ncol=2, frameon=False, fontsize=7.5)
    return fig


def _turns(turns: list[dict[str, Any]], long_words: int) -> Any:
    fig, ax = plt.subplots(figsize=(6.4, 1.9))
    xs = range(1, len(turns) + 1)
    ax.bar(list(xs), [t["words"] for t in turns], color=[INK if t.get("question") else OTHER for t in turns], width=0.7)
    ax.axhline(long_words, color=BAND_COLORS["Developing"], linewidth=1, linestyle="--")
    ax.text(len(turns) + 0.6, long_words, f" {long_words} words: long", va="center", fontsize=7, color=MUTED)
    ax.set_xlabel("Candidate's messages, in order (dark = a question)")
    ax.set_ylabel("Words", fontsize=8)
    ax.set_xlim(0.3, len(turns) + 0.7)
    ax.set_xticks(list(xs) if len(turns) <= 20 else list(range(1, len(turns) + 1, 5)))
    ax.tick_params(axis="x", labelsize=7)
    return fig


# ---------------------------------------------------------------- shared pieces


def _items(ev: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Rubric items in skill order."""
    if not ev:
        return []
    by = {i["criterion_id"]: i for i in ev.get("items", [])}
    return [by[k] for k in SKILLS if k in by]


def evidence_text(e: dict[str, Any], ev: dict[str, Any] | None) -> str:
    """What an evidence item shows: the quote, or for an action the action it points at."""
    if (e.get("quote") or "").strip():
        return e["quote"].strip()
    for checks in ((ev or {}).get("ledger") or {}).values():
        for ch in checks:
            if ch.get("source_id") and ch.get("source_id") == e.get("source_id"):
                return ch["label"]
    interp = (e.get("interpretation") or "").strip()
    return "" if interp in ("", "Referenced during evaluation.") else interp


def _moments(ev: dict[str, Any] | None) -> tuple[tuple[dict, dict] | None, tuple[dict, dict] | None]:
    """(best, weakest): one piece of real evidence from the highest- and lowest-scored skills."""

    def first(item: dict[str, Any]) -> dict[str, Any] | None:
        for e in item.get("evidence") or []:
            text = evidence_text(e, ev)
            if text:
                return {**e, "quote": text, "is_quote": bool((e.get("quote") or "").strip())}
        return None

    scored = [(i, first(i)) for i in _items(ev) if i.get("score") is not None]
    scored = [(i, e) for i, e in scored if e]
    if not scored:
        return None, None
    best = max(scored, key=lambda p: p[0]["score"])
    worst = min(scored, key=lambda p: p[0]["score"])
    return best, (worst if worst[0] is not best[0] and worst[0]["score"] < 3 else None)


def _facts(row: dict[str, Any]) -> list[tuple[str, str, str]]:
    return [
        ("Time on task", f"{row['minutes']:g}" if row.get("minutes") is not None else "—", "minutes"),
        ("Messages sent", str(row["messages"]) if row.get("messages") is not None else "—", "to colleagues"),
        ("Questions", f"{round(100 * row['question_ratio'])}%" if row.get("question_ratio") is not None else "—", "of their messages"),
        ("Key checks", f"{row['checks_passed']}/{row['checks_total']}" if row.get("checks_total") else "—", "completed"),
    ]


def _kpi_row(items: list[tuple[str, str, str]], width: float) -> Table:
    cells = [[Paragraph(_esc(a).upper(), S["kpil"]), Paragraph(_esc(b), S["kpi"]), Paragraph(_esc(c), S["muted"])] for a, b, c in items]
    t = Table([cells], colWidths=[width / len(items)] * len(items))
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(MIST)), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LINEAFTER", (0, 0), (-2, -1), 2, colors.white)]))
    return t


def _header(c: dict[str, Any], company: str, assessment: dict[str, Any], kind_label: str) -> list[Any]:
    """Name, contact, ranking and the score ring with band and next step."""
    row = c["row"]
    band = (row.get("band") or {}).get("label")
    advice = (row.get("band") or {}).get("advice") or ""
    when = (row.get("completed_at") or "")[:10]
    rank = f"Ranked <b>{c['rank']}</b> of {c['ranked']} who completed" if c.get("rank") else ""
    left = [
        Paragraph(f"{_esc(company).upper()} · {_esc(kind_label).upper()}", S["eyebrow"]),
        Spacer(1, 3),
        Paragraph(_esc(row["name"]), S["h1"]),
        Paragraph(_esc(row["email"]), S["muted"]),
        Spacer(1, 6),
        Paragraph(f"<b>{_esc(assessment['title'])}</b>", S["body"]),
        Paragraph(" · ".join(x for x in (f"Completed {when}" if when else "", rank) if x), S["muted"]),
    ]
    right = [
        _png(_gauge(row.get("score"), band), 30 * mm),
        Spacer(1, 2),
        Paragraph(f"<para alignment='center'><b>{_band_pill(band)}</b></para>", S["body"]),
    ]
    head = Table([[left, right]], colWidths=[CONTENT_W - 44 * mm, 44 * mm])
    head.setStyle(_style(("ALIGN", (1, 0), (1, 0), "CENTER"), ("VALIGN", (1, 0), (1, 0), "MIDDLE")))
    out: list[Any] = [_Marker(row["name"]), head]
    if advice:
        out += [Spacer(1, 6), _panel([Paragraph(f"<b>Suggested next step:</b> {_esc(advice)}", S["body"])], CONTENT_W, bg=GREEN_BG if band in ("Strong", "Good") else (AMBER_BG if band == "Developing" else MIST), pad=8)]
    return out


def _quote(label: str, skill: str, quote: str, source: str, bg: str, width: float) -> Table:
    return _panel(
        [
            Paragraph(f"{_esc(label).upper()} · {_esc(skill)}", S["kpil"]),
            Spacer(1, 3),
            Paragraph(f"“{_esc(_clip(quote, 220))}”" if source != "event" else f"<b>{_esc(_clip(quote, 220))}</b>", S["body"]),
            Paragraph(_esc(SOURCE_LABEL.get(source, "Evidence")), S["muted"]),
        ],
        width,
        bg=bg,
        pad=9,
    )


# ---------------------------------------------------------------- one-page summary


def _summary_page(c: dict[str, Any], company: str, assessment: dict[str, Any], cohort: dict[str, float | None]) -> list[Any]:
    row, ev = c["row"], c.get("evaluation")
    half = (CONTENT_W - 6 * mm) / 2
    values = [row["skills"].get(k) for k in SKILLS]
    group = [cohort.get(k) for k in SKILLS]
    content: list[Any] = [*_header(c, company, assessment, "Single summary"), Spacer(1, 8), _kpi_row(_facts(row), CONTENT_W), Spacer(1, 10)]

    # Skill profile: spider chart beside the exact numbers.
    bars = _hbars([SKILLS[k][0] for k in SKILLS], values, compare=group, size=(4.3, 2.3))
    charts = Table(
        [[
            [Paragraph("Skill profile", S["h3"]), _png(_radar(values, group), half * 0.96)],
            [Paragraph("Scores (0–100)", S["h3"]), Paragraph("Black = this candidate · grey = group average", S["muted"]), Spacer(1, 4), _png(bars, half)],
        ]],
        colWidths=[half + 6 * mm, half],
    )
    charts.setStyle(_style())
    content += [charts, Spacer(1, 8)]

    strengths = row.get("strengths") or []
    gaps = row.get("gaps") or []
    s_lines = [Paragraph("STRENGTHS", S["kpil"]), Spacer(1, 3)]
    s_lines += [Paragraph(f"<b>{_esc(name)}</b> — {_esc(next((d for n, d in SKILLS.values() if n == name), ''))}", S["cell"]) for name in strengths[:3]] or [Paragraph("No skill reached the strong level in this exercise.", S["cell"])]
    g_lines = [Paragraph("AREAS TO PROBE IN INTERVIEW", S["kpil"]), Spacer(1, 3)]
    g_lines += [Paragraph(f"<b>{_esc(g['skill'])}</b>" + (f" — {_esc(_clip(g['advice'], 150))}" if g.get("advice") else ""), S["cell"]) for g in gaps[:3]] or [Paragraph("No major gaps found.", S["cell"])]
    sg = Table([[_panel(s_lines, half, GREEN_BG, 9), _panel(g_lines, half, AMBER_BG, 9)]], colWidths=[half + 6 * mm, half])
    sg.setStyle(_style())
    content += [sg, Spacer(1, 8)]

    if row.get("summary"):
        content += [_panel([Paragraph("EVALUATOR'S VERDICT", S["kpil"]), Spacer(1, 3), Paragraph(_esc(_clip(row["summary"], 420)), S["body"])], CONTENT_W, pad=9), Spacer(1, 8)]

    best, worst = _moments(ev)
    if best or worst:
        cells = []
        if best:
            cells.append(_quote("Best moment", best[0]["criterion_name"], best[1].get("quote", ""), best[1].get("source_type", ""), GREEN_BG, half if worst else CONTENT_W))
        if worst:
            cells.append(_quote("Biggest gap", worst[0]["criterion_name"], worst[1].get("quote", ""), worst[1].get("source_type", ""), AMBER_BG, half))
        q = Table([cells], colWidths=[half + 6 * mm, half] if len(cells) == 2 else [CONTENT_W])
        q.setStyle(_style())
        content += [q, Spacer(1, 6)]

    content.append(Paragraph("A structured work sample from a simulated workday, scored against written anchors with quoted evidence. Use it alongside interviews and references. The in-detail review has every score's evidence and the full transcript.", S["muted"]))
    # Always one page: scale the whole page down if a long name or summary pushes it over.
    return [KeepInFrame(CONTENT_W, FRAME_H, content, mode="shrink"), PageBreak()]


# ---------------------------------------------------------------- in-detail review


def _score_dots(score: int | None, maximum: int) -> str:
    if score is None:
        return f"<font color='{MUTED}'>○○○○</font>"
    return f"<font color='{INK}'>{'●' * score}</font><font color='{HAIR}'>{'●' * (maximum - score)}</font>"


def _detailed(c: dict[str, Any], company: str, assessment: dict[str, Any], cohort: dict[str, float | None]) -> list[Any]:
    row, ev = c["row"], c.get("evaluation") or {}
    out: list[Any] = [*_header(c, company, assessment, "In-detail review"), Spacer(1, 8), _kpi_row(_facts(row), CONTENT_W), Spacer(1, 10)]
    if row.get("summary"):
        out += [Paragraph("Evaluator's verdict", S["h2"]), Paragraph(_esc(row["summary"]), S["body"]), Spacer(1, 6)]
    values = [row["skills"].get(k) for k in SKILLS]
    group = [cohort.get(k) for k in SKILLS]
    out += [
        Paragraph("Skill profile", S["h2"]),
        Paragraph("Black bar = this candidate. Grey bar = average of everyone who completed this assessment.", S["muted"]),
        _png(_hbars([SKILLS[k][0] for k in SKILLS], values, compare=group), CONTENT_W * 0.9),
    ]

    # 1. Skill by skill, with quoted evidence and the checks behind it.
    ledger = ev.get("ledger") or {}
    out += [PageBreak(), Paragraph("Skill-by-skill review", S["h2"]), Paragraph("Each skill is rated 0–4 against written anchors. Quotes are the candidate's own words or actions that the score rests on.", S["muted"]), Spacer(1, 4)]
    for it in _items(ev):
        name = it["criterion_name"]
        pct = row["skills"].get(it["criterion_id"])
        status = STATUS_LABEL.get(it.get("status", ""), "")
        head = Table(
            [[Paragraph(f"<b>{_esc(name)}</b>", S["h3"]), Paragraph(f"<para alignment='right'>{_score_dots(it.get('score'), it.get('score_max', 4))} &nbsp;<b>{'' if it.get('score') is None else f'{it['score']}/{it.get('score_max', 4)}'}</b>{f' · {pct:g}/100' if pct is not None else ''}{f' · {status}' if status else ''}</para>", S["body"])]],
            colWidths=[CONTENT_W * 0.5, CONTENT_W * 0.5],
        )
        head.setStyle(_style(("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor(HAIR)), ("BOTTOMPADDING", (0, 0), (-1, 0), 3)))
        block: list[Any] = [head, Spacer(1, 4)]
        if it.get("explanation"):
            block.append(Paragraph(_esc(it["explanation"]), S["body"]))
        if it.get("recommendation"):
            block += [Spacer(1, 3), Paragraph(f"<b>To improve:</b> {_esc(it['recommendation'])}", S["body"])]
        for e in it.get("evidence") or []:
            text = evidence_text(e, ev)
            if not text:
                continue
            shown = f"“{_esc(text)}”" if (e.get("quote") or "").strip() else f"<b>{_esc(text)}</b>"
            block += [Spacer(1, 4), _panel([Paragraph(shown, S["body"]), Paragraph(_esc(SOURCE_LABEL.get(e.get("source_type", ""), "Evidence")), S["muted"])], CONTENT_W, pad=7)]
        for e in it.get("counterevidence") or []:
            block += [Spacer(1, 4), _panel([Paragraph(f"<b>Against:</b> “{_esc(e.get('quote', ''))}”", S["body"])], CONTENT_W, bg=AMBER_BG, pad=7)]
        checks = ledger.get(it["criterion_id"]) or []
        if checks:
            rows = [[Paragraph("<b>✓</b>" if ch["passed"] else f"<font color='{BAND_COLORS['Needs support']}'><b>✗</b></font>", S["cell"]), Paragraph(_esc(ch["label"]) + (f" <font color='{MUTED}'>({_esc(ch['detail'])})</font>" if ch.get("detail") else ""), S["cell"])] for ch in checks]
            ct = Table(rows, colWidths=[7 * mm, CONTENT_W - 7 * mm])
            ct.setStyle(_style(("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)))
            block += [Spacer(1, 5), Paragraph("CHECKS BEHIND THIS SKILL", S["kpil"]), Spacer(1, 2), ct]
        out += [KeepTogether(block[:4]), *block[4:], Spacer(1, 12)]

    # 2. How they communicated.
    conv = ev.get("conversation") or {}
    if conv.get("learner_turns"):
        out += [CondPageBreak(90 * mm), Paragraph("How they communicated", S["h2"])]
        stats = [
            ("Messages", str(conv.get("learner_turns", 0)), "sent by the candidate"),
            ("Questions", f"{round(100 * (conv.get('question_ratio') or 0))}%", f"{conv.get('questions', 0)} messages asked something"),
            ("Typical length", f"{conv.get('median_words', 0):g}", "words (natural speech: 5–25)"),
            ("Long messages", str(conv.get("long_turns", 0)), f"over {conv.get('long_turn_words', 40)} words"),
        ]
        out += [_kpi_row(stats, CONTENT_W), Spacer(1, 8)]
        if conv.get("people"):
            out += [Paragraph("Talk balance per colleague", S["h3"]), Paragraph("Words the candidate said to each colleague, against the colleague's replies. A good investigator spreads questions across the people who hold the facts.", S["muted"]), _png(_talk_balance(conv["people"]), CONTENT_W * 0.92)]
        if conv.get("turns"):
            out += [Paragraph("Message length over the session", S["h3"]), _png(_turns(conv["turns"], conv.get("long_turn_words", 40)), CONTENT_W * 0.92)]

    # 3. Coaching: rewrites of their own messages, and lines for next time.
    coaching = ev.get("coaching") or []
    say = ev.get("say_next_time") or []
    if coaching or say:
        out += [CondPageBreak(70 * mm), Paragraph("Coaching", S["h2"])]
        if coaching:
            data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in ("They said", "A stronger version", "Why")]]
            data += [[Paragraph(f"“{_esc(x.get('original'))}”", S["cell"]), Paragraph(f"“{_esc(x.get('better'))}”", S["cellb"]), Paragraph(_esc(x.get("why")), S["cell"])] for x in coaching]
            t = Table(data, colWidths=[CONTENT_W * 0.32, CONTENT_W * 0.38, CONTENT_W * 0.30], repeatRows=1)
            t.setStyle(_table_style())
            out += [t, Spacer(1, 8)]
        if say:
            out.append(Paragraph("What they could say next time", S["h3"]))
            data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in ("To", "Line", "Missed check")]]
            data += [[Paragraph(_esc(x.get("to")), S["cellb"]), Paragraph(f"“{_esc(x.get('say'))}”", S["cell"]), Paragraph(_esc(x.get("check")), S["cell"])] for x in say]
            t = Table(data, colWidths=[CONTENT_W * 0.2, CONTENT_W * 0.5, CONTENT_W * 0.3], repeatRows=1)
            t.setStyle(_table_style())
            out.append(t)

    # 4. Full transcript.
    transcript = c.get("transcript") or []
    if transcript:
        out += [PageBreak(), Paragraph("Full transcript", S["h2"]), Paragraph("Every message exchanged during the session, in order.", S["muted"]), Spacer(1, 4)]
        data = [[Paragraph("<b>Time</b>", S["cell"]), Paragraph("<b>Speaker</b>", S["cell"]), Paragraph("<b>Message</b>", S["cell"])]]
        for m in transcript:
            mine = m.get("speaker") == "candidate"
            when = (m.get("created_at") or "")[11:16]
            data.append([Paragraph(_esc(when), S["muted"]), Paragraph(f"<b>{_esc(row['name'] if mine else m.get('speaker'))}</b>" if mine else _esc(m.get("speaker")), S["cell"]), Paragraph(_esc(m.get("content")), S["cellb" if mine else "cell"])])
        t = Table(data, colWidths=[13 * mm, 34 * mm, CONTENT_W - 47 * mm], repeatRows=1)
        style = _table_style()
        for i, m in enumerate(transcript, 1):
            if m.get("speaker") == "candidate":
                style.add("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fafafa"))
        t.setStyle(style)
        out.append(t)
    out.append(PageBreak())
    return out


def _method() -> list[Any]:
    gl = [[Paragraph("<b>Skill</b>", S["cell"]), Paragraph("<b>What we looked for</b>", S["cell"])]]
    gl += [[Paragraph(f"<b>{n}</b>", S["cell"]), Paragraph(_esc(d), S["cell"])] for n, d in SKILLS.values()]
    gt = Table(gl, colWidths=[45 * mm, CONTENT_W - 45 * mm])
    gt.setStyle(_table_style())
    bands = [[Paragraph("<b>Band</b>", S["cell"]), Paragraph("<b>Score</b>", S["cell"]), Paragraph("<b>Meaning</b>", S["cell"])]]
    for label, rng, meaning in (("Strong", "80–100", "Clearly demonstrated the skills."), ("Good", "65–79", "Solid, with minor gaps to probe."), ("Developing", "50–64", "Some skills shown; probe the gaps."), ("Needs support", "0–49", "Key skills were not demonstrated.")):
        bands.append([Paragraph(_band_pill(label), S["cell"]), Paragraph(rng, S["cell"]), Paragraph(meaning, S["cell"])])
    bt = Table(bands, colWidths=[35 * mm, 22 * mm, CONTENT_W - 57 * mm])
    bt.setStyle(_table_style())
    return [
        _Marker("Method"),
        Paragraph("How to read these scores", S["h2"]),
        gt,
        Spacer(1, 10),
        bt,
        Spacer(1, 10),
        Paragraph(
            "Each skill is rated 0–4 against written anchors by an AI evaluator that may only cite the candidate's own messages and actions; "
            "the overall score is the average of rated skills scaled to 100. 'Not enough evidence' means the candidate didn't do enough for "
            "that skill to be judged. This is a structured work sample from a simulated workday — combine it with interviews and references, "
            "and don't use it as the only basis for a hiring decision.",
            S["body"],
        ),
    ]


def _cover(candidates: list[dict[str, Any]], company: str, assessment: dict[str, Any], kind: Kind) -> list[Any]:
    label = "Single summaries" if kind == "summary" else "In-detail reviews"
    data = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in ("Candidate", "Score", "Band", "Completed")]]
    for c in candidates:
        r = c["row"]
        data.append([Paragraph(f"<b>{_esc(r['name'])}</b><br/><font size=7 color='{MUTED}'>{_esc(r['email'])}</font>", S["cell"]), Paragraph(f"<b>{r['score']:g}</b>" if r.get("score") is not None else "—", S["cell"]), Paragraph(_band_pill((r.get("band") or {}).get("label")), S["cell"]), Paragraph(_esc((r.get("completed_at") or "")[:10]), S["cell"])])
    t = Table(data, colWidths=[CONTENT_W - 80 * mm, 20 * mm, 32 * mm, 28 * mm], repeatRows=1)
    t.setStyle(_table_style())
    return [
        _Marker("Contents"),
        Paragraph(f"{_esc(company).upper()} · CANDIDATE REPORTS · {datetime.now(UTC).strftime('%d %b %Y').upper()}", S["eyebrow"]),
        Spacer(1, 4),
        Paragraph(_esc(assessment["title"]), S["h1"]),
        Paragraph(f"{label} for {len(candidates)} candidates, highest score first.", S["muted"]),
        Spacer(1, 12),
        t,
        PageBreak(),
    ]


def build_candidate_pdf(*, kind: Kind, company: str, assessment: dict[str, Any], candidates: list[dict[str, Any]], cohort: dict[str, float | None]) -> bytes:
    """`candidates`: [{row, evaluation, transcript, rank, ranked}] — completed candidates only."""
    buf = io.BytesIO()
    label = "Single summary" if kind == "summary" else "In-detail review"
    who = candidates[0]["row"]["name"] if len(candidates) == 1 else f"{len(candidates)} candidates"
    doc = _doc(buf, f"{who} — {label} — {assessment['title']}", company, f"{company} · {label}")
    story: list[Any] = []
    if len(candidates) > 1:
        story += _cover(candidates, company, assessment, kind)
    for c in candidates:
        story += _summary_page(c, company, assessment, cohort) if kind == "summary" else _detailed(c, company, assessment, cohort)
    if kind == "detailed":
        story += _method()
    elif story and isinstance(story[-1], PageBreak):
        story.pop()  # no blank page after the last summary
    doc.build(story)
    return buf.getvalue()
