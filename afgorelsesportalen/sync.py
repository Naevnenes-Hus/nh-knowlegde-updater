"""Core synchronization logic for downloading decisions from Afgørelsesportalen.

This module exposes two public helpers:

``handle_prompt``
    Minimal wrapper that can be plugged into OpenWebUI's python function API. When
    the incoming prompt matches the Danish instruction *"hent alle afgørelser fra
    afgørelsesportalerne"* the knowledge archive is refreshed.

``update_decision_knowledge``
    Stand-alone utility that implements the crawling workflow. The function can
    also be imported and executed directly when building automations or tests.

The implementation purposely avoids any external state except the knowledge
archive folder which mirrors the structure of the original TypeScript project.
Each board ("nævn") gets its own folder named ``"<board> afgørelser"`` where the
individual decisions are stored as UTF-8 encoded ``.txt`` files.  A GUID derived
from the decision URL is used as filename to guarantee idempotency.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import logging
import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET

__all__ = [
    "Decision",
    "handle_prompt",
    "update_decision_knowledge",
]

DEFAULT_PORTAL_SITEMAP = "https://afgoerelsesportalen.dk/sitemap.xml"
USER_AGENT = "Mozilla/5.0 (compatible; NH-Knowledge-Updater/2.0; +https://github.com)"
REQUEST_TIMEOUT = 30

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Decision:
    """Representation of a single decision entry."""

    guid: str
    board: str
    url: str
    title: str
    published: Optional[datetime]
    body: str

    def as_text(self) -> str:
        """Format the decision as a plain text document suitable for archives."""

        published_text = self.published.isoformat() if self.published else "Unknown"
        header = [
            f"GUID: {self.guid}",
            f"Board: {self.board}",
            f"Published: {published_text}",
            f"Source: {self.url}",
            "",
            self.title,
            "=" * len(self.title),
            "",
        ]
        return "\n".join(header + [self.body.strip(), ""])


class SitemapError(RuntimeError):
    """Raised when sitemap parsing fails."""


def handle_prompt(
    prompt: str,
    *,
    archive_root: Path | str = Path("knowledge_archive"),
    sitemap_url: str = DEFAULT_PORTAL_SITEMAP,
) -> str:
    """Entry point that mimics the OpenWebUI function signature.

    Parameters
    ----------
    prompt:
        The raw user prompt received from OpenWebUI.
    archive_root:
        Base directory where knowledge archives should be stored.
    sitemap_url:
        URL of the sitemap index to crawl. Defaults to the Afgørelsesportalen
        sitemap but can be overridden for testing.

    Returns
    -------
    str
        Human-readable status message describing the synchronization outcome.
    """

    normalized = " ".join(prompt.lower().split())
    if "hent" in normalized and "afgørelser" in normalized and "portalerne" in normalized:
        logger.info("Prompt matched decision synchronization request")
        summary = update_decision_knowledge(
            archive_root=Path(archive_root),
            sitemap_url=sitemap_url,
        )
        return _format_summary(summary)

    logger.debug("Prompt did not match synchronization command: %s", prompt)
    return (
        "Ingen synkronisering udført. Skriv 'hent alle afgørelser fra "
        "afgørelsesportalerne' for at opdatere vidensarkivet."
    )


def update_decision_knowledge(
    *,
    archive_root: Path,
    sitemap_url: str = DEFAULT_PORTAL_SITEMAP,
) -> Dict[str, Tuple[int, int]]:
    """Synchronise all decisions into the local knowledge archive.

    Parameters
    ----------
    archive_root:
        Base directory where archives are stored. The folder is created if it
        does not yet exist.
    sitemap_url:
        URL to the sitemap or sitemap index used as entry point.

    Returns
    -------
    Dict[str, Tuple[int, int]]
        Mapping from board name to a tuple containing ``(existing, added)``
        counts.
    """

    archive_root.mkdir(parents=True, exist_ok=True)
    session = _build_session()

    logger.info("Downloading sitemap index from %s", sitemap_url)
    decision_urls = list(_iterate_sitemap_urls(session, sitemap_url))
    logger.info("Discovered %s potential decision URLs", len(decision_urls))

    grouped: Dict[str, List[str]] = {}
    for decision_url in decision_urls:
        guid = _extract_guid(decision_url)
        if not guid:
            continue
        board = _derive_board_name(decision_url)
        grouped.setdefault(board, []).append(decision_url)

    summary: Dict[str, Tuple[int, int]] = {}

    for board, urls in grouped.items():
        archive_dir = archive_root / f"{board} afgørelser"
        archive_dir.mkdir(parents=True, exist_ok=True)
        existing_guids = {
            path.stem for path in archive_dir.glob("*.txt") if path.is_file()
        }

        added = 0
        for url in urls:
            guid = _extract_guid(url)
            if not guid or guid in existing_guids:
                continue

            try:
                decision = _download_decision(session, url, guid, board)
            except Exception as exc:  # noqa: BLE001 - we want robust logging
                logger.warning("Failed to download decision %s: %s", url, exc)
                continue

            target_path = archive_dir / f"{guid}.txt"
            target_path.write_text(decision.as_text(), encoding="utf-8")
            existing_guids.add(guid)
            added += 1

        summary[board] = (len(existing_guids), added)

    return summary


def _format_summary(summary: Dict[str, Tuple[int, int]]) -> str:
    lines = ["Synkronisering fuldført:"]
    total_new = 0
    total_records = 0
    for board, (existing, added) in sorted(summary.items()):
        lines.append(f"- {board}: {existing} sager i alt ({added} nye)")
        total_new += added
        total_records += existing

    lines.append("")
    lines.append(f"I alt {total_records} sager i arkivet, {total_new} nye")
    return "\n".join(lines)


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def _iterate_sitemap_urls(session: requests.Session, url: str) -> Iterable[str]:
    response = session.get(url, timeout=REQUEST_TIMEOUT)
    if response.status_code >= 400:
        raise SitemapError(f"Failed to fetch sitemap {url}: HTTP {response.status_code}")

    xml_root = ET.fromstring(response.content)
    tag = _strip_namespace(xml_root.tag)

    if tag == "sitemapindex":
        for child in xml_root.findall(".//{*}loc"):
            child_url = child.text.strip() if child.text else ""
            if not child_url:
                continue
            yield from _iterate_sitemap_urls(session, child_url)
        return

    if tag != "urlset":
        raise SitemapError(f"Unsupported sitemap type '{tag}' at {url}")

    for loc in xml_root.findall(".//{*}loc"):
        if not loc.text:
            continue
        link = loc.text.strip()
        if _looks_like_decision(link):
            yield link


def _strip_namespace(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def _looks_like_decision(url: str) -> bool:
    lowered = url.lower()
    return "/afgoerelse/" in lowered or "/nyhed/" in lowered


def _extract_guid(url: str) -> Optional[str]:
    path = urlparse(url).path
    segments = [segment for segment in path.split("/") if segment]
    if not segments:
        return None
    candidate = segments[-1]
    candidate = candidate.split("?")[0]
    candidate = candidate.split("#")[0]
    return candidate or None


def _derive_board_name(url: str) -> str:
    parsed = urlparse(url)
    path_parts = [part for part in parsed.path.split("/") if part]

    if len(path_parts) >= 2 and path_parts[0].lower() in {"naevn", "nævn"}:
        slug = path_parts[1]
    elif path_parts:
        slug = path_parts[0]
    else:
        slug = parsed.netloc

    slug = slug.replace("%C3%A6", "æ")
    slug = slug.replace("-%", "-")
    cleaned = unquote(slug)
    cleaned = re.sub(r"[-_]+", " ", cleaned)
    cleaned = cleaned.replace("Naevn", "Nævn").replace("naevn", "nævn")
    cleaned = cleaned.strip()

    if not cleaned:
        return parsed.netloc

    words = [word.capitalize() for word in cleaned.split()]
    return " ".join(words)


def _download_decision(
    session: requests.Session,
    url: str,
    guid: str,
    board: str,
) -> Decision:
    response = session.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    title = _extract_title(soup) or f"Afgørelse {guid}"
    published = _extract_published(soup)
    body = _extract_body_text(soup)

    return Decision(
        guid=guid,
        board=board,
        url=url,
        title=title,
        published=published,
        body=body,
    )


def _extract_title(soup: BeautifulSoup) -> Optional[str]:
    meta = soup.find("meta", property="og:title")
    if meta and meta.get("content"):
        return meta["content"].strip()

    if soup.title and soup.title.string:
        return soup.title.string.strip()

    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        return h1.get_text(strip=True)

    return None


def _extract_published(soup: BeautifulSoup) -> Optional[datetime]:
    time_tag = soup.find("time")
    if time_tag:
        datetime_attr = time_tag.get("datetime")
        if datetime_attr:
            for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
                try:
                    return datetime.strptime(datetime_attr, fmt)
                except ValueError:
                    continue

        if time_tag.string:
            text = time_tag.get_text(strip=True)
            for fmt in ("%d.%m.%Y", "%d-%m-%Y", "%Y-%m-%d"):
                try:
                    return datetime.strptime(text, fmt)
                except ValueError:
                    continue

    return None


def _extract_body_text(soup: BeautifulSoup) -> str:
    article = soup.find("article")
    if article:
        return article.get_text("\n", strip=True)

    main = soup.find("main")
    if main:
        return main.get_text("\n", strip=True)

    body = soup.find("div", class_=re.compile("(content|article|entry)", re.I))
    if body:
        return body.get_text("\n", strip=True)

    return soup.get_text("\n", strip=True)

