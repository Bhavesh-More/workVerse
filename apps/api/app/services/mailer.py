"""Invite emails over SMTP: the company's own server when configured, else the app's fallback."""

from __future__ import annotations

import asyncio
import html
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any

from app.core.config import Settings

SECURITY = ("starttls", "ssl", "none")


def smtp_config(company_smtp: dict[str, Any] | None, settings: Settings) -> dict[str, Any] | None:
    """The SMTP settings to send with, or None if neither the company nor the app has any."""
    c = company_smtp or {}
    if c.get("host"):
        return {
            "host": c["host"],
            "port": int(c.get("port") or 587),
            "username": c.get("username") or "",
            "password": c.get("password") or "",
            "from_email": c.get("from_email") or c.get("username") or "",
            "from_name": c.get("from_name") or "",
            "security": c.get("security") if c.get("security") in SECURITY else "starttls",
        }
    if settings.smtp_host:
        return {
            "host": settings.smtp_host,
            "port": settings.smtp_port,
            "username": settings.smtp_username,
            "password": settings.smtp_password,
            "from_email": settings.smtp_from_email or settings.smtp_username,
            "from_name": settings.smtp_from_name,
            "security": settings.smtp_security if settings.smtp_security in SECURITY else "starttls",
        }
    return None


def public_smtp(company_smtp: dict[str, Any] | None) -> dict[str, Any]:
    """SMTP settings for the dashboard: everything except the password."""
    c = dict(company_smtp or {})
    has_password = bool(c.pop("password", ""))
    return {**c, "has_password": has_password}


def _send_sync(cfg: dict[str, Any], messages: list[EmailMessage]) -> list[str | None]:
    """Send over one connection; returns an error string (or None) per message."""
    results: list[str | None] = []
    ctx = ssl.create_default_context()
    cls = smtplib.SMTP_SSL if cfg["security"] == "ssl" else smtplib.SMTP
    kwargs: dict[str, Any] = {"timeout": 20}
    if cfg["security"] == "ssl":
        kwargs["context"] = ctx
    with cls(cfg["host"], cfg["port"], **kwargs) as server:
        if cfg["security"] == "starttls":
            server.starttls(context=ctx)
        if cfg["username"] and cfg["password"]:
            server.login(cfg["username"], cfg["password"])
        for msg in messages:
            try:
                server.send_message(msg)
                results.append(None)
            except smtplib.SMTPException as exc:
                results.append(str(exc)[:500])
    return results


async def send_all(cfg: dict[str, Any], messages: list[EmailMessage]) -> list[str | None]:
    if not messages:
        return []
    try:
        return await asyncio.to_thread(_send_sync, cfg, messages)
    except (OSError, smtplib.SMTPException) as exc:
        err = f"{type(exc).__name__}: {exc}"[:500]
        return [err] * len(messages)


def invite_email(
    cfg: dict[str, Any],
    *,
    to: str,
    candidate_name: str | None,
    company: str,
    assessment: str,
    message: str,
    link: str,
    minutes: int = 15,
) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = f"{company} invited you to a workplace assessment: {assessment}"
    msg["From"] = formataddr((cfg["from_name"] or company, cfg["from_email"]))
    msg["To"] = to
    hello = f"Hi {candidate_name}," if candidate_name else "Hi,"
    note = f"\n\nA note from {company}:\n{message}" if message else ""
    msg.set_content(
        f"{hello}\n\n{company} has invited you to complete \"{assessment}\" on WorkVerse, a short "
        f"simulated workday (about {minutes} minutes). You'll talk to AI colleagues, investigate a "
        f"realistic problem and decide what to do. There are no trick questions.{note}\n\n"
        f"Start here: {link}\n\nGood luck!\n— {company} via WorkVerse"
    )
    e = html.escape
    note_html = (
        f'<p style="margin:0 0 16px;padding:12px 14px;background:#f5f5f5;border-radius:8px">'
        f"<b>A note from {e(company)}:</b><br>{e(message)}</p>"
        if message
        else ""
    )
    msg.add_alternative(
        f"""<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#141414">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:32px">
<tr><td>
<p style="font-family:monospace;letter-spacing:.06em;font-size:12px;text-transform:uppercase;color:#6b6b6b;margin:0 0 12px">{e(company)} · assessment invite</p>
<h1 style="font-size:26px;margin:0 0 16px;font-weight:600">{e(assessment)}</h1>
<p style="margin:0 0 16px;line-height:1.5">{e(hello)}</p>
<p style="margin:0 0 16px;line-height:1.5">{e(company)} has invited you to a short simulated workday (about {minutes} minutes).
You'll talk to AI colleagues, investigate a realistic problem and decide what to do. There are no trick questions.</p>
{note_html}
<p style="margin:24px 0"><a href="{e(link)}" style="background:#141414;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-family:monospace;letter-spacing:.06em;text-transform:uppercase;font-size:13px">Start assessment</a></p>
<p style="margin:0;font-size:12px;color:#6b6b6b;line-height:1.5">Or paste this link into your browser:<br>{e(link)}</p>
</td></tr></table></td></tr></table></body></html>""",
        subtype="html",
    )
    return msg


def test_email(cfg: dict[str, Any], to: str, company: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = f"{company}: SMTP test from WorkVerse"
    msg["From"] = formataddr((cfg["from_name"] or company, cfg["from_email"]))
    msg["To"] = to
    msg.set_content("Your SMTP settings work. Candidate invites will be sent from this address.")
    return msg
