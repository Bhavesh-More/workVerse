"""Read the learner's footprint: CV/LinkedIn PDF text, GitHub, LinkedIn and portfolio pages.

Everything here is untrusted input. Fetches only go to public internet hosts (each redirect hop
is re-checked), responses are size-capped, and extracted text is clipped before it is stored or
shown to a model. Every reader returns a source record ``{"ok": bool, "error": str | None, ...}``
instead of raising, so one unreachable site never blocks the rest of the context.
"""

from __future__ import annotations

import asyncio
import io
import ipaddress
import json
import re
import socket
import zipfile
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
MAX_PAGE_BYTES = 1_500_000
MAX_DOCUMENT_CHARS = 20_000
MAX_PAGE_CHARS = 6_000
MAX_PDF_PAGES = 15
MAX_REDIRECTS = 3

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0 Safari/537.36"
)
_GITHUB_USER = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
_GITHUB_RESERVED = {"orgs", "settings", "about", "features", "topics", "explore", "marketplace", "sponsors"}
_URL = re.compile(r"(?:https?://|www\.)[^\s<>()\"'\]\[,;]+|(?:github\.com|linkedin\.com)/[^\s<>()\"'\]\[,;]+", re.I)


class SourceError(Exception):
    """A user-facing reason a source could not be read."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _squash(text: str, limit: int) -> str:
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()[:limit]


# ---------------------------------------------------------------- documents (CV, LinkedIn PDF)


def _pdf_text(data: bytes) -> tuple[str, list[str]]:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            reader.decrypt("")
        pages = reader.pages[:MAX_PDF_PAGES]
        text = "\n\n".join((page.extract_text() or "") for page in pages)
    except Exception as exc:  # noqa: BLE001 - pypdf raises many types for broken files
        raise SourceError("That PDF could not be read. Try exporting it again, or upload a .docx/.txt.") from exc
    # CVs often hide profile links behind words ("GitHub"), so read the link annotations too.
    links: list[str] = []
    for page in pages:
        try:
            for annot in page.get("/Annots") or []:
                uri = (annot.get_object().get("/A") or {}).get("/URI")
                if isinstance(uri, str):
                    links.append(uri)
        except Exception:  # noqa: BLE001 - a bad annotation never fails the document
            continue
    return text, links


def _docx_text(data: bytes) -> tuple[str, list[str]]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
            rels = z.read("word/_rels/document.xml.rels").decode("utf-8", "ignore") if "word/_rels/document.xml.rels" in z.namelist() else ""
    except (zipfile.BadZipFile, KeyError) as exc:
        raise SourceError("That Word file could not be read. Try saving it as PDF.") from exc
    xml = re.sub(r"</w:p>|<w:br[^>]*/>|<w:tab[^>]*/>", "\n", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    links = re.findall(r'Target="(https?://[^"]+)"[^>]*TargetMode="External"', rels)
    return _unescape(text), links


def _unescape(text: str) -> str:
    import html

    return html.unescape(text)


def read_document(filename: str, data: bytes) -> dict[str, Any]:
    """Extract text and links from an uploaded CV / LinkedIn export. Raises SourceError."""
    if not data:
        raise SourceError("The file is empty.")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise SourceError("Files can be up to 5 MB.")
    name = (filename or "document").lower()
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        text, links = _pdf_text(data)
    elif name.endswith(".docx"):
        text, links = _docx_text(data)
    elif name.endswith((".txt", ".md")):
        text, links = data.decode("utf-8", "ignore"), []
    else:
        raise SourceError("Upload a PDF, Word (.docx) or text file.")
    text = _squash(text, MAX_DOCUMENT_CHARS)
    if len(text) < 40:
        raise SourceError(
            "We couldn't find text in that file — it may be a scanned image. Try a text-based PDF or .docx."
        )
    return {
        "ok": True,
        "error": None,
        "filename": (filename or "document")[-120:],
        "fetched_at": _now(),
        "text": text,
        "links": find_profile_links(text, links),
    }


def find_profile_links(text: str, extra: list[str] | None = None) -> dict[str, str]:
    """The learner's GitHub, LinkedIn and first other website mentioned in a document."""
    found: dict[str, str] = {}
    for raw in [*(extra or []), *_URL.findall(text)]:
        url = raw.rstrip(".)")
        if not url.lower().startswith("http"):
            url = "https://" + url
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")
        path = urlparse(url).path.strip("/")
        if host == "github.com" and path and "github" not in found:
            user = github_username(url)
            if user:
                found["github"] = f"https://github.com/{user}"
        elif host.endswith("linkedin.com") and path.startswith("in/") and "linkedin" not in found:
            found["linkedin"] = f"https://www.linkedin.com/{'/'.join(path.split('/')[:2])}"
        elif (
            host
            and "." in host
            and "portfolio" not in found
            and not host.endswith(("linkedin.com", "github.com", "gmail.com", "google.com"))
            and "@" not in url
        ):
            found["portfolio"] = url
    return found


# ---------------------------------------------------------------- safe fetching


def _is_public_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return addr.is_global and not addr.is_multicast


