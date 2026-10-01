from __future__ import annotations

from contextlib import redirect_stdout
from io import StringIO
import json
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import production_seo_smoke as smoke


ROOT = Path(__file__).resolve().parent.parent
GOOD_URL = "https://www.autonegotiating.com/cars/bmw/m550i/2024"
VIN_LINKS = "".join(
    f'<a href="/vehicle/{vin}">Car</a>'
    for vin in ("1GYTEDKL5SU107838", "1GYTEDKL5SU107839", "1GYTEDKL5SU107840")
)
YEAR_JSONLD = {
    "@graph": [
        {
            "@type": "CollectionPage",
            "name": "2024 BMW M550i for Sale",
            "description": "Browse current 2024 BMW M550i listings with useful inventory information.",
            "url": GOOD_URL,
        },
        {
            "@type": "ItemList",
            "numberOfItems": 3,
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": index,
                    "url": f"https://www.autonegotiating.com/vehicle/{vin}",
                    "name": "2024 BMW M550i",
                }
                for index, vin in enumerate(
                    ("1GYTEDKL5SU107838", "1GYTEDKL5SU107839", "1GYTEDKL5SU107840"),
                    start=1,
                )
            ],
        },
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Cars", "item": "https://www.autonegotiating.com/cars"},
                {"@type": "ListItem", "position": 2, "name": "BMW 5 Series", "item": "https://www.autonegotiating.com/cars/bmw/5-series"},
                {"@type": "ListItem", "position": 3, "name": "BMW M550i", "item": "https://www.autonegotiating.com/cars/bmw/m550i"},
                {"@type": "ListItem", "position": 4, "name": "2024 BMW M550i", "item": GOOD_URL},
            ],
        },
    ]
}
GOOD_YEAR_HTML = f"""<!doctype html><html><head><title>2024 BMW M550i for Sale</title>
<meta name="description" content="Find current 2024 BMW M550i inventory listings and details.">
<link rel="canonical" href="{GOOD_URL}"></head><body><h1>2024 BMW M550i</h1>
<p>3 qualifying vehicles</p><a href="/cars/bmw/m550i">BMW M550i</a>
<a href="/cars/bmw/5-series">BMW 5 Series</a>{VIN_LINKS}
<script type="application/ld+json">{json.dumps(YEAR_JSONLD)}</script></body></html>"""
ENTITY_URL = "https://www.autonegotiating.com/cars/bmw/m550i"
ENTITY_JSONLD = {
    "@graph": [
        {
            "@type": "CollectionPage",
            "name": "BMW M550i for Sale",
            "description": "Browse current BMW M550i inventory listings with useful details.",
            "url": ENTITY_URL,
        },
        {
            "@type": "ItemList",
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": index,
                    "url": f"https://www.autonegotiating.com/vehicle/{vin}",
                    "name": "2024 BMW M550i",
                }
                for index, vin in enumerate(
                    ("1GYTEDKL5SU107838", "1GYTEDKL5SU107839", "1GYTEDKL5SU107840"),
                    start=1,
                )
            ],
        },
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Cars", "item": "https://www.autonegotiating.com/cars"},
                {"@type": "ListItem", "position": 2, "name": "BMW 5 Series", "item": "https://www.autonegotiating.com/cars/bmw/5-series"},
                {"@type": "ListItem", "position": 3, "name": "BMW M550i", "item": ENTITY_URL},
            ],
        },
    ]
}
ENTITY_HTML = f"""<html><head><title>BMW M550i for Sale | AutoNegotiating</title>
<meta name="description" content="Browse current BMW M550i inventory listings with useful details and pricing.">
<link rel="canonical" href="{ENTITY_URL}"><script type="application/ld+json">{json.dumps(ENTITY_JSONLD)}</script>
</head><body><h1>BMW M550i for Sale</h1><p>3 qualifying vehicles</p>
<a href="/cars/bmw/5-series">BMW 5 Series</a><a href="/cars/bmw/m550i/2024">2024 BMW M550i</a>
{VIN_LINKS}</body></html>"""
PAGE2_URL = "https://www.autonegotiating.com/cars/bmw/5-series?page=2"
PAGE2_HTML = f"""<html><head><title>BMW 5 Series listings, page two</title>
<meta name="description" content="Browse current BMW 5 Series inventory listings, second page.">
<link rel="canonical" href="{PAGE2_URL}"></head><body><h1>BMW 5 Series listings</h1>
<a href="/vehicle/1GYTEDKL5SU107838">BMW 5 Series listing</a></body></html>"""


class FakeRunner(smoke.SmokeRunner):
    def __init__(self, replies: list[tuple[int, str]]) -> None:
        super().__init__("https://www.autonegotiating.com")
        self.replies = replies
        self.requested: list[str] = []

    def get(self, url: str) -> tuple[int, str, dict[str, str], str]:
        if self.request_count >= self.max_requests:
            raise smoke.BudgetExceeded("request cap")
        self.request_count += 1
        self.requested.append(url)
        status, body = self.replies.pop(0)
        return status, body, {}, "0s"


