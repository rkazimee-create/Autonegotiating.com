#!/usr/bin/env python3
"""Bounded public SEO smoke checks, including a tiny attested VIN-page sample."""

from __future__ import annotations

import html
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

DEFAULT_BASE_URL = "https://www.autonegotiating.com"
REQUEST_TIMEOUT_SECONDS = 8
MAX_REQUESTS = 80
MAX_SITEMAPS = 20
MAX_SEO_PAGES = 60
MAX_RUNTIME_SECONDS = 120
MAX_RESPONSE_BYTES = 8_000_000
YEAR_THRESHOLD = 3
ENTITY_THRESHOLD = 2
PAGE_SIZE = 100
MAX_VIN_SAMPLES = 5
TARGET_VIN = "1GYTEDKL5SU107838"
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
KNOWN_ALIASES = (
    "/cars/bmw/5-series-want4r",
    "/cars/bmw/5-series-cuovff",
)
INVALID_YEAR_ROUTES = (
    "/cars/bmw/m550i/oregon",
    "/cars/bmw/m550i/or",
    "/cars/bmw/m550i/not-a-filter",
)
PHASE3A_ENTITY_MODEL_FAMILIES = {
    "/cars/bmw/530i": "/cars/bmw/5-series",
    "/cars/bmw/540i": "/cars/bmw/5-series",
    "/cars/bmw/m550i": "/cars/bmw/5-series",
    "/cars/bmw/m340i": "/cars/bmw/3-series",
    "/cars/bmw/840i": "/cars/bmw/8-series",
    "/cars/bmw/m850i": "/cars/bmw/8-series",
}
PHASE3A_ENTITY_PATHS = set(PHASE3A_ENTITY_MODEL_FAMILIES)
OBSOLETE_SEARCH_URL = "/?make={make}&model={model}"
STATIC_PATHS = {"/", "/deal-intelligence.html", "/trade-intelligence.html", "/cars"}
YEAR_RE = re.compile(r"^(?:19|20)\d{2}$")
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
# Independently reviewed read-only runtime snapshot. Never approve a digest
# automatically; covered source changes require a fresh review.
AUDITED_SAFE_SOURCE_FINGERPRINTS: frozenset[str] = frozenset({
    "12bea345194844601230297a744d582b2bd47bd9be838130ec4c9ec8da790e93",
})
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SAFETY_MANIFEST = json.loads(
    (_REPO_ROOT / "scripts/seo-read-safety-sources.json").read_text(encoding="utf-8")
)
SAFETY_SOURCE_FILES = tuple(sorted(set(
    _SAFETY_MANIFEST["files"] + [
        str(path.relative_to(_REPO_ROOT))
        for directory in _SAFETY_MANIFEST["runtimeTrees"]
        for path in (_REPO_ROOT / directory).rglob("*.ts")
        if not path.name.endswith(".test.ts")
    ]
)))


class SmokeFailure(Exception):
    pass


class BudgetExceeded(SmokeFailure):
    pass


def source_safety_guard(repo_root: Path) -> tuple[bool, str]:
    """Only a manually reviewed exact source snapshot may ever enable network access."""
    sources: list[tuple[str, str]] = []
    try:
        for relative_path in SAFETY_SOURCE_FILES:
            sources.append((relative_path, (repo_root / relative_path).read_text(encoding="utf-8")))
    except OSError as exc:
        return False, f"cannot verify SEO read path source ({exc})"

    combined = "\n".join(content for _, content in sources)
    if (
        re.search(r"async function qualifiedCutoff[^}]*await refreshStaleInventory\(\)", combined)
        and "db.update(activeInventory)" in combined
        and "queueIndexNow(" in combined
    ):
        return False, "qualifiedCutoff() invokes refreshStaleInventory(), which writes inventory and queues IndexNow"

    digest_input = "".join(f"{path}\0{content}\0" for path, content in sources).encode("utf-8")
    fingerprint = hashlib.sha256(digest_input).hexdigest()
    if fingerprint not in AUDITED_SAFE_SOURCE_FINGERPRINTS:
        return False, "SEO read-path source snapshot is not explicitly audited; safety cannot be proven"
    return True, f"explicitly audited SEO read-path snapshot {fingerprint}"


def canonical_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        port = parts.port
        netloc = host if port in (None, 443 if parts.scheme == "https" else 80) else f"{host}:{port}"
        path = parts.path or "/"
        return urlunsplit((parts.scheme.lower(), netloc, path, parts.query, ""))
    except ValueError:
        return f"!invalid-url!{url}"


def normalized_origin(url: str) -> str:
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        port = parts.port or (443 if parts.scheme.lower() == "https" else 80)
        return f"{parts.scheme.lower()}://{host}:{port}"
    except ValueError:
        return "invalid://"


def same_public_origin(url: str, reference: str) -> bool:
    try:
        parts = urlsplit(url)
        return (
            parts.scheme == "https"
            and parts.username is None
            and parts.password is None
            and normalized_origin(url) == normalized_origin(reference)
        )
    except ValueError:
        return False


def parse_sitemap(xml_text: str) -> tuple[str, list[str]]:
    if "<!DOCTYPE" in xml_text.upper() or "<!ENTITY" in xml_text.upper():
        raise SmokeFailure("sitemap contains a forbidden DTD/entity declaration")
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise SmokeFailure(f"malformed sitemap XML: {exc}") from exc
    if root.tag == f"{{{SITEMAP_NS}}}sitemapindex":
        tag, element_name, allowed_children = "sitemapindex", "sitemap", {"loc", "lastmod"}
    elif root.tag == f"{{{SITEMAP_NS}}}urlset":
        tag, element_name, allowed_children = "urlset", "url", {"loc", "lastmod", "changefreq", "priority"}
    else:
        raise SmokeFailure(f"unexpected sitemap root element or namespace: {root.tag}")
    locations: list[str] = []
    for item in list(root):
        if item.tag != f"{{{SITEMAP_NS}}}{element_name}":
            raise SmokeFailure(f"invalid sitemap entry element: {item.tag}")
        children = list(item)
        if any(child.tag.rsplit("}", 1)[-1] not in allowed_children or not child.tag.startswith(f"{{{SITEMAP_NS}}}") for child in children):
            raise SmokeFailure("sitemap entry contains an invalid or wrong-namespace child")
        if any(list(child) for child in children):
            raise SmokeFailure("sitemap entry fields must not contain nested elements")
        child_names = [child.tag for child in children]
        if len(child_names) != len(set(child_names)):
            raise SmokeFailure("sitemap entry contains duplicate fields")
        locs = [child for child in children if child.tag == f"{{{SITEMAP_NS}}}loc"]
        if len(locs) != 1 or not (locs[0].text or "").strip():
            raise SmokeFailure("sitemap entry has no loc")
        if children[0] is not locs[0]:
            raise SmokeFailure("sitemap loc must be the first child")
        locations.append((locs[0].text or "").strip())
    if not locations:
        raise SmokeFailure(f"{tag} has no sitemap entries")
    return tag, locations