async def ensure_public_host(host: str) -> None:
    """Refuse hosts that resolve to private, loopback, link-local or reserved addresses."""
    if not host or host.lower() in {"localhost", "host.docker.internal"} or host.endswith(".local"):
        raise SourceError("That address isn't a public website.")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise SourceError("That website's address could not be found.") from exc
    # ponytail: checked at resolve time, so DNS rebinding between check and connect is possible;
    # pin the resolved IP in the transport if this ever fetches anything sensitive.
    if not infos or not all(_is_public_ip(info[4][0]) for info in infos):
        raise SourceError("That address isn't a public website.")


def normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        raise SourceError("No link given.")
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise SourceError("That doesn't look like a web link.")
    if parsed.port not in (None, 80, 443):
        raise SourceError("Links on non-standard ports aren't supported.")
    return url


async def fetch_page(client: httpx.AsyncClient, url: str, headers: dict[str, str] | None = None) -> tuple[int, str, str]:
    """GET a public page following at most MAX_REDIRECTS hops. Returns (status, final url, html)."""
    url = normalize_url(url)
    for _ in range(MAX_REDIRECTS + 1):
        await ensure_public_host(urlparse(url).hostname or "")
        async with client.stream("GET", url, headers=headers, follow_redirects=False) as resp:
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                url = normalize_url(urljoin(url, resp.headers["location"]))
                continue
            kind = resp.headers.get("content-type", "")
            if resp.status_code < 400 and "html" not in kind and "text" not in kind:
                raise SourceError("That link isn't a web page.")
            body = bytearray()
            async for chunk in resp.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_PAGE_BYTES:
                    break
            return resp.status_code, url, body.decode(resp.encoding or "utf-8", "ignore")
    raise SourceError("That link redirects too many times.")


class _PageParser(HTMLParser):
    """Visible text, title, meta descriptions, JSON-LD blocks and outgoing links of a page."""

    _SKIP = {"script", "style", "noscript", "svg", "template", "iframe", "head"}
    _BLOCK = {"p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "tr", "header", "footer"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []
        self.title = ""
        self.meta: dict[str, str] = {}
        self.json_ld: list[str] = []
        self.links: list[str] = []
        self._skip = 0
        self._in_title = False
        self._in_ld = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: v or "" for k, v in attrs}
        if tag == "script" and a.get("type") == "application/ld+json":
            self._in_ld = True
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key in {"description", "og:title", "og:description", "twitter:description", "profile:first_name", "profile:last_name"}:
                self.meta[key] = a.get("content", "")[:500]
        if tag == "a" and a.get("href", "").startswith("http"):
            self.links.append(a["href"])
        if tag in self._SKIP:
            self._skip += 1
        if tag in self._BLOCK:
            self.text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag == "script":
            self._in_ld = False
        if tag in self._SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if self._in_ld:
            self.json_ld.append(data)
        elif self._in_title:
            self.title += data
        elif not self._skip:
            self.text.append(data)


def parse_page(html: str) -> dict[str, Any]:
    parser = _PageParser()
    try:
        parser.feed(html)
    except Exception:  # noqa: BLE001 - malformed HTML still yields what was parsed
        pass
    people = []
    for block in parser.json_ld:
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        nodes = data.get("@graph", [data]) if isinstance(data, dict) else data if isinstance(data, list) else []
        people.extend(n for n in nodes if isinstance(n, dict) and n.get("@type") == "Person")
    return {
        "title": " ".join(parser.title.split())[:200],
        "description": parser.meta.get("og:description") or parser.meta.get("description") or "",
        "meta": parser.meta,
        "person": people[0] if people else None,
        "text": _squash("".join(parser.text), MAX_PAGE_CHARS),
        "links": list(dict.fromkeys(parser.links))[:40],
    }


# ---------------------------------------------------------------- GitHub


def github_username(value: str) -> str | None:
    value = (value or "").strip().removeprefix("@")
    if "github.com" in value.lower():
        path = urlparse(value if "//" in value else "https://" + value).path.strip("/")
        value = path.split("/")[0] if path else ""
    return value if _GITHUB_USER.match(value) and value.lower() not in _GITHUB_RESERVED else None