class FakeResponse:
    def __init__(self, status: int, body: str, headers: dict[str, str] | None = None) -> None:
        self.status = status
        self.headers = headers or {}
        self._body = body.encode()

    def read(self, limit: int) -> bytes:
        return self._body[:limit]

    def close(self) -> None:
        pass


class FakeOpener:
    def __init__(self, responses: dict[str, tuple[int, str] | tuple[int, str, dict[str, str]]]) -> None:
        self.responses = responses
        self.requested: list[str] = []
        self.requested_methods: list[str] = []

    def open(self, request: object, timeout: float) -> FakeResponse:
        url = request.full_url
        self.requested.append(url)
        self.requested_methods.append(request.get_method())
        if not url.startswith("https://seo-fixture.invalid/"):
            raise AssertionError(f"fixture attempted non-fixture network access: {url}")
        if url not in self.responses:
            raise AssertionError(f"unexpected fixture request: {url}")
        reply = self.responses[url]
        status, body = reply[:2]
        headers = reply[2] if len(reply) == 3 else {}
        return FakeResponse(status, body, headers)


def xml_urlset(urls: list[str]) -> str:
    entries = "".join(f"<url><loc>{url}</loc></url>" for url in urls)
    return f'<urlset xmlns="{smoke.SITEMAP_NS}">{entries}</urlset>'


def integrated_responses() -> dict[str, tuple[int, str] | tuple[int, str, dict[str, str]]]:
    origin = "https://seo-fixture.invalid"
    vins = [
        "1GYTEDKL5SU107838",
        "1GYTEDKL5SU107839",
        "1GYTEDKL5SU107840",
        "1GYTEDKL5SU107841",
        "1GYTEDKL5SU107842",
        "1GYTEDKL5SU107843",
    ]
    sitemap_urls = [
        f"{origin}/sitemap-static.xml",
        f"{origin}/sitemap-vehicles/1.xml",
    ]
    index_entries = "".join(f"<sitemap><loc>{url}</loc></sitemap>" for url in sitemap_urls)
    index = f'<sitemapindex xmlns="{smoke.SITEMAP_NS}">{index_entries}</sitemapindex>'
    static_urls = [
        f"{origin}/",
        f"{origin}/cars",
        f"{origin}/deal-intelligence.html",
        f"{origin}/trade-intelligence.html",
        f"{origin}/cars/bmw/5-series",
        f"{origin}/cars/bmw/m550i",
        f"{origin}/cars/bmw/m550i/2024",
    ]
    family_html = """<html><head><title>BMW 5 Series for Sale | AutoNegotiating</title>
    <meta name="description" content="Browse currently available BMW 5 Series listings for sale.">
    <link rel="canonical" href="https://seo-fixture.invalid/cars/bmw/5-series"></head>
    <body><h1>BMW 5 Series</h1><a href="/vehicle/1GYTEDKL5SU107838">BMW 5 Series listing</a></body></html>"""
    entity_html = ENTITY_HTML.replace("https://www.autonegotiating.com", origin)
    year_html = GOOD_YEAR_HTML.replace("https://www.autonegotiating.com", origin)
    vehicle_map = xml_urlset([f"{origin}/vehicle/{vin}" for vin in vins])
    responses: dict[str, tuple[int, str]] = {
        f"{origin}/api/healthz": (200, "", {"x-seo-read-safety": "a" * 64}),
        f"{origin}/sitemap.xml": (200, index),
        f"{origin}/sitemap-static.xml": (200, xml_urlset(static_urls)),
        f"{origin}/sitemap-vehicles/1.xml": (200, vehicle_map),
        f"{origin}/cars/bmw/5-series": (200, family_html),
        f"{origin}/cars/bmw/m550i": (200, entity_html),
        f"{origin}/cars/bmw/m550i/2024": (200, year_html),
        f"{origin}/": (200, "<html></html>"),
        f"{origin}/cars": (200, "<html></html>"),
        f"{origin}/deal-intelligence.html": (200, "<html></html>"),
        f"{origin}/trade-intelligence.html": (200, "<html></html>"),
    }
    for alias in smoke.KNOWN_ALIASES:
        responses[f"{origin}{alias}"] = (404, "")
    for invalid in smoke.INVALID_YEAR_ROUTES:
        responses[f"{origin}{invalid}"] = (404, "")
    for vin in vins[:5]:
        responses[f"{origin}/vehicle/{vin}"] = (200, vehicle_page_html(vin))
    responses[f"{origin}/vehicle/1GYTEDKL5SU000000"] = (404, "")
    responses[f"{origin}/vehicle/INVALIDVIN"] = (404, "")
    responses[f"{origin}/vehicle/{smoke.TARGET_VIN.lower()}"] = (
        301,
        "",
        {"location": f"/vehicle/{smoke.TARGET_VIN}"},
    )
    return responses