class ParsedPage(HTMLParser):
    """Small extractor built on Python's standards-aware HTMLParser."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.h1: list[str] = []
        self.meta_description: str | None = None
        self.canonicals: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.jsonld: list[Any] = []
        self.jsonld_errors: list[str] = []
        self.visible_text: list[str] = []
        self.images: list[str] = []
        self._capture: str | None = None
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "title":
            self._capture, self._buffer = "title", []
        elif tag == "h1":
            self._capture, self._buffer = "h1", []
        elif tag == "script" and (values.get("type") or "").lower() == "application/ld+json":
            self._capture, self._buffer = "jsonld", []
        elif tag == "meta" and (values.get("name") or "").lower() == "description":
            self.meta_description = values.get("content")
        elif tag == "link" and "canonical" in (values.get("rel") or "").lower().split():
            href = values.get("href")
            if href:
                self.canonicals.append(href)
        elif tag == "a" and values.get("href"):
            self.links.append((values["href"] or "", ""))
        elif tag == "img" and values.get("src"):
            self.images.append(values["src"] or "")

    def handle_endtag(self, tag: str) -> None:
        expected = {"title": "title", "h1": "h1", "script": "jsonld"}.get(tag)
        if expected and self._capture == expected:
            text = "".join(self._buffer).strip()
            if expected == "title":
                self.title = text
            elif expected == "h1":
                self.h1.append(text)
            else:
                try:
                    self.jsonld.append(json.loads(text))
                except (json.JSONDecodeError, TypeError) as exc:
                    self.jsonld_errors.append(str(exc))
            self._capture, self._buffer = None, []

    def handle_data(self, data: str) -> None:
        if self._capture != "jsonld":
            self.visible_text.append(data)
        if self._capture:
            self._buffer.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._capture:
            self._buffer.append(html.unescape(f"&{name};"))


def structured_types(page: ParsedPage) -> set[str]:
    found: set[str] = set()

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            value = node.get("@type")
            if isinstance(value, str):
                found.add(value)
            elif isinstance(value, list):
                found.update(item for item in value if isinstance(item, str))
            for item in node.values():
                visit(item)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    for item in page.jsonld:
        visit(item)
    return found


def typed_jsonld_nodes(page: ParsedPage, expected_type: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            types = node.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if expected_type in types:
                found.append(node)
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    for item in page.jsonld:
        visit(item)
    return found


def extract_qualifying_total(page: ParsedPage) -> int | None:
    totals = {
        int(match.replace(",", ""))
        for text in page.visible_text
        for match in re.findall(r"\b([\d,]+)\s+qualifying vehicles?\b", text, re.I)
    }
    return next(iter(totals)) if len(totals) == 1 else None


def expected_inventory_count(page_url: str, total_count: int) -> int | None:
    query = parse_qs(urlsplit(page_url).query, keep_blank_values=True)
    if not query:
        page_number = 1
    elif set(query) == {"page"} and len(query["page"]) == 1 and query["page"][0].isdigit():
        page_number = int(query["page"][0])
        if page_number < 1:
            return None
    else:
        return None
    return max(0, min(PAGE_SIZE, total_count - (page_number - 1) * PAGE_SIZE))


def validate_rendered_inventory_count(
    page_url: str,
    page: ParsedPage,
    total_count: int | None,
    category: str,
) -> list[str]:
    if total_count is None:
        return [f"{category} {page_url}: rendered qualifying inventory total is missing"]
    expected = expected_inventory_count(page_url, total_count)
    if expected is None:
        return [f"{category} {page_url}: pagination URL is invalid for inventory count validation"]
    distinct_vins = set(canonical_vin_links(page, page_url))
    if len(distinct_vins) != expected:
        return [
            f"{category} {page_url}: rendered {len(distinct_vins)} distinct VINs; expected exactly {expected} "
            f"for qualifying total {total_count}"
        ]
    return []


def pagination_total_mismatch(page_one: ParsedPage, page_two: ParsedPage, category: str) -> str | None:
    first_total = extract_qualifying_total(page_one)
    second_total = extract_qualifying_total(page_two)
    if first_total is None or second_total is None or first_total != second_total:
        return f"{category} page-2 qualifying total {second_total} does not match page-1 total {first_total}"
    return None


def canonical_vin_links(page: ParsedPage, page_url: str) -> list[str]:
    result: list[str] = []
    for href, _ in page.links:
        absolute = urljoin(page_url, href)
        parts = urlsplit(absolute)
        segments = parts.path.strip("/").split("/")
        if (
            same_public_origin(absolute, page_url)
            and len(segments) == 2
            and segments[0] == "vehicle"
            and VIN_RE.fullmatch(segments[1])
            and parts.path == f"/vehicle/{segments[1]}"
            and not parts.query
            and not parts.fragment
        ):
            result.append(absolute)
    return result


def classify_path(path: str) -> str:
    if path in STATIC_PATHS:
        return "static"
    segments = [segment for segment in path.strip("/").split("/") if segment]
    if (
        len(segments) == 2
        and path == f"/vehicle/{segments[1]}"
        and segments[0] == "vehicle"
        and VIN_RE.fullmatch(segments[1])
    ):
        return "vehicle"
    if len(segments) == 3 and segments[0] == "cars":
        return "car-candidate"
    if len(segments) == 4 and segments[0] == "cars" and YEAR_RE.fullmatch(segments[3]):
        return "year"
    return "other"


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


class SmokeRunner:
    def __init__(
        self,
        base_url: str,
        *,
        opener: Any = None,
        max_requests: int = MAX_REQUESTS,
        max_runtime_seconds: int = MAX_RUNTIME_SECONDS,
    ) -> None:
        parts = urlsplit(base_url)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
            raise SmokeFailure("SEO_SMOKE_BASE_URL must be an absolute HTTPS origin without credentials")
        if parts.path not in ("", "/") or parts.query or parts.fragment:
            raise SmokeFailure("SEO_SMOKE_BASE_URL must not include a path, query, or fragment")
        self.base_url = f"https://{parts.netloc}"
        self.host = (parts.hostname or "").lower()
        self.origin = normalized_origin(self.base_url)
        self.max_requests = max_requests
        self.deadline = time.monotonic() + max_runtime_seconds
        self.request_count = 0
        self.check_count = 0
        self.failures: list[str] = []
        self.warnings: list[str] = []
        self.category_counts: dict[str, int] = {}
        self.selected_vin_urls: set[str] = set()
        self.vin_diagnostic_urls: set[str] = set()
        self.opener = opener or build_opener(NoRedirectHandler())

    def select_vin_urls(self, discovered_urls: list[str]) -> list[str]:
        """Select the fixed target plus at most four deterministic sitemap VINs."""
        candidate_set: set[str] = set()
        for url in discovered_urls:
            try:
                parts = urlsplit(url)
            except ValueError:
                continue
            if (
                parts.username
                or parts.password
                or parts.query
                or parts.fragment
                or classify_path(parts.path) != "vehicle"
                or not same_public_origin(url, self.base_url)
            ):
                continue
            candidate_set.add(canonical_url(url))
        candidates = sorted(candidate_set)
        target = f"{self.base_url}/vehicle/{TARGET_VIN}"
        selected = [target]
        selected.extend(url for url in candidates if url != target)
        selected = selected[:MAX_VIN_SAMPLES]
        self.selected_vin_urls = set(selected)
        self.vin_diagnostic_urls = {
            f"{self.base_url}/vehicle/1GYTEDKL5SU000000",
            f"{self.base_url}/vehicle/INVALIDVIN",
            f"{self.base_url}/vehicle/{TARGET_VIN.lower()}",
        }
        return selected

    def allowed_public_url(self, url: str, method: str = "GET") -> bool:
        try:
            parts = urlsplit(url)
            if (
                parts.scheme != "https"
                or parts.username
                or parts.password
                or parts.fragment
                or normalized_origin(url) != self.origin
            ):
                return False
        except ValueError:
            return False
        path = parts.path
        if path == "/api/healthz":
            return method == "GET" and not parts.query
        if path.startswith("/vehicle/"):
            exact = canonical_url(url)
            if method not in ("GET", "HEAD") or parts.query or parts.fragment:
                return False
            return exact in self.selected_vin_urls or (
                method == "GET" and exact in self.vin_diagnostic_urls
            )
        if method != "GET":
            return False
        if path in STATIC_PATHS or path in KNOWN_ALIASES or path in INVALID_YEAR_ROUTES:
            return True
        if path == "/sitemap.xml" or path == "/sitemap-static.xml":
            return True
        if re.fullmatch(r"/sitemap-vehicles/[1-9]\d*\.xml", path):
            return True
        kind = classify_path(path)
        return kind in ("car-candidate", "year")

    def get(self, url: str) -> tuple[int, str, dict[str, str], str]:
        return self._request(url, "GET")

    def head(self, url: str) -> tuple[int, str, dict[str, str], str]:
        return self._request(url, "HEAD")

    def _request(self, url: str, method: str) -> tuple[int, str, dict[str, str], str]:
        try:
            original_parts = urlsplit(url)
            if original_parts.username or original_parts.password or original_parts.fragment:
                raise SmokeFailure(f"refusing URL with credentials or fragment: {url}")
        except ValueError as exc:
            raise SmokeFailure(f"refusing malformed URL: {url}") from exc
        normalized = canonical_url(url)
        if not self.allowed_public_url(normalized, method):
            raise SmokeFailure(f"refusing non-allowlisted public SEO URL: {url}")
        if self.request_count >= self.max_requests:
            raise BudgetExceeded(f"request budget exceeded ({self.max_requests})")
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise BudgetExceeded(f"runtime budget exceeded ({MAX_RUNTIME_SECONDS}s)")
        self.request_count += 1
        request = Request(normalized, method=method, headers={"User-Agent": "AutoNegotiating-SEO-Smoke/1.0", "Accept": "text/html,application/xml"})
        started = time.monotonic()
        try:
            response = self.opener.open(request, timeout=min(REQUEST_TIMEOUT_SECONDS, remaining))
            code = response.status
            headers = {key.lower(): value for key, value in response.headers.items()}
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            response.close()
        except HTTPError as exc:
            code = exc.code
            headers = {key.lower(): value for key, value in exc.headers.items()}
            payload = exc.read(MAX_RESPONSE_BYTES + 1)
            exc.close()
        except (TimeoutError, URLError, OSError) as exc:
            raise SmokeFailure(f"GET {url} failed: {exc}") from exc
        if len(payload) > MAX_RESPONSE_BYTES:
            raise SmokeFailure(f"response exceeded {MAX_RESPONSE_BYTES} byte safety limit: {url}")
        elapsed = time.monotonic() - started
        return code, payload.decode("utf-8", errors="replace"), headers, f"{elapsed:.2f}s"

    def follow_public_redirect(self, url: str, status: int, headers: dict[str, str]) -> tuple[int, str, dict[str, str], str]:
        location = headers.get("location")
        if not location:
            raise SmokeFailure(f"redirect from {url} has no Location header")
        target = urljoin(url, location)
        if not self.allowed_public_url(target):
            raise SmokeFailure(f"refusing redirect to non-allowlisted URL: {target}")
        if normalized_origin(target) != self.origin:
            raise SmokeFailure(f"refusing cross-origin redirect from {url}")
        return self.get(target)

    def record_check(self, category: str) -> None:
        self.check_count += 1
        self.category_counts[category] = self.category_counts.get(category, 0) + 1


def validate_sitemap_locations(locations: list[str], base_url: str) -> tuple[list[str], list[str]]:
    expected_origin = normalized_origin(base_url)
    seen: set[str] = set()
    duplicates: list[str] = []
    invalid: list[str] = []
    for location in locations:
        try:
            original = urlsplit(location)
        except ValueError:
            invalid.append(f"malformed sitemap URL: {location}")
            continue
        canonical = canonical_url(location)
        parts = urlsplit(canonical)
        if (
            original.username
            or original.password
            or original.fragment
            or parts.scheme != "https"
            or parts.username
            or parts.password
            or normalized_origin(canonical) != expected_origin
        ):
            invalid.append(location)
        if parts.query or parts.fragment or (parts.path != "/" and parts.path.endswith("/")):
            invalid.append(f"non-canonical sitemap URL shape: {location}")
        if canonical in seen:
            duplicates.append(location)
        seen.add(canonical)
        if parts.path in KNOWN_ALIASES:
            invalid.append(f"legacy alias advertised: {location}")
        if classify_path(parts.path) == "other":
            invalid.append(f"unclassified sitemap URL: {location}")
    return duplicates, invalid


def sitemap_coverage_error(urls: list[str]) -> str | None:
    paths = {urlsplit(url).path for url in urls}
    kinds = {classify_path(path) for path in paths}
    if "/" not in paths or "/cars" not in paths:
        return "sitemap discovery did not include required static coverage (/, /cars)"
    if "car-candidate" not in kinds:
        return "sitemap discovery found no model-family/shopper-entity page URLs"
    return None


def page_content_check(url: str, body: str, expected_host: str, category: str) -> tuple[list[str], ParsedPage]:
    parser = ParsedPage()
    parser.feed(body)
    parser.close()
    errors: list[str] = []
    if len(parser.canonicals) != 1:
        errors.append(f"{category} {url}: expected exactly one canonical")
    else:
        canonical = urljoin(url, parser.canonicals[0])
        try:
            canonical_has_fragment = bool(urlsplit(canonical).fragment)
        except ValueError:
            canonical_has_fragment = True
        if (
            canonical_has_fragment
            or canonical_url(canonical) != canonical_url(url)
            or (urlsplit(canonical).hostname or "").lower() != expected_host
            or not same_public_origin(canonical, url)
        ):
            errors.append(f"{category} {url}: canonical is not self-referencing on the canonical host")
    if not parser.title.strip() or len(parser.title.strip()) < 12:
        errors.append(f"{category} {url}: missing/weak SSR title")
    if not parser.meta_description or len(parser.meta_description.strip()) < 30:
        errors.append(f"{category} {url}: missing/weak meta description")
    if not any(h1.strip() for h1 in parser.h1):
        errors.append(f"{category} {url}: missing SSR H1")
    if parser.jsonld_errors:
        errors.append(f"{category} {url}: malformed JSON-LD")
    return errors, parser


def validate_collection_jsonld(url: str, page: ParsedPage, category: str) -> list[str]:
    errors: list[str] = []
    canonical = canonical_url(url)
    collection_nodes = typed_jsonld_nodes(page, "CollectionPage")
    item_lists = typed_jsonld_nodes(page, "ItemList")
    breadcrumb_lists = typed_jsonld_nodes(page, "BreadcrumbList")
    if not collection_nodes:
        errors.append(f"{category} {url}: missing CollectionPage JSON-LD")
    if not item_lists:
        errors.append(f"{category} {url}: missing ItemList JSON-LD")
    if not breadcrumb_lists:
        errors.append(f"{category} {url}: missing BreadcrumbList JSON-LD")

    valid_collection = False
    for node in collection_nodes:
        name = node.get("name")
        description = node.get("description")
        identity = node.get("url")
        if (
            isinstance(name, str) and len(name.strip()) >= 8
            and isinstance(description, str) and len(description.strip()) >= 30
            and isinstance(identity, str) and canonical_url(urljoin(url, identity)) == canonical
            and same_public_origin(urljoin(url, identity), url)
        ):
            valid_collection = True
    if collection_nodes and not valid_collection:
        errors.append(f"{category} {url}: CollectionPage has no meaningful self identity/name/description")

    rendered_links = canonical_vin_links(page, url)
    rendered_set = set(rendered_links)
    if len(rendered_links) != len(rendered_set):
        errors.append(f"{category} {url}: duplicate rendered canonical VIN links")
    valid_item_list = False
    for node in item_lists:
        entries = node.get("itemListElement")
        if not isinstance(entries, list) or not entries:
            continue
        item_urls: list[str] = []
        positions: list[int] = []
        meaningful_entries = True
        for entry in entries:
            if not isinstance(entry, dict):
                meaningful_entries = False
                break
            item_url = entry.get("url")
            name = entry.get("name")
            position = entry.get("position")
            entry_type = entry.get("@type")
            if (
                entry_type != "ListItem"
                or not isinstance(position, int)
                or isinstance(position, bool)
                or position < 1
                or not isinstance(item_url, str)
                or not isinstance(name, str)
                or len(name.strip()) < 6
            ):
                meaningful_entries = False
                break
            absolute = urljoin(url, item_url)
            item_parts = urlsplit(absolute)
            item_segments = item_parts.path.strip("/").split("/")
            if (
                not same_public_origin(absolute, url)
                or len(item_segments) != 2
                or item_segments[0] != "vehicle"
                or not VIN_RE.fullmatch(item_segments[1])
                or item_parts.path != f"/vehicle/{item_segments[1]}"
                or item_parts.query
                or item_parts.fragment
            ):
                meaningful_entries = False
                break
            item_urls.append(canonical_url(absolute))
            positions.append(position)
        number = node.get("numberOfItems")
        count_matches = number is None or (
            isinstance(number, int) and not isinstance(number, bool) and number == len(entries)
        )
        if (
            meaningful_entries
            and len(positions) == len(set(positions))
            and positions == sorted(positions)
            and count_matches
            and len(item_urls) == len(set(item_urls))
            and set(item_urls) == rendered_set
        ):
            valid_item_list = True
    if item_lists and not valid_item_list:
        errors.append(f"{category} {url}: ItemList entries/count do not match distinct rendered VIN links")

    valid_breadcrumb = False
    for node in breadcrumb_lists:
        entries = node.get("itemListElement")
        if not isinstance(entries, list) or len(entries) < 2:
            continue
        crumb_urls: list[str] = []
        positions: list[int] = []
        valid_entries = True
        for entry in entries:
            if not isinstance(entry, dict):
                valid_entries = False
                break
            name = entry.get("name")
            item = entry.get("item")
            position = entry.get("position")
            if (
                entry.get("@type") != "ListItem"
                or not isinstance(position, int)
                or isinstance(position, bool)
                or position < 1
                or not isinstance(name, str)
                or len(name.strip()) < 2
                or not isinstance(item, str)
            ):
                valid_entries = False
                break
            absolute = urljoin(url, item)
            if not same_public_origin(absolute, url):
                valid_entries = False
                break
            crumb_urls.append(canonical_url(absolute))
            positions.append(position)
        if (
            valid_entries
            and positions == list(range(1, len(entries) + 1))
            and crumb_urls
            and crumb_urls[-1] == canonical
        ):
            valid_breadcrumb = True
    if breadcrumb_lists and not valid_breadcrumb:
        errors.append(f"{category} {url}: BreadcrumbList lacks meaningful same-origin identity ending at this page")
    return errors


def validate_year_page(
    url: str,
    body: str,
    expected_host: str,
    *,
    enforce_page_threshold: bool = True,
) -> tuple[list[str], ParsedPage]:
    errors, page = page_content_check(url, body, expected_host, "Phase 3B")
    path_parts = urlsplit(url).path.strip("/").split("/")
    year = path_parts[-1]
    subject = path_parts[-2]
    entity_words = subject.replace("-", " ").lower()
    context_fields = [("title", page.title), ("meta description", page.meta_description or "")]
    context_fields.extend(("H1", h1) for h1 in page.h1 if h1.strip())
    if not page.h1:
        context_fields.append(("H1", ""))
    for field_name, value in context_fields:
        lowered = value.lower()
        if year not in lowered or entity_words not in lowered:
            errors.append(f"Phase 3B {url}: year/entity context missing from {field_name}")
    vin_links = canonical_vin_links(page, url)
    if enforce_page_threshold and len(set(vin_links)) < YEAR_THRESHOLD:
        errors.append(f"Phase 3B {url}: rendered inventory links below the {YEAR_THRESHOLD}-vehicle threshold")
    total_count = extract_qualifying_total(page)
    if total_count is None or total_count < YEAR_THRESHOLD:
        errors.append(f"Phase 3B {url}: rendered qualifying inventory count is missing or inconsistent")
    errors.extend(validate_rendered_inventory_count(url, page, total_count, "Phase 3B"))
    parent_path = "/" + "/".join(path_parts[:-1])
    if parent_path not in same_origin_links(page, url):
        errors.append(f"Phase 3B {url}: missing exact national shopper entity link {parent_path}")
    family_path = PHASE3A_ENTITY_MODEL_FAMILIES.get(parent_path)
    if family_path is None or family_path not in same_origin_links(page, url):
        errors.append(f"Phase 3B {url}: missing exact model-family hierarchy link")
    errors.extend(validate_collection_jsonld(url, page, "Phase 3B"))
    return errors, page


def contains_obsolete_search_url(document: str) -> bool:
    return OBSOLETE_SEARCH_URL in html.unescape(document)


def same_origin_links(page: ParsedPage, page_url: str) -> set[str]:
    return {
        urlsplit(absolute).path
        for href, _ in page.links
        if same_public_origin(absolute := urljoin(page_url, href), page_url)
    }


def year_links(page: ParsedPage, page_url: str) -> set[str]:
    return {
        canonical_url(absolute)
        for href, _ in page.links
        if classify_path(urlsplit(absolute := urljoin(page_url, href)).path) == "year"
        and same_public_origin(absolute, page_url)
    }


def validate_entity_page(url: str, body: str, expected_host: str) -> tuple[list[str], ParsedPage]:
    errors, page = page_content_check(url, body, expected_host, "Phase 3A")
    path = urlsplit(url).path
    errors.extend(validate_collection_jsonld(url, page, "Phase 3A"))
    total_count = extract_qualifying_total(page)
    vin_links = canonical_vin_links(page, url)
    if total_count is None or total_count < ENTITY_THRESHOLD:
        errors.append(f"Phase 3A {url}: rendered qualifying inventory count is missing or inconsistent")
    errors.extend(validate_rendered_inventory_count(url, page, total_count, "Phase 3A"))
    expected_family = PHASE3A_ENTITY_MODEL_FAMILIES.get(path)
    if expected_family is None:
        errors.append(f"Phase 3A {url}: no audited entity-to-model-family relationship")
    elif expected_family not in same_origin_links(page, url):
        errors.append(f"Phase 3A {url}: missing exact model-family link {expected_family}")
    return errors, page


def validate_seo_page(
    url: str,
    body: str,
    page_kind: str,
    expected_host: str,
    *,
    page_two: bool = False,
) -> tuple[list[str], ParsedPage]:
    if page_kind == "year":
        return validate_year_page(url, body, expected_host, enforce_page_threshold=not page_two)
    if page_kind == "entity":
        return validate_entity_page(url, body, expected_host)
    errors, page = page_content_check(url, body, expected_host, "Phase 2")
    links = canonical_vin_links(page, url)
    if not links:
        errors.append(f"Phase 2 {url}: no canonical SSR VIN inventory links")
    if len(links) != len(set(links)):
        errors.append(f"Phase 2 {url}: duplicate canonical SSR VIN inventory links")
    return errors, page


def validate_vehicle_page(url: str, body: str, expected_host: str, vin: str) -> list[str]:
    errors, page = page_content_check(url, body, expected_host, "VIN")
    expected_url = canonical_url(url)
    title = page.title.strip()
    headings = [heading.strip() for heading in page.h1 if heading.strip()]
    vehicle_nodes = typed_jsonld_nodes(page, "Vehicle")
    product_nodes = typed_jsonld_nodes(page, "Product")
    if len(vehicle_nodes) != 1:
        errors.append(f"VIN {url}: expected exactly one Vehicle JSON-LD node")
    if len(product_nodes) != 1:
        errors.append(f"VIN {url}: expected exactly one Product JSON-LD node")
    if not title or not headings:
        errors.append(f"VIN {url}: title/H1 vehicle identity is missing")
    if vin not in " ".join(page.visible_text):
        errors.append(f"VIN {url}: VIN is missing from rendered page text")
    if not vehicle_nodes:
        errors.append(f"VIN {url}: missing Vehicle JSON-LD")
    if not product_nodes:
        errors.append(f"VIN {url}: missing Product JSON-LD")

    persisted_fields = 0
    rendered_text_key = re.sub(r"[^a-z0-9]", "", " ".join(page.visible_text).casefold())

    def field_is_rendered(value: Any) -> bool:
        expected = re.sub(r"[^a-z0-9]", "", str(value).casefold())
        return bool(expected) and expected in rendered_text_key

    for node in vehicle_nodes:
        node_url = node.get("url")
        name = node.get("name")
        identity = node.get("vehicleIdentificationNumber")
        if identity != vin:
            errors.append(f"VIN {url}: Vehicle JSON-LD VIN does not match the requested VIN")
        if not isinstance(node_url, str) or canonical_url(urljoin(url, node_url)) != expected_url:
            errors.append(f"VIN {url}: Vehicle JSON-LD URL is not the canonical vehicle URL")
        if (
            not isinstance(name, str)
            or len(name.strip()) < 8
            or not any(name.strip().casefold() in heading.casefold() for heading in headings)
            or name.strip().casefold() not in title.casefold()
        ):
            errors.append(f"VIN {url}: Vehicle JSON-LD name does not match the rendered vehicle identity")
        for property_name in ("brand", "model", "vehicleModelDate", "mileageFromOdometer"):
            value = node.get(property_name)
            if isinstance(value, dict):
                value = value.get("name") if property_name == "brand" else value.get("value")
            if isinstance(value, (str, int, float)) and str(value).strip():
                persisted_fields += 1
                if not field_is_rendered(value):
                    errors.append(f"VIN {url}: persisted {property_name} field is absent from rendered content")

    for node in product_nodes:
        name = node.get("name")
        node_url = node.get("url")
        if node.get("sku") != vin and node.get("mpn") != vin:
            errors.append(f"VIN {url}: Product JSON-LD has no matching VIN sku/mpn")
        if not isinstance(node_url, str) or canonical_url(urljoin(url, node_url)) != expected_url:
            errors.append(f"VIN {url}: Product JSON-LD URL is not the canonical vehicle URL")
        if not isinstance(name, str) or not any(name.strip().casefold() == item.get("name", "").strip().casefold()
                                                for item in vehicle_nodes if isinstance(item.get("name"), str)):
            errors.append(f"VIN {url}: Product JSON-LD name does not match Vehicle identity")
        for property_value in node.get("additionalProperty", []) if isinstance(node.get("additionalProperty"), list) else []:
            if isinstance(property_value, dict) and str(property_value.get("name", "")).casefold() in {
                "year", "make", "model", "mileage", "trim", "condition"
            }:
                value = property_value.get("value")
                if value is not None and str(value).strip():
                    persisted_fields += 1
                    if not field_is_rendered(value):
                        errors.append(f"VIN {url}: persisted Product field is absent from rendered content")
    if persisted_fields < 2:
        errors.append(f"VIN {url}: JSON-LD lacks at least two useful persisted vehicle fields")

    rendered_images: set[str] = set()
    for image in page.images:
        absolute_image = urljoin(url, image)
        image_parts = urlsplit(absolute_image)
        if image_parts.scheme in ("http", "https") and not image_parts.username and not image_parts.password:
            rendered_images.add(canonical_url(absolute_image))
    schema_images: set[str] = set()
    for node in [*vehicle_nodes, *product_nodes]:
        image_value = node.get("image")
        if isinstance(image_value, str):
            schema_images.add(canonical_url(urljoin(url, image_value)))
        elif isinstance(image_value, list):
            schema_images.update(
                canonical_url(urljoin(url, image))
                for image in image_value
                if isinstance(image, str)
            )
    if not schema_images.issubset(rendered_images):
        errors.append(f"VIN {url}: JSON-LD advertises an image not rendered on the vehicle page")
    return errors


def validate_hierarchy_relationships(
    national_page_path: str,
    national_links: set[str],
    sitemap_years_by_entity: dict[str, set[str]],
) -> list[str]:
    errors: list[str] = []
    expected_years = sitemap_years_by_entity.get(national_page_path, set())
    linked_years = {
        link for link in national_links
        if classify_path(urlsplit(link).path) == "year"
    }
    if linked_years != expected_years:
        errors.append(
            f"Phase 3A {national_page_path}: year links disagree with its own sitemap year URLs "
            f"(missing={len(expected_years - linked_years)}, extra={len(linked_years - expected_years)})"
        )
    return errors


def is_phase3a_entity(path: str, page: ParsedPage) -> bool:
    return path in PHASE3A_ENTITY_PATHS or "CollectionPage" in structured_types(page)


def pagination_page_two(page: ParsedPage, page_url: str) -> str | None:
    for href, _ in page.links:
        target = urljoin(page_url, href)
        parts = urlsplit(target)
        if (
            same_public_origin(target, page_url)
            and parts.path == urlsplit(page_url).path
            and parts.query == "page=2"
            and not parts.fragment
        ):
            return target
    return None


def validate_pagination_behavior(
    runner: SmokeRunner,
    page_url: str,
    page: ParsedPage,
    page_kind: str,
) -> list[str]:
    errors: list[str] = []
    link = pagination_page_two(page, page_url)
    visible_vin_count = len(set(canonical_vin_links(page, page_url)))
    total_count = extract_qualifying_total(page)
    if page_kind == "family":
        expected_page_two = visible_vin_count >= PAGE_SIZE
    else:
        expected_page_two = total_count is not None and total_count > PAGE_SIZE
    if page_kind != "family" and total_count is None:
        errors.append(f"{page_kind} {page_url}: qualifying total missing; pagination cannot be validated")
    if expected_page_two and not link:
        errors.append(f"{page_kind} {page_url}: page 2 link missing despite paginatable inventory")
    if link and not expected_page_two:
        errors.append(f"{page_kind} {page_url}: page 2 link advertised without enough inventory")
    if not expected_page_two:
        return errors
    page_two_url = urlunsplit((*urlsplit(page_url)[:3], "page=2", ""))
    status, body, _, _ = runner.get(page_two_url)
    runner.record_check(f"{page_kind}-page-2")
    if status != 200:
        errors.append(f"{page_kind} {page_two_url}: expected HTTP 200 for page 2, got {status}")
    else:
        page_errors, _page_two = validate_seo_page(page_two_url, body, page_kind, runner.host, page_two=True)
        errors.extend(page_errors)
        if page_kind in ("entity", "year"):
            mismatch = pagination_total_mismatch(page, _page_two, page_kind)
            if mismatch:
                errors.append(f"{page_kind} {page_url}: {mismatch}")
    out_of_range = urlunsplit((*urlsplit(page_url)[:3], "page=10000", ""))
    status, _, _, _ = runner.get(out_of_range)
    runner.record_check(f"{page_kind}-out-of-range")
    if status != 404:
        errors.append(f"{page_kind} {out_of_range}: expected HTTP 404 out of range, got {status}")
    return errors


def run_smoke(base_url: str, repo_root: Path) -> int:
    started = time.monotonic()
    runner = SmokeRunner(base_url)
    safe, reason = source_safety_guard(repo_root)
    if not safe:
        print("OVERALL: BLOCKED (local SEO read safety unverified)")
        print(f"Reason: {reason}")
        print(f"Requests: 0 | Checks: 0 | Runtime: {time.monotonic() - started:.2f}s")
        print("Sitemap/page category counts: UNKNOWN (blocked before sitemap discovery).")
        print("Categories tested: none | Warnings: 0 | Failures: 0 | Safety blockers: 1")
        print("No production HTTP request was made.")
        return 2

    # Local source review does not prove the live deployment runs that source.
    # Only this already read-only health endpoint may be contacted until it
    # attests to the same explicitly audited build.
    try:
        status, _, headers, _ = runner.get(f"{runner.base_url}/api/healthz")
        if status != 200 or headers.get("x-seo-read-safety") != reason.rsplit(" ", 1)[-1]:
            raise SmokeFailure("live build does not attest to the locally audited SEO source; publish the reviewed build")
    except SmokeFailure as exc:
        print("OVERALL: BLOCKED (live build safety unverified)")
        print(f"Reason: {exc}")
        print(f"Requests: {runner.request_count} | Checks: 0 | Runtime: {time.monotonic() - started:.2f}s")
        print("Sitemap/page category counts: UNKNOWN (no SEO/VIN requests made).")
        print("Categories tested: none | Warnings: 0 | Failures: 0 | Safety blockers: 1")
        return 2

    # Safety gate is intentionally evaluated before any call to runner.get().
    # Production may only be contacted below after an auditable source check.
    failures: list[str] = []
    warnings: list[str] = []
    counts: dict[str, int] | None = None
    vin_page_checks = 0
    try:
        status, xml, _, _ = runner.get(f"{runner.base_url}/sitemap.xml")
        runner.record_check("sitemap-index")
        if status != 200:
            raise SmokeFailure(f"/sitemap.xml returned HTTP {status}")
        kind, sitemap_urls = parse_sitemap(xml)
        if kind != "sitemapindex":
            raise SmokeFailure("/sitemap.xml did not contain a sitemap index")
        if len(sitemap_urls) > MAX_SITEMAPS:
            raise BudgetExceeded(f"sitemap index lists {len(sitemap_urls)} sitemaps; cap is {MAX_SITEMAPS}")
        if len({canonical_url(url) for url in sitemap_urls}) != len(sitemap_urls):
            raise SmokeFailure("sitemap index contains duplicate sitemap URLs")
        sitemap_urls = sorted(sitemap_urls)
        all_urls: list[str] = []
        for sitemap_url in sitemap_urls:
            if urlsplit(sitemap_url).hostname != runner.host or not runner.allowed_public_url(sitemap_url):
                raise SmokeFailure(f"refusing non-public sitemap URL: {sitemap_url}")
            sm_status, sm_xml, _, _ = runner.get(sitemap_url)
            runner.record_check("sitemap")
            if sm_status != 200:
                raise SmokeFailure(f"sitemap {sitemap_url} returned HTTP {sm_status}")
            sm_kind, locations = parse_sitemap(sm_xml)
            if sm_kind != "urlset":
                raise SmokeFailure(f"sitemap {sitemap_url} is not a URL set")
            all_urls.extend(locations)
        duplicates, sitemap_errors = validate_sitemap_locations(all_urls, runner.base_url)
        if duplicates:
            failures.append(f"sitemap contains {len(duplicates)} duplicate canonical URL(s)")
        failures.extend(sitemap_errors)
        categorized: dict[str, list[str]] = {"static": [], "car-candidate": [], "year": [], "vehicle": []}
        for location in all_urls:
            kind = classify_path(urlsplit(location).path)
            if kind in categorized:
                categorized[kind].append(location)
        coverage_error = sitemap_coverage_error(all_urls)
        if coverage_error:
            raise SmokeFailure(coverage_error)
        counts = {name: len(urls) for name, urls in categorized.items()}
        counts["model-family"] = 0
        counts["shopper-entity"] = 0
        vehicle_urls = sorted(categorized["vehicle"])
        selected_vin_urls = runner.select_vin_urls(vehicle_urls)
        if len(categorized["static"]) + len(categorized["car-candidate"]) + len(categorized["year"]) > MAX_SEO_PAGES:
            raise BudgetExceeded(
                f"{len(categorized['static']) + len(categorized['car-candidate']) + len(categorized['year'])} SEO pages exceed deterministic cap {MAX_SEO_PAGES}"
            )
        base_pages = sorted(categorized["car-candidate"])
        year_pages = sorted(categorized["year"])
        sitemap_years_by_entity: dict[str, set[str]] = {}
        for year_url in year_pages:
            parent = urlsplit(year_url).path.rsplit("/", 1)[0]
            sitemap_years_by_entity.setdefault(parent, set()).add(canonical_url(year_url))
        national_year_links: dict[str, set[str]] = {}
        national_paths_checked: set[str] = set()
        for static_url in sorted(categorized["static"]):
            status, body, _, _ = runner.get(static_url)
            runner.record_check("static")
            if status != 200:
                failures.append(f"static {urlsplit(static_url).path or '/'}: expected HTTP 200, got {status}")
            if contains_obsolete_search_url(body):
                failures.append(f"obsolete literal search URL found in static HTML at {static_url}")
        for page_url in [*base_pages, *year_pages]:
            path = urlsplit(page_url).path
            is_year = classify_path(path) == "year"
            category = "Phase 3B" if is_year else "car"
            page_status, body, headers, _ = runner.get(page_url)
            runner.record_check(category)
            if page_status in (301, 302, 307, 308):
                page_status, body, headers, _ = runner.follow_public_redirect(page_url, page_status, headers)
            if page_status != 200:
                failures.append(f"{category} {urlsplit(page_url).path}: expected HTTP 200, got {page_status}")
                continue
            if is_year:
                page_errors, parsed = validate_year_page(page_url, body, runner.host)
                failures.extend(page_errors)
            else:
                _, entity_probe = page_content_check(page_url, body, runner.host, "car page")
                is_entity = is_phase3a_entity(path, entity_probe)
                if is_entity:
                    counts["shopper-entity"] += 1
                    page_errors, parsed = validate_entity_page(page_url, body, runner.host)
                    failures.extend(page_errors)
                    national_paths_checked.add(path)
                    national_year_links[path] = year_links(parsed, page_url)
                    failures.extend(validate_hierarchy_relationships(path, national_year_links[path], sitemap_years_by_entity))
                else:
                    counts["model-family"] += 1
                    page_errors, parsed = validate_seo_page(page_url, body, "family", runner.host)
                    failures.extend(page_errors)
            if contains_obsolete_search_url(body):
                failures.append(f"obsolete literal search URL found in SEO HTML at {page_url}")
            page_kind = "year" if is_year else "entity" if is_entity else "family"
            failures.extend(validate_pagination_behavior(runner, page_url, parsed, page_kind))

        for entity_path in sitemap_years_by_entity:
            if entity_path not in national_paths_checked:
                failures.append(f"Phase 3B {entity_path}: no advertised national shopper page was checked")

        for alias in KNOWN_ALIASES:
            status, _, headers, _ = runner.get(f"{runner.base_url}{alias}")
            runner.record_check("legacy-alias")
            if status == 404:
                warnings.append(f"Historical collision alias {alias} is no longer present (404; accepted).")
            elif status in (301, 308):
                target = urljoin(f"{runner.base_url}{alias}", headers.get("location", ""))
                if not runner.allowed_public_url(target) or target == f"{runner.base_url}{alias}":
                    failures.append(f"Historical alias {alias} has unsafe/invalid redirect target")
                else:
                    target_status, _, _, _ = runner.follow_public_redirect(f"{runner.base_url}{alias}", status, headers)
                    if target_status != 200:
                        failures.append(f"Historical alias {alias} destination returned HTTP {target_status}")
                    if urlsplit(target).path not in {urlsplit(url).path for url in base_pages}:
                        failures.append(f"Historical alias {alias} does not redirect to an advertised canonical family")
            else:
                failures.append(f"Historical alias {alias}: expected permanent redirect or 404, got HTTP {status}")
        for invalid in INVALID_YEAR_ROUTES:
            status, _, _, _ = runner.get(f"{runner.base_url}{invalid}")
            runner.record_check("invalid-year-route")
            if status != 404:
                failures.append(f"invalid third-segment route {invalid}: expected HTTP 404, got {status}")

        for vehicle_url in selected_vin_urls:
            vin = urlsplit(vehicle_url).path.rsplit("/", 1)[-1]
            status, body, _, _ = runner.get(vehicle_url)
            runner.record_check("vin-page")
            vin_page_checks += 1
            if status != 200:
                failures.append(f"VIN {vehicle_url}: expected HTTP 200, got {status}")
                continue
            failures.extend(validate_vehicle_page(vehicle_url, body, runner.host, vin))

        target_url = f"{runner.base_url}/vehicle/{TARGET_VIN}"
        head_status, _, _, _ = runner.head(target_url)
        runner.record_check("vin-head")
        if head_status != 200:
            failures.append(f"VIN HEAD {target_url}: expected HTTP 200, got {head_status}")

        unknown_url = f"{runner.base_url}/vehicle/1GYTEDKL5SU000000"
        unknown_status, _, _, _ = runner.get(unknown_url)
        runner.record_check("vin-unknown")
        if unknown_status != 404:
            failures.append(f"unknown VIN {unknown_url}: expected HTTP 404, got {unknown_status}")

        invalid_url = f"{runner.base_url}/vehicle/INVALIDVIN"
        invalid_status, _, _, _ = runner.get(invalid_url)
        runner.record_check("vin-invalid")
        if invalid_status != 404:
            failures.append(f"invalid VIN {invalid_url}: expected HTTP 404, got {invalid_status}")

        lowercase_url = f"{runner.base_url}/vehicle/{TARGET_VIN.lower()}"
        lowercase_status, _, lowercase_headers, _ = runner.get(lowercase_url)
        runner.record_check("vin-casing")
        target_location = urljoin(lowercase_url, lowercase_headers.get("location", ""))
        if lowercase_status not in (301, 308) or canonical_url(target_location) != canonical_url(target_url):
            failures.append(f"lowercase VIN {lowercase_url}: expected permanent redirect to uppercase canonical VIN")
    except (SmokeFailure, BudgetExceeded) as exc:
        failures.append(str(exc))
    elapsed = time.monotonic() - started
    if counts is None:
        print("Counts: UNKNOWN (sitemap discovery was not completed)")
    else:
        print(
            f"Counts: static={counts.get('static', 0)}, model-family={counts.get('model-family', 0)}, "
            f"shopper-entity={counts.get('shopper-entity', 0)}, year={counts.get('year', 0)}, "
            f"vehicle={counts.get('vehicle', 0)} (sampled {vin_page_checks}/{MAX_VIN_SAMPLES})"
        )
    print(f"Requests: {runner.request_count} | Checks: {runner.check_count} | Runtime: {elapsed:.2f}s")
    print(f"Categories: {', '.join(f'{key}={value}' for key, value in sorted(runner.category_counts.items())) or 'none'}")
    print(f"Warnings: {len(warnings)} | Failures: {len(failures)}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    for failure in failures:
        print(f"FAIL: {failure}")
    print("OVERALL: " + ("FAIL" if failures else "PASS"))
    return 1 if failures else 0


def main() -> int:
    base_url = os.environ.get("SEO_SMOKE_BASE_URL", DEFAULT_BASE_URL)
    return run_smoke(base_url, Path(__file__).resolve().parent.parent)


if __name__ == "__main__":
    sys.exit(main())