async def read_github(client: httpx.AsyncClient, url: str, token: str = "") -> dict[str, Any]:
    """Public profile, recently pushed repositories, languages and short READMEs via the REST API."""
    user = github_username(url)
    if not user:
        return _failed(url, "That doesn't look like a GitHub profile link (github.com/<username>).")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "WorkVerse-context-builder"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    api = "https://api.github.com"
    try:
        prof = await client.get(f"{api}/users/{user}", headers=headers)
        if prof.status_code == 404:
            return _failed(url, f"GitHub has no user called {user}.")
        if prof.status_code in (403, 429):
            return _failed(url, "GitHub is rate-limiting us right now. Try rebuilding in a few minutes.")
        prof.raise_for_status()
        repos_resp = await client.get(
            f"{api}/users/{user}/repos",
            params={"sort": "pushed", "per_page": 30, "type": "owner"},
            headers=headers,
        )
        repos_resp.raise_for_status()
    except httpx.HTTPError:
        return _failed(url, "GitHub could not be reached.")
    p = prof.json()
    repos = [r for r in repos_resp.json() if isinstance(r, dict)]
    own = [r for r in repos if not r.get("fork") and not r.get("archived")]
    own.sort(key=lambda r: (r.get("stargazers_count") or 0, r.get("pushed_at") or ""), reverse=True)
    top = own[:6]

    async def readme(repo: dict[str, Any]) -> str:
        try:
            r = await client.get(
                f"{api}/repos/{user}/{repo['name']}/readme",
                headers={**headers, "Accept": "application/vnd.github.raw"},
            )
            return _squash(re.sub(r"!\[[^\]]*\]\([^)]*\)|<[^>]+>", "", r.text), 900) if r.status_code == 200 else ""
        except httpx.HTTPError:
            return ""

    readmes = await asyncio.gather(*(readme(r) for r in top[:4]))
    languages: dict[str, int] = {}
    for r in own:
        if r.get("language"):
            languages[r["language"]] = languages.get(r["language"], 0) + 1
    return {
        "ok": True,
        "error": None,
        "url": f"https://github.com/{user}",
        "fetched_at": _now(),
        "login": user,
        "name": p.get("name"),
        "bio": (p.get("bio") or "")[:300],
        "company": p.get("company"),
        "blog": p.get("blog"),
        "location": p.get("location"),
        "public_repos": p.get("public_repos"),
        "followers": p.get("followers"),
        "member_since": (p.get("created_at") or "")[:4],
        "languages": dict(sorted(languages.items(), key=lambda kv: -kv[1])[:10]),
        "repos": [
            {
                "name": r.get("name"),
                "description": (r.get("description") or "")[:240],
                "language": r.get("language"),
                "topics": (r.get("topics") or [])[:8],
                "stars": r.get("stargazers_count") or 0,
                "pushed_at": (r.get("pushed_at") or "")[:10],
                "readme": readmes[i] if i < len(readmes) else "",
            }
            for i, r in enumerate(top)
        ],
        "forks_count": sum(1 for r in repos if r.get("fork")),
    }


# ---------------------------------------------------------------- LinkedIn and portfolio

LINKEDIN_BLOCKED = (
    "LinkedIn doesn't let apps read profiles automatically. Upload your LinkedIn PDF instead "
    "(your profile → More → Save to PDF)."
)


def linkedin_url(value: str) -> str | None:
    try:
        url = normalize_url(value)
    except SourceError:
        return None
    parsed = urlparse(url)
    parts = parsed.path.strip("/").split("/")
    if not (parsed.hostname or "").lower().endswith("linkedin.com") or len(parts) < 2 or parts[0] != "in":
        return None
    return f"https://www.linkedin.com/in/{parts[1]}"


async def read_linkedin(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    """Best effort: the public profile page's metadata. LinkedIn usually answers with an auth wall."""
    canonical = linkedin_url(url)
    if not canonical:
        return _failed(url, "That doesn't look like a LinkedIn profile link (linkedin.com/in/<name>).")
    try:
        status, final, html = await fetch_page(client, canonical, {"User-Agent": _BROWSER_UA, "Accept-Language": "en"})
    except (SourceError, httpx.HTTPError):
        return _failed(canonical, LINKEDIN_BLOCKED)
    page = parse_page(html)
    walled = status >= 400 or "authwall" in final or "login" in urlparse(final).path or not page["description"]
    if walled and not page["person"]:
        return _failed(canonical, LINKEDIN_BLOCKED)
    person = page["person"] or {}
    works = person.get("worksFor") or []
    alumni = person.get("alumniOf") or []
    return {
        "ok": True,
        "error": None,
        "url": canonical,
        "fetched_at": _now(),
        "headline": page["meta"].get("og:title") or page["title"],
        "about": (person.get("description") or page["description"])[:1500],
        "job_title": person.get("jobTitle"),
        "works_for": [w.get("name") for w in works if isinstance(w, dict) and w.get("name")][:5],
        "education": [a.get("name") for a in alumni if isinstance(a, dict) and a.get("name")][:5],
    }


async def read_portfolio(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    try:
        status, final, html = await fetch_page(client, url, {"User-Agent": _BROWSER_UA})
    except SourceError as exc:
        return _failed(url, str(exc))
    except httpx.HTTPError:
        return _failed(url, "That website could not be reached.")
    if status >= 400:
        return _failed(url, f"That website answered with an error ({status}).")
    page = parse_page(html)
    if len(page["text"]) < 40 and not page["description"]:
        return _failed(url, "That page has almost no readable text (it may need JavaScript to render).")
    return {
        "ok": True,
        "error": None,
        "url": final,
        "fetched_at": _now(),
        "title": page["title"],
        "description": page["description"][:500],
        "text": page["text"],
    }


def _failed(url: str, error: str) -> dict[str, Any]:
    return {"ok": False, "error": error, "url": url, "fetched_at": _now()}