def vehicle_page_html(vin: str) -> str:
    url = f"https://seo-fixture.invalid/vehicle/{vin}"
    name = "2025 Cadillac Escalade IQ Premium Luxury"
    schema = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Vehicle",
                "url": url,
                "name": name,
                "vehicleIdentificationNumber": vin,
                "brand": {"@type": "Brand", "name": "Cadillac"},
                "model": "Escalade IQ",
                "vehicleModelDate": "2025",
            },
            {
                "@type": "Product",
                "url": url,
                "name": name,
                "sku": vin,
                "mpn": vin,
            },
        ],
    }
    return f"""<html><head><title>{name} for Sale | AutoNegotiating.com</title>
    <meta name="description" content="Browse verified persisted listing details for this Cadillac Escalade IQ vehicle.">
    <link rel="canonical" href="{url}"></head><body><h1>{name}</h1>
    <p>VIN: {vin}</p><dl><dt>Year</dt><dd>2025</dd><dt>Make</dt><dd>Cadillac</dd>
    <dt>Model</dt><dd>Escalade IQ</dd></dl>
    <script type="application/ld+json">{json.dumps(schema)}</script></body></html>"""


def run_fixture_smoke(
    responses: dict[str, tuple[int, str] | tuple[int, str, dict[str, str]]],
) -> tuple[int, str, FakeOpener]:
    opener = FakeOpener(responses)
    output = StringIO()
    with (
        patch.object(smoke, "source_safety_guard", return_value=(True, f"explicitly audited fixture source {'a' * 64}")),
        patch.object(smoke, "build_opener", return_value=opener),
        redirect_stdout(output),
    ):
        result = smoke.run_smoke("https://seo-fixture.invalid", ROOT)
    return result, output.getvalue(), opener


class ProductionSeoSmokeFixtures(unittest.TestCase):
    def test_integrated_fixture_smoke_uses_only_fake_fixture_transport(self) -> None:
        result, output, opener = run_fixture_smoke(integrated_responses())
        self.assertEqual(result, 0, output)
        self.assertIn("OVERALL: PASS", output)
        self.assertTrue(opener.requested)
        self.assertTrue(all(url.startswith("https://seo-fixture.invalid/") for url in opener.requested))
        self.assertFalse(any("autonegotiating.com" in url for url in opener.requested))
        sampled_urls = {url for url in opener.requested if url.endswith(tuple(
            vin for vin in (
                "1GYTEDKL5SU107838", "1GYTEDKL5SU107839", "1GYTEDKL5SU107840",
                "1GYTEDKL5SU107841", "1GYTEDKL5SU107842", "1GYTEDKL5SU107843",
            )
        ))}
        self.assertEqual(len(sampled_urls), smoke.MAX_VIN_SAMPLES)
        self.assertNotIn("https://seo-fixture.invalid/vehicle/1GYTEDKL5SU107843", sampled_urls)
        self.assertIn("Categories: ", output)
        self.assertIn("vin-page=5", output)
        self.assertIn("vin-head=1", output)
        self.assertIn("sampled 5/5", output)
        self.assertEqual(opener.requested_methods.count("HEAD"), 1)

    def test_old_deployment_marker_stops_after_health_before_seo_requests(self) -> None:
        responses = integrated_responses()
        responses["https://seo-fixture.invalid/api/healthz"] = (
            200,
            "",
            {"x-seo-read-safety": "b" * 64},
        )
        result, output, opener = run_fixture_smoke(responses)
        self.assertEqual(result, 2)
        self.assertEqual(opener.requested, ["https://seo-fixture.invalid/api/healthz"])
        self.assertIn("live build safety unverified", output)

    def test_integrated_empty_sitemap_cannot_pass_as_zero_discovered_routes(self) -> None:
        responses = integrated_responses()
        responses["https://seo-fixture.invalid/sitemap-static.xml"] = (
            200,
            f'<urlset xmlns="{smoke.SITEMAP_NS}"></urlset>',
        )
        result, output, _ = run_fixture_smoke(responses)
        self.assertNotEqual(result, 0)
        self.assertIn("has no sitemap entries", output)
        self.assertNotIn("OVERALL: PASS", output)

    def test_integrated_wrong_entity_year_relationship_fails(self) -> None:
        responses = integrated_responses()
        key = "https://seo-fixture.invalid/cars/bmw/m550i"
        status, body = responses[key]
        responses[key] = (
            status,
            body.replace(
                'href="/cars/bmw/m550i/2024"',
                'href="/cars/bmw/530i/2024"',
            ),
        )
        result, output, _ = run_fixture_smoke(responses)
        self.assertNotEqual(result, 0)
        self.assertIn("year links disagree with its own sitemap year URLs", output)

    def test_integrated_repeated_vin_cannot_satisfy_year_threshold(self) -> None:
        responses = integrated_responses()
        key = "https://seo-fixture.invalid/cars/bmw/m550i/2024"
        status, body = responses[key]
        first = VIN_LINKS.split("</a>")[0] + "</a>"
        responses[key] = (status, body.replace(VIN_LINKS, first * 3))
        result, output, _ = run_fixture_smoke(responses)
        self.assertNotEqual(result, 0)
        self.assertIn("below the 3-vehicle threshold", output)

    def test_integrated_type_only_jsonld_cannot_pass(self) -> None:
        responses = integrated_responses()
        origin = "https://seo-fixture.invalid"
        key = f"{origin}/cars/bmw/m550i/2024"
        status, body = responses[key]
        invalid = copy.deepcopy(YEAR_JSONLD)
        invalid["@graph"][1]["itemListElement"] = []
        invalid["@graph"][1]["numberOfItems"] = 0
        invalid["@graph"][2]["itemListElement"] = []
        source = json.dumps(YEAR_JSONLD).replace("https://www.autonegotiating.com", origin)
        replacement = json.dumps(invalid).replace("https://www.autonegotiating.com", origin)
        responses[key] = (status, body.replace(source, replacement))
        result, output, _ = run_fixture_smoke(responses)
        self.assertNotEqual(result, 0)
        self.assertIn("ItemList entries/count do not match", output)
        self.assertIn("BreadcrumbList lacks meaningful", output)

    def test_integrated_missing_next_link_cannot_hide_paginated_inventory(self) -> None:
        responses = integrated_responses()
        origin = "https://seo-fixture.invalid"
        family_key = f"{origin}/cars/bmw/5-series"
        status, body = responses[family_key]
        hundred_links = "".join(
            f'<a href="/vehicle/1GYTEDKL5SU{index:06d}">Car</a>'
            for index in range(100)
        )
        responses[family_key] = (status, body.replace(
            '<a href="/vehicle/1GYTEDKL5SU107838">BMW 5 Series listing</a>',
            hundred_links,
        ))
        responses[f"{origin}/cars/bmw/5-series?page=2"] = (200, PAGE2_HTML)
        responses[f"{origin}/cars/bmw/5-series?page=10000"] = (404, "")
        result, output, _ = run_fixture_smoke(responses)
        self.assertNotEqual(result, 0)
        self.assertIn("page 2 link missing despite paginatable inventory", output)

    def test_integrated_page_two_without_inventory_fails(self) -> None:
        responses = integrated_responses()
        origin = "https://seo-fixture.invalid"
        family_key = f"{origin}/cars/bmw/5-series"
        status, body = responses[family_key]
        hundred_links = "".join(
            f'<a href="/vehicle/1GYTEDKL5SU{index:06d}">Car</a>'
            for index in range(100)
        )
        responses[family_key] = (
            status,
            body.replace(
                '<a href="/vehicle/1GYTEDKL5SU107838">BMW 5 Series listing</a>',
                f'<a href="/cars/bmw/5-series?page=2">Next</a>{hundred_links}',
            ),
        )
        empty_page_two = PAGE2_HTML.replace(
            '<a href="/vehicle/1GYTEDKL5SU107838">BMW 5 Series listing</a>',
            "",
        )
        responses[f"{origin}/cars/bmw/5-series?page=2"] = (200, empty_page_two)
        responses[f"{origin}/cars/bmw/5-series?page=10000"] = (404, "")
        result, output, _ = run_fixture_smoke(responses)
        self.assertNotEqual(result, 0)
        self.assertIn("no canonical SSR VIN inventory links", output)

    def test_malformed_xml_is_rejected_by_xml_parser(self) -> None:
        with self.assertRaisesRegex(smoke.SmokeFailure, "malformed sitemap XML"):
            smoke.parse_sitemap(
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://x.test/a</url></urlset>'
            )

    def test_wrong_namespace_empty_xml_and_invalid_entry_shapes_fail_closed(self) -> None:
        for xml in (
            '<urlset><url><loc>https://www.autonegotiating.com/cars</loc></url></urlset>',
            '<urlset xmlns="urn:wrong"></urlset>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<url><loc>https://www.autonegotiating.com/cars</loc><bad>x</bad></url></urlset>',
        ):
            with self.subTest(xml=xml), self.assertRaises(smoke.SmokeFailure):
                smoke.parse_sitemap(xml)

    def test_xml_locations_are_not_entity_decoded_twice_and_empty_coverage_fails(self) -> None:
        tag, locations = smoke.parse_sitemap(
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<url><loc>https://www.autonegotiating.com/cars?x=1&amp;amp;y=2</loc></url></urlset>'
        )
        self.assertEqual(tag, "urlset")
        self.assertEqual(locations[0], "https://www.autonegotiating.com/cars?x=1&amp;y=2")
        self.assertIsNotNone(smoke.sitemap_coverage_error([]))
        self.assertIsNone(smoke.sitemap_coverage_error([
            "https://www.autonegotiating.com/",
            "https://www.autonegotiating.com/cars",
            "https://www.autonegotiating.com/cars/bmw/5-series",
        ]))

    def test_duplicate_urls_and_unclassified_or_legacy_aliases_are_reported(self) -> None:
        urls = [
            "https://www.autonegotiating.com/cars/bmw/5-series-want4r",
            "https://www.autonegotiating.com/cars/bmw/5-series-want4r",
            "https://www.autonegotiating.com/not-a-public-seo-route",
        ]
        duplicates, invalid = smoke.validate_sitemap_locations(urls, smoke.DEFAULT_BASE_URL)
        self.assertEqual(len(duplicates), 1)
        self.assertTrue(any("legacy alias advertised" in item for item in invalid))
        self.assertTrue(any("unclassified sitemap URL" in item for item in invalid))

    def test_sitemap_parser_accepts_namespaced_index_and_urlset(self) -> None:
        tag, urls = smoke.parse_sitemap(
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<sitemap><loc>https://www.autonegotiating.com/sitemap-static.xml</loc></sitemap></sitemapindex>'
        )
        self.assertEqual(tag, "sitemapindex")
        self.assertEqual(urls, ["https://www.autonegotiating.com/sitemap-static.xml"])
        tag, urls = smoke.parse_sitemap(
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<url><loc>https://www.autonegotiating.com/cars</loc></url></urlset>'
        )
        self.assertEqual((tag, urls[0]), ("urlset", "https://www.autonegotiating.com/cars"))

    def test_bad_canonical_and_malformed_jsonld_fail(self) -> None:
        body = """<html><head><title>A meaningful page title</title>
        <meta name="description" content="A sufficiently useful description of the page for search.">
        <link rel="canonical" href="https://attacker.example/elsewhere"></head>
        <body><h1>Page title</h1><script type="application/ld+json">{broken}</script></body></html>"""
        errors, page = smoke.page_content_check(GOOD_URL, body, "www.autonegotiating.com", "fixture")
        self.assertTrue(any("canonical is not self-referencing" in error for error in errors))
        self.assertTrue(any("malformed JSON-LD" in error for error in errors))
        self.assertEqual(page.jsonld, [])

    def test_year_page_passes_threshold_and_required_jsonld(self) -> None:
        errors, _ = smoke.validate_year_page(GOOD_URL, GOOD_YEAR_HTML, "www.autonegotiating.com")
        self.assertEqual(errors, [])

    def test_year_below_threshold_or_wrong_context_fails(self) -> None:
        first_link = VIN_LINKS.split("</a>")[0] + "</a>"
        body = GOOD_YEAR_HTML.replace(VIN_LINKS, first_link * 3)
        body = body.replace("2024 BMW M550i", "2023 BMW 530i")
        errors, _ = smoke.validate_year_page(GOOD_URL, body, "www.autonegotiating.com")
        self.assertTrue(any("year/entity context missing" in error for error in errors))
        self.assertTrue(any("below the 3-vehicle threshold" in error for error in errors))
        self.assertTrue(any("ItemList entries/count do not match" in error for error in errors))

    def test_type_only_empty_jsonld_does_not_pass_collection_checks(self) -> None:
        bad_jsonld = copy.deepcopy(YEAR_JSONLD)
        bad_jsonld["@graph"][1]["itemListElement"] = []
        bad_jsonld["@graph"][1]["numberOfItems"] = 0
        bad_jsonld["@graph"][2]["itemListElement"] = []
        body = GOOD_YEAR_HTML.replace(json.dumps(YEAR_JSONLD), json.dumps(bad_jsonld))
        errors, _ = smoke.validate_year_page(GOOD_URL, body, "www.autonegotiating.com")
        self.assertTrue(any("ItemList entries/count do not match" in error for error in errors))
        self.assertTrue(any("BreadcrumbList lacks meaningful" in error for error in errors))

    def test_phase3a_requires_exact_family_identity_and_filled_jsonld(self) -> None:
        errors, _ = smoke.validate_entity_page(ENTITY_URL, ENTITY_HTML, "www.autonegotiating.com")
        self.assertEqual(errors, [])
        wrong_family = ENTITY_HTML.replace(
            'href="/cars/bmw/5-series"',
            'href="/cars/bmw/m550i/2024"',
        )
        errors, _ = smoke.validate_entity_page(ENTITY_URL, wrong_family, "www.autonegotiating.com")
        self.assertTrue(any("missing exact model-family link" in error for error in errors))

    def test_noncanonical_vehicle_link_variants_are_not_inventory(self) -> None:
        page = smoke.ParsedPage()
        page.feed(
            '<a href="/vehicle/1gytedkl5su107838">lowercase</a>'
            '<a href="/vehicle/1GYTEDKL5SU107838/">trailing slash</a>'
            '<a href="/vehicle/1GYTEDKL5SU107838?x=1">query</a>'
            '<a href="/vehicle/1GYTEDKL5SU107838#fragment">fragment</a>'
        )
        self.assertEqual(smoke.canonical_vin_links(page, GOOD_URL), [])

    def test_year_links_must_match_their_own_entity_and_parent_family(self) -> None:
        errors = smoke.validate_hierarchy_relationships(
            "/cars/bmw/m550i",
            {"https://www.autonegotiating.com/cars/bmw/530i/2023"},
            {"/cars/bmw/m550i": {GOOD_URL}},
        )
        self.assertTrue(any("year links disagree with its own" in error for error in errors))
        page_errors, _ = smoke.validate_year_page(
            GOOD_URL,
            GOOD_YEAR_HTML.replace('href="/cars/bmw/m550i"', 'href="https://attacker.example/cars/bmw/m550i"'),
            "www.autonegotiating.com",
        )
        self.assertTrue(any("missing exact national shopper entity link" in error for error in page_errors))

    def test_page_two_and_out_of_range_are_bounded_and_checked(self) -> None:
        page_url = "https://www.autonegotiating.com/cars/bmw/5-series"
        page_one_links = "".join(
            f'<a href="/vehicle/1GYTEDKL5SU{index:06d}">Car</a>'
            for index in range(100)
        )
        page = smoke.ParsedPage()
        page.feed(f'<a href="/cars/bmw/5-series?page=2">Next</a>{page_one_links}')
        runner = FakeRunner([(200, PAGE2_HTML), (404, "")])
        errors = smoke.validate_pagination_behavior(
            runner,
            page_url,
            page,
            "family",
        )
        self.assertEqual(errors, [])
        self.assertEqual(runner.request_count, 2)
        self.assertIn("?page=10000", runner.requested[1])

    def test_page_two_link_removal_does_not_suppress_expected_page_check(self) -> None:
        page_url = "https://www.autonegotiating.com/cars/bmw/5-series"
        page = smoke.ParsedPage()
        page.feed("".join(
            f'<a href="/vehicle/1GYTEDKL5SU{index:06d}">Car</a>'
            for index in range(100)
        ))
        runner = FakeRunner([(200, PAGE2_HTML), (404, "")])
        errors = smoke.validate_pagination_behavior(
            runner,
            page_url,
            page,
            "family",
        )
        self.assertTrue(any("page 2 link missing despite paginatable inventory" in error for error in errors))
        self.assertEqual(runner.request_count, 2)

    def test_page_two_without_inventory_fails(self) -> None:
        page_url = "https://www.autonegotiating.com/cars/bmw/5-series"
        page = smoke.ParsedPage()
        page.feed(
            '<a href="/cars/bmw/5-series?page=2">Next</a>' +
            "".join(f'<a href="/vehicle/1GYTEDKL5SU{index:06d}">Car</a>' for index in range(100))
        )
        empty_body = """<html><head><title>BMW 5 Series inventory page two</title>
        <meta name="description" content="Browse second-page BMW 5 Series inventory listings.">
        <link rel="canonical" href="https://www.autonegotiating.com/cars/bmw/5-series?page=2">
        </head><body><h1>BMW 5 Series</h1></body></html>"""
        runner = FakeRunner([(200, empty_body), (404, "")])
        errors = smoke.validate_pagination_behavior(runner, page_url, page, "family")
        self.assertTrue(any("no canonical SSR VIN inventory links" in error for error in errors))

    def test_out_of_range_page_must_return_404(self) -> None:
        page_url = "https://www.autonegotiating.com/cars/bmw/5-series"
        page = smoke.ParsedPage()
        page.feed(
            '<a href="/cars/bmw/5-series?page=2">Next</a>' +
            "".join(f'<a href="/vehicle/1GYTEDKL5SU{index:06d}">Car</a>' for index in range(100))
        )
        body = PAGE2_HTML
        runner = FakeRunner([(200, body), (200, body)])
        errors = smoke.validate_pagination_behavior(runner, page_url, page, "family")
        self.assertTrue(any("expected HTTP 404 out of range" in error for error in errors))

    def test_request_budget_is_enforced_before_transport(self) -> None:
        class NeverOpener:
            called = False

            def open(self, *_args: object, **_kwargs: object) -> None:
                self.called = True
                raise AssertionError("transport must not be reached")

        opener = NeverOpener()
        runner = smoke.SmokeRunner(smoke.DEFAULT_BASE_URL, opener=opener, max_requests=0)
        with self.assertRaises(smoke.BudgetExceeded):
            runner.get(f"{smoke.DEFAULT_BASE_URL}/sitemap.xml")
        self.assertFalse(opener.called)
        self.assertEqual(runner.request_count, 0)

    def test_get_rejects_original_userinfo_and_fragment_before_canonicalizing(self) -> None:
        class NeverOpener:
            called = False

            def open(self, *_args: object, **_kwargs: object) -> None:
                self.called = True
                raise AssertionError("unsafe URL must not reach transport")

        opener = NeverOpener()
        runner = smoke.SmokeRunner(smoke.DEFAULT_BASE_URL, opener=opener)
        for url in (
            "https://user@www.autonegotiating.com/cars#fragment",
            "https://www.autonegotiating.com/cars#fragment",
        ):
            with self.subTest(url=url), self.assertRaises(smoke.SmokeFailure):
                runner.get(url)
        self.assertFalse(opener.called)
        self.assertEqual(runner.request_count, 0)

    def test_redirect_and_request_allowlist_reject_unsafe_targets(self) -> None:
        runner = smoke.SmokeRunner(smoke.DEFAULT_BASE_URL)
        self.assertTrue(runner.allowed_public_url(f"{smoke.DEFAULT_BASE_URL}/cars/bmw/m550i"))
        self.assertFalse(runner.allowed_public_url("https://www.autonegotiating.com/api/private"))
        self.assertFalse(runner.allowed_public_url("https://attacker.example/cars/bmw/m550i"))
        self.assertFalse(runner.allowed_public_url("http://www.autonegotiating.com/cars/bmw/m550i"))
        self.assertFalse(runner.allowed_public_url("https://www.autonegotiating.com:444/cars/bmw/m550i"))
        self.assertFalse(runner.allowed_public_url("https://user@www.autonegotiating.com/cars/bmw/m550i"))
        self.assertFalse(runner.allowed_public_url("https://www.autonegotiating.com/cars/bmw/m550i#fragment"))

    def test_vin_allowlist_is_explicit_bounded_and_method_limited(self) -> None:
        runner = smoke.SmokeRunner(smoke.DEFAULT_BASE_URL)
        discovered = [
            f"{smoke.DEFAULT_BASE_URL}/vehicle/1GYTEDKL5SU{index:06d}"
            for index in range(107838, 107850)
        ]
        selected = runner.select_vin_urls(discovered)
        self.assertEqual(len(selected), smoke.MAX_VIN_SAMPLES)
        self.assertIn(f"{smoke.DEFAULT_BASE_URL}/vehicle/{smoke.TARGET_VIN}", selected)
        self.assertTrue(all(runner.allowed_public_url(url, "GET") for url in selected))
        self.assertTrue(all(runner.allowed_public_url(url, "HEAD") for url in selected))
        self.assertFalse(runner.allowed_public_url(
            f"{smoke.DEFAULT_BASE_URL}/vehicle/1GYTEDKL5SU999999", "GET"
        ))
        self.assertFalse(runner.allowed_public_url(selected[0], "POST"))
        self.assertFalse(runner.allowed_public_url(selected[0] + "?x=1", "GET"))

    def test_phase3a_registry_does_not_downgrade_missing_jsonld_to_model_family(self) -> None:
        empty_page = smoke.ParsedPage()
        self.assertTrue(smoke.is_phase3a_entity("/cars/bmw/m550i", empty_page))
        self.assertFalse(smoke.is_phase3a_entity("/cars/bmw/5-series", empty_page))

    def test_obsolete_search_literal_is_detected_in_plain_and_static_html(self) -> None:
        self.assertTrue(smoke.contains_obsolete_search_url(
            '<script type="application/ld+json">{"target":"/?make={make}&amp;model={model}"}</script>'
        ))
        self.assertTrue(smoke.contains_obsolete_search_url(
            '<a href="/?make={make}&model={model}">Search</a>'
        ))
        self.assertFalse(smoke.contains_obsolete_search_url("<html><a href='/cars/bmw/m550i'>BMW</a></html>"))

    def test_sitemap_urls_must_match_origin_and_known_host(self) -> None:
        _, errors = smoke.validate_sitemap_locations(
            ["https://www.autonegotiating.com:444/cars/bmw/m550i"],
            smoke.DEFAULT_BASE_URL,
        )
        self.assertTrue(any("https://www.autonegotiating.com:444" in error for error in errors))

    def test_original_sitemap_userinfo_and_fragment_are_rejected(self) -> None:
        _, errors = smoke.validate_sitemap_locations(
            [
                "https://user@www.autonegotiating.com/cars/bmw/m550i",
                "https://www.autonegotiating.com/cars/bmw/m550i#fragment",
            ],
            smoke.DEFAULT_BASE_URL,
        )
        self.assertEqual(len(errors), 2)

    def test_canonical_link_fragment_is_rejected(self) -> None:
        body = GOOD_YEAR_HTML.replace(
            f'href="{GOOD_URL}"',
            f'href="{GOOD_URL}#fragment"',
            1,
        )
        errors, _ = smoke.page_content_check(GOOD_URL, body, "www.autonegotiating.com", "fixture")
        self.assertTrue(any("canonical is not self-referencing" in error for error in errors))

    def test_rendered_inventory_must_exactly_match_total_and_page_offset(self) -> None:
        page_one = smoke.ParsedPage()
        page_one.feed(GOOD_YEAR_HTML)
        errors = smoke.validate_rendered_inventory_count(GOOD_URL, page_one, 100, "fixture")
        self.assertTrue(any("rendered 3 distinct VINs; expected exactly 100" in error for error in errors))
        page_two = smoke.ParsedPage()
        page_two.feed('<p>101 qualifying vehicles</p>')
        page_two_url = GOOD_URL + "?page=2"
        errors = smoke.validate_rendered_inventory_count(page_two_url, page_two, 101, "fixture")
        self.assertTrue(any("rendered 0 distinct VINs; expected exactly 1" in error for error in errors))

    def test_page_two_qualifying_total_must_match_page_one(self) -> None:
        page_one = smoke.ParsedPage()
        page_one.feed("<p>101 qualifying vehicles</p>")
        page_two = smoke.ParsedPage()
        page_two.feed("<p>100 qualifying vehicles</p>")
        mismatch = smoke.pagination_total_mismatch(page_one, page_two, "fixture")
        self.assertIn("does not match page-1 total 101", mismatch or "")

    def test_live_source_guard_accepts_reviewed_snapshot_but_refuses_without_approval(self) -> None:
        safe, reason = smoke.source_safety_guard(ROOT)
        self.assertTrue(safe)
        self.assertIn("explicitly audited", reason)
        with patch.object(smoke, "AUDITED_SAFE_SOURCE_FINGERPRINTS", frozenset()):
            safe, reason = smoke.source_safety_guard(ROOT)
            self.assertFalse(safe)
            self.assertIn("not explicitly audited", reason)

    def test_source_guard_still_detects_the_old_inventory_write_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in smoke.SAFETY_SOURCE_FILES:
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                content = (ROOT / relative).read_text(encoding="utf-8")
                if relative.endswith("routes/seo.ts"):
                    content += """
                    async function qualifiedCutoff() {
                      await refreshStaleInventory();
                    }
                    db.update(activeInventory);
                    queueIndexNow([]);
                    """
                destination.write_text(content, encoding="utf-8")
            safe, reason = smoke.source_safety_guard(root)
        self.assertFalse(safe)
        self.assertIn("refreshStaleInventory", reason)

    def test_source_guard_never_approves_unlisted_source_shapes(self) -> None:
        route_source = (ROOT / "artifacts/api-server/src/routes/seo.ts").read_text(encoding="utf-8")
        inventory_source = (ROOT / "artifacts/api-server/src/lib/inventory-index.ts").read_text(encoding="utf-8")
        safe_inventory = inventory_source.replace("await refreshStaleInventory();", "// refresh removed")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in smoke.SAFETY_SOURCE_FILES:
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                if relative.endswith("routes/seo.ts"):
                    content = route_source
                elif relative.endswith("lib/inventory-index.ts"):
                    content = safe_inventory
                else:
                    content = (ROOT / relative).read_text(encoding="utf-8")
                destination.write_text(content, encoding="utf-8")
            safe, reason = smoke.source_safety_guard(root)
            self.assertFalse(safe)
            self.assertIn("not explicitly audited", reason)

    def test_unknown_nested_or_indirect_side_effect_source_remains_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in smoke.SAFETY_SOURCE_FILES:
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = (ROOT / relative).read_text(encoding="utf-8")
                if relative.endswith("routes/seo.ts"):
                    source += "\nasync function addedHelper() { nested(() => db.update(activeInventory)); }\n"
                if relative.endswith("lib/inventory-index.ts"):
                    source = source.replace("await refreshStaleInventory();", "// call removed; shape remains unaudited")
                destination.write_text(source, encoding="utf-8")
            safe, reason = smoke.source_safety_guard(root)
            self.assertFalse(safe)
            self.assertIn("not explicitly audited", reason)

    def test_smoke_guard_blocks_with_zero_http_before_any_request(self) -> None:
        output = StringIO()
        with (
            patch.object(smoke, "SmokeRunner") as runner_factory,
            patch.object(smoke, "AUDITED_SAFE_SOURCE_FINGERPRINTS", frozenset()),
            redirect_stdout(output),
        ):
            result = smoke.run_smoke(smoke.DEFAULT_BASE_URL, ROOT)
        self.assertEqual(result, 2)
        runner_factory.return_value.get.assert_not_called()
        self.assertIn("BLOCKED (local SEO read safety unverified)", output.getvalue())
        self.assertIn("Requests: 0", output.getvalue())


if __name__ == "__main__":
    unittest.main